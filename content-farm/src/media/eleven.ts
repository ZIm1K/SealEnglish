// ElevenLabs TTS with character-level timestamps (→ exact word timings for captions).
import fs from "node:fs";
import { secret, type FarmSettings } from "../env.ts";
import type { Budget } from "../llm.ts";
import type { RenderWord } from "../schema.ts";

export async function elevenAvailable() {
  return !!(await secret("eleven"));
}

interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Groups character timings into words, keeping punctuation attached for captions. */
function wordsFromAlignment(a: Alignment): RenderWord[] {
  const words: RenderWord[] = [];
  let cur: RenderWord | null = null;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (cur) words.push(cur);
      cur = null;
      return;
    }
    if (!cur) cur = { text: "", start: a.character_start_times_seconds[i], end: a.character_end_times_seconds[i] };
    cur.text += ch;
    cur.end = a.character_end_times_seconds[i];
  });
  if (cur) words.push(cur);
  return words;
}

export async function speakEleven(
  s: FarmSettings,
  budget: Budget,
  text: string,
  voiceId: string,
  lang: "uk" | "en",
  outFile: string,
  context: { previous?: string; next?: string } = {},
  speed = 1,
): Promise<{ seconds: number; words: RenderWord[] }> {
  const key = await secret("eleven");
  if (!key) throw new Error("no elevenlabs key");
  const call = async (model: string, withLang: boolean) =>
    fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: model,
        ...(withLang ? { language_code: lang } : {}),
        // Continuity hints make consecutive lines of one speaker sound like one performance.
        ...(context.previous ? { previous_text: context.previous } : {}),
        ...(context.next ? { next_text: context.next } : {}),
        voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: Math.min(1.2, Math.max(0.7, s.eleven_speed * speed)) },
      }),
    });
  let res = await call(s.eleven_model, true);
  // Some models reject language_code; retry once without it, then fall back to multilingual v2.
  if (res.status === 400) res = await call(s.eleven_model, false);
  if (res.status === 400 || res.status === 422) res = await call("eleven_multilingual_v2", true);
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { audio_base64: string; alignment?: Alignment; normalized_alignment?: Alignment };
  fs.writeFileSync(outFile, Buffer.from(data.audio_base64, "base64"));
  const align = data.alignment ?? data.normalized_alignment;
  const words = align ? wordsFromAlignment(align) : [];
  const seconds = align?.character_end_times_seconds.at(-1) ?? text.length / 15;
  budget.add("tts_eleven", (text.length / 1000) * s.prices.eleven_per_1k_chars);
  return { seconds: seconds + 0.05, words };
}

/**
 * Characters left in the current billing period, or null when it can't be read (no key, or the
 * key lacks the "User: Read" permission — then the farm simply doesn't warn in advance).
 */
export async function elevenCharactersLeft(): Promise<number | null> {
  const key = await secret("eleven");
  if (!key) return null;
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": key } });
    if (!res.ok) return null;
    const sub = (await res.json()) as { character_count?: number; character_limit?: number };
    return typeof sub.character_count === "number" && typeof sub.character_limit === "number" ? sub.character_limit - sub.character_count : null;
  } catch {
    return null;
  }
}

/** Lists the account's voices (premade + added from the Voice Library) — `npm run farm -- voices`. */
export async function listElevenVoices(): Promise<{ voice_id: string; name: string; labels?: Record<string, string> }[]> {
  const key = await secret("eleven");
  if (!key) throw new Error("no elevenlabs key");
  const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key } });
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}`);
  return ((await res.json()) as { voices: { voice_id: string; name: string; labels?: Record<string, string> }[] }).voices;
}

export const SEAL_VOICE_DESCRIPTION =
  "Voice of Sílі, a cute baby seal cartoon mascot of a Ukrainian English school. Cheerful, warm, playful and curious; " +
  "a bright young boyish voice with the vibe of a 10–12 year old animated character, slightly high-pitched but natural, " +
  "never squeaky. Energetic, smiling delivery, very clear native Ukrainian pronunciation with correct stress, " +
  "expressive reactions (surprise, giggles, confusion). Studio-quality, close mic.";

export const SEAL_VOICE_SAMPLE =
  "Привіт! Я Сілі. Сьогодні я вперше замовляю каву в Нью-Йорку… і, чесно, трохи панікую! " +
  "Бариста питає: for here or to go? А я стою і думаю: що? Ха-ха, добре, що тепер я знаю відповідь. To go, please!";

/** Generates voice previews from a description (Voice Design). */
export async function designVoice(description: string, text: string): Promise<{ id: string; audio: Buffer }[]> {
  const key = await secret("eleven");
  if (!key) throw new Error("no elevenlabs key");
  const res = await fetch("https://api.elevenlabs.io/v1/text-to-voice/design", {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ voice_description: description, text, model_id: "eleven_ttv_v3", should_enhance: false }),
  });
  if (!res.ok) throw new Error(`Voice Design HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { previews: { audio_base_64: string; generated_voice_id: string }[] };
  return data.previews.map((p) => ({ id: p.generated_voice_id, audio: Buffer.from(p.audio_base_64, "base64") }));
}

/** Saves a designed preview as a permanent voice in the account; returns its voice_id. */
export async function saveDesignedVoice(name: string, description: string, generatedVoiceId: string): Promise<string> {
  const key = await secret("eleven");
  if (!key) throw new Error("no elevenlabs key");
  const res = await fetch("https://api.elevenlabs.io/v1/text-to-voice", {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ voice_name: name, voice_description: description, generated_voice_id: generatedVoiceId }),
  });
  if (!res.ok) throw new Error(`Save voice HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return ((await res.json()) as { voice_id: string }).voice_id;
}
