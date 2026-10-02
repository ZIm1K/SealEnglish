// Exact caption timing for TTS engines that don't return timestamps: transcribe the clip with
// Groq Whisper (word granularity) and map its timings onto the known script words.
import fs from "node:fs";
import path from "node:path";
import { secret } from "../env.ts";
import type { Budget } from "../llm.ts";
import type { RenderWord } from "../schema.ts";
import { spreadWords } from "./timing.ts";

const WHISPER_USD_PER_HOUR = 0.04;

export async function alignWords(budget: Budget, audioFile: string, text: string, seconds: number, lang: string): Promise<RenderWord[]> {
  const tokens = text.split(/\s+/).filter(Boolean);
  const key = await secret("stt");
  if (!key) return spreadWords(text, seconds);
  try {
    const form = new FormData();
    form.set("model", "whisper-large-v3-turbo");
    form.set("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.set("language", lang);
    form.set("file", new Blob([fs.readFileSync(audioFile)]), path.basename(audioFile));
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Whisper HTTP ${res.status}`);
    const data = (await res.json()) as { words?: { word: string; start: number; end: number }[] };
    budget.add("whisper_align", (Math.max(seconds, 10) / 3600) * WHISPER_USD_PER_HOUR);
    const heard = data.words ?? [];
    if (!heard.length) return spreadWords(text, seconds);
    if (heard.length === tokens.length) return tokens.map((t, i) => ({ text: t, start: heard[i].start, end: heard[i].end }));
    // Counts differ (numbers read out, merged words…): spread script words over the spoken span.
    const start = heard[0].start;
    const end = heard[heard.length - 1].end;
    return spreadWords(text, end - start).map((w) => ({ ...w, start: w.start + start, end: w.end + start }));
  } catch {
    return spreadWords(text, seconds);
  }
}
