// Voice-over, one distinct voice per character. Default: Gemini TTS — natural, expressive (style
// prompt per line), multilingual; captions get exact timings via Whisper alignment.
// Fallbacks: Microsoft Edge neural voices (free, but flatter) and OpenAI TTS.
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import fs from "node:fs";
import path from "node:path";
import { cacheGet, cacheGetJson, cacheKey, cachePut, cachePutJson } from "../cache.ts";
import type { FarmSettings } from "../env.ts";
import type { Budget } from "../llm.ts";
import type { RenderWord, Speaker } from "../schema.ts";
import { alignWords } from "./align.ts";
import { elevenAvailable, speakEleven } from "./eleven.ts";
import { geminiAvailable, speakGemini } from "./gemini.ts";
import { speakOpenAI } from "./openai.ts";
import { withRetry } from "./retry.ts";
import { spreadWords } from "./timing.ts";

export interface Speech {
  /** File name next to the requested path (extension depends on provider). */
  file: string;
  seconds: number;
  words: RenderWord[];
  /** Which engine actually voiced the line (differs from settings.tts_provider when it fell back). */
  provider: string;
}

const MP3_BITRATE = 48000; // audio-24khz-48kbitrate-mono-mp3 is CBR

/**
 * One distinct voice per role. Edge has only two native Ukrainian voices (Ostap, Polina), so
 * Ukrainian characters are told apart by pitch/rate; English-speaking characters get native
 * en-US voices. Rates are relative to the settings' base rate.
 */
export const VOICES: Record<Speaker, { voice: string; pitch?: string; rate?: number; openai: string; gemini: string; style: string }> = {
  narrator: { voice: "uk-UA-OstapNeural", openai: "ash", gemini: "Charon", style: "захопливий оповідач вірусних історій: інтригуюче, живо, з паузами перед поворотами" },
  seal: { voice: "uk-UA-PolinaNeural", pitch: "+22%", rate: 6, openai: "coral", gemini: "Leda", style: "милий мультяшний персонаж-підліток, грайливо, енергійно, з усмішкою" },
  uk_male: { voice: "uk-UA-OstapNeural", pitch: "-12%", rate: -4, openai: "onyx", gemini: "Orus", style: "природно, розмовно" },
  uk_female: { voice: "uk-UA-PolinaNeural", pitch: "-6%", openai: "sage", gemini: "Aoede", style: "природно, розмовно" },
  uk_old: { voice: "uk-UA-OstapNeural", pitch: "-20%", rate: -14, openai: "ballad", gemini: "Gacrux", style: "літня людина, неквапливо" },
  en_male: { voice: "en-US-AndrewNeural", openai: "echo", gemini: "Puck", style: "natural casual American English" },
  en_female: { voice: "en-US-AvaNeural", openai: "shimmer", gemini: "Zephyr", style: "natural casual American English" },
  en_male_2: { voice: "en-US-GuyNeural", openai: "verse", gemini: "Fenrir", style: "natural casual American English" },
  en_female_2: { voice: "en-US-JennyNeural", openai: "nova", gemini: "Despina", style: "natural casual American English" },
  en_child: { voice: "en-US-AnaNeural", openai: "fable", gemini: "Laomedeia", style: "young child, playful American English" },
};

const pct = (base: string, delta = 0) => {
  const n = parseInt(base, 10) + delta;
  return `${n >= 0 ? "+" : ""}${n}%`;
};

async function speakEdge(s: FarmSettings, text: string, outBase: string, speaker: Speaker): Promise<Speech> {
  const v = VOICES[speaker];
  const tmp = `${outBase}-edge`;
  fs.mkdirSync(tmp, { recursive: true });
  const tts = new MsEdgeTTS();
  try {
    const voice = speaker === "narrator" ? s.edge_voice : v.voice;
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, { wordBoundaryEnabled: true });
    const { audioFilePath, metadataFilePath } = await tts.toFile(tmp, text, {
      rate: pct(s.edge_rate, v.rate),
      ...(v.pitch ? { pitch: v.pitch } : {}),
    });
    const file = `${outBase}.mp3`;
    fs.renameSync(audioFilePath, file);
    const seconds = (fs.statSync(file).size * 8) / MP3_BITRATE;
    let words: RenderWord[] = [];
    if (metadataFilePath && fs.existsSync(metadataFilePath)) {
      const meta = JSON.parse(fs.readFileSync(metadataFilePath, "utf8")) as {
        Metadata: { Type: string; Data: { Offset: number; Duration: number; text: { Text: string } } }[];
      };
      words = meta.Metadata.filter((m) => m.Type === "WordBoundary").map((m) => ({
        text: m.Data.text.Text,
        start: m.Data.Offset / 1e7,
        end: (m.Data.Offset + m.Data.Duration) / 1e7,
      }));
    }
    if (!words.length) words = spreadWords(text, seconds);
    return { file, seconds, words: attachPunctuation(text, words), provider: "edge" };
  } finally {
    tts.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Edge drops punctuation from word boundaries; re-attach it from the source text for captions. */
function attachPunctuation(text: string, words: RenderWord[]): RenderWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  let ti = 0;
  return words.map((w) => {
    const core = w.text.toLowerCase();
    for (let k = ti; k < Math.min(tokens.length, ti + 4); k++) {
      if (tokens[k].toLowerCase().replace(/[^\p{L}\p{N}'’-]/gu, "").includes(core.replace(/[^\p{L}\p{N}'’-]/gu, ""))) {
        ti = k + 1;
        return { ...w, text: tokens[k] };
      }
    }
    return w;
  });
}

export async function speak(
  s: FarmSettings,
  budget: Budget,
  text: string,
  outBase: string,
  speaker: Speaker = "narrator",
  /** Per-line delivery note from the script, e.g. «пошепки, з напругою». */
  delivery = "",
  context: { previous?: string; next?: string } = {},
  opts: { speed?: number; display?: string } = {},
): Promise<Speech> {
  // Same line, voice and tempo → same audio: reuse it instead of paying the TTS provider again.
  const key = cacheKey("tts", s.tts_provider, s.eleven_model, s.eleven_voices[speaker], s.eleven_speed, speaker, text, opts.speed ?? 1, delivery);
  const meta = await cacheGetJson<{ ext: string; seconds: number; words: RenderWord[] }>(key);
  let result: Speech;
  if (meta && (await cacheGet(key, meta.ext, `${outBase}.${meta.ext}`))) {
    result = { file: `${outBase}.${meta.ext}`, seconds: meta.seconds, words: meta.words, provider: s.tts_provider };
  } else {
    result = await speakRaw(s, budget, text, outBase, speaker, delivery, context, opts.speed ?? 1);
    // A stand-in voice must not be remembered as this line's take: once the main provider is
    // back, the line is voiced properly instead of replaying the fallback from the cache.
    if (result.provider === s.tts_provider) {
      const ext = path.extname(result.file).slice(1);
      await cachePut(key, ext, result.file, ext === "mp3" ? "audio/mpeg" : "audio/wav");
      await cachePutJson(key, { ext, seconds: result.seconds, words: result.words });
    }
  }
  // The voice may say a stylized version (slurred gag, stretched word); captions show the script text.
  if (opts.display && opts.display !== text) {
    const first = result.words[0]?.start ?? 0;
    const last = result.words.at(-1)?.end ?? result.seconds;
    result.words = spreadWords(opts.display, Math.max(0.3, last - first)).map((w) => ({ ...w, start: w.start + first, end: w.end + first }));
  }
  return result;
}

async function speakRaw(
  s: FarmSettings,
  budget: Budget,
  text: string,
  outBase: string,
  speaker: Speaker,
  delivery: string,
  context: { previous?: string; next?: string },
  speed: number,
): Promise<Speech> {
  const v = VOICES[speaker];
  const order = [s.tts_provider, "eleven", "gemini", "edge", "openai"].filter((p, i, a) => a.indexOf(p) === i);
  // Language follows the text itself: Ukrainian heroes sometimes say English lines.
  const lang: "uk" | "en" = /[а-яіїєґ]/i.test(text) ? "uk" : "en";
  let lastErr: unknown;
  for (const p of order) {
    try {
      if (p === "eleven") {
        if (!(await elevenAvailable())) continue;
        const file = `${outBase}.mp3`;
        // Rate limits and overloads pass in seconds; switching voices mid-video is the worse outcome.
        const r = await withRetry(() => speakEleven(s, budget, text, s.eleven_voices[speaker] ?? s.eleven_voices.narrator, lang, file, context, speed), 3);
        return { file, seconds: r.seconds, words: r.words.length ? r.words : await alignWords(budget, file, text, r.seconds, lang), provider: p };
      }
      if (p === "gemini") {
        if (!(await geminiAvailable())) continue;
        const file = `${outBase}.wav`;
        const style = [v.style, delivery].filter(Boolean).join("; ");
        const seconds = await withRetry(() => speakGemini(s, budget, text, v.gemini, style, file), 3);
        return { file, seconds, words: await alignWords(budget, file, text, seconds, lang), provider: p };
      }
      if (p === "edge") return await speakEdge(s, text, outBase, speaker);
      const file = `${outBase}.wav`;
      const seconds = await speakOpenAI(s, budget, text, file, v.openai);
      return { file, seconds, words: await alignWords(budget, file, text, seconds, lang), provider: p };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export const relTo = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join("/");
