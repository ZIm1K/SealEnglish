// OpenAI: illustrations (gpt-image-1-mini) and optional TTS. Both are optional: without a key or
// credits the farm falls back to the free Edge voice and brand backgrounds.
import fs from "node:fs";
import { secret, type FarmSettings } from "../env.ts";
import type { Budget } from "../llm.ts";

const SAMPLE_RATE = 24000;

function wavHeader(dataBytes: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/** Trims leading/trailing near-silence so scene timing is tight. */
function trimSilence(pcm: Buffer): Buffer {
  const threshold = 500;
  const pad = Math.round(SAMPLE_RATE * 0.06) * 2;
  let start = 0;
  let end = pcm.length - 2;
  while (start < end && Math.abs(pcm.readInt16LE(start)) < threshold) start += 2;
  while (end > start && Math.abs(pcm.readInt16LE(end)) < threshold) end -= 2;
  return pcm.subarray(Math.max(0, start - pad), Math.min(pcm.length, end + pad) & ~1);
}

/** Writes a WAV file and returns its duration in seconds. */
export async function speakOpenAI(s: FarmSettings, budget: Budget, text: string, outFile: string, voice = s.tts_voice): Promise<number> {
  const key = await secret("openai");
  if (!key) throw new Error("no openai key");
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: s.tts_model,
      voice,
      input: text,
      response_format: "pcm",
      instructions:
        "Мова — українська. Голос молодий, енергійний, усміхнений, як у популярного блогера; темп швидкий, але чіткий. Англійські слова й фрази вимовляй з природною американською вимовою, трохи виділяючи їх інтонацією.",
    }),
  });
  if (!res.ok) throw new Error(`TTS HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const pcm = trimSilence(Buffer.from(await res.arrayBuffer()));
  fs.writeFileSync(outFile, Buffer.concat([wavHeader(pcm.length), pcm]));
  const seconds = pcm.length / (SAMPLE_RATE * 2);
  budget.add("tts", (seconds / 60) * s.prices.tts_per_min);
  return seconds;
}

export async function imagesAvailable() {
  return !!(await secret("openai"));
}

export async function illustrate(
  s: FarmSettings,
  budget: Budget,
  prompt: string,
  outFile: string,
  size: "1024x1536" | "1024x1024" = "1024x1536",
  /** Overrides the default brand clay style (stories bring their own cinematic look). */
  style?: string,
): Promise<void> {
  const key = await secret("openai");
  if (!key) throw new Error("no openai key");
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: s.image_model,
      size,
      quality: s.image_quality,
      output_format: "jpeg",
      n: 1,
      prompt: style
        ? `${prompt}\n\n${style}. Vertical 9:16 composition, main subject in the upper two thirds. Absolutely no text, letters, captions, logos or watermarks.`
        : `${prompt}\n\nStyle: soft 3D clay illustration, Pixar-like lighting, pastel palette with sky blue #8CC1F2, deep navy #061428 and coral #FB7B63 accents, clean composition, shallow depth of field. Absolutely no text, letters, logos, watermarks or animals. Keep the lower third calm and uncluttered.`,
    }),
  });
  if (!res.ok) throw new Error(`Image HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { data: { b64_json: string }[] };
  fs.writeFileSync(outFile, Buffer.from(data.data[0].b64_json, "base64"));
  budget.add("image", s.prices.image);
}
