// Google Gemini (Interactions API): expressive multilingual TTS and reference-based image
// generation that keeps Sílі on-model in any scene.
import fs from "node:fs";
import path from "node:path";
import { MASCOT_DIR, secret, type FarmSettings } from "../env.ts";
import type { Budget } from "../llm.ts";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

export async function geminiAvailable() {
  return !!(await secret("gemini"));
}

async function interact(body: Record<string, unknown>): Promise<unknown> {
  const key = await secret("gemini");
  if (!key) throw new Error("no gemini key");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** Finds the last {type, data} media block of the given type anywhere in the response. */
function findMedia(node: unknown, type: "audio" | "image"): string | null {
  let found: string | null = null;
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const o = n as Record<string, unknown>;
    if (typeof o.data === "string" && (o.type === type || String(o.mime_type ?? "").startsWith(`${type}/`))) found = o.data;
    Object.values(o).forEach(walk);
  };
  walk(node);
  return found;
}

/** Writes a WAV (24 kHz mono 16-bit) and returns its duration in seconds. */
export async function speakGemini(s: FarmSettings, budget: Budget, text: string, voice: string, style: string, outFile: string): Promise<number> {
  const json = await interact({
    model: s.gemini_tts_model,
    input: [
      {
        type: "user_input",
        content: [{ type: "text", text, annotations: style ? [{ type: "speech_metadata", style }] : [] }],
      },
    ],
    response_format: { type: "audio" },
    generation_config: { speech_config: [{ voice }] },
  });
  const data = findMedia(json, "audio");
  if (!data) throw new Error("Gemini TTS: у відповіді немає аудіо");
  let buf = Buffer.from(data, "base64");
  // Unary responses are WAV; wrap raw PCM if a headerless stream format ever comes back.
  if (buf.subarray(0, 4).toString() !== "RIFF") buf = Buffer.concat([pcmWavHeader(buf.length), buf]);
  fs.writeFileSync(outFile, buf);
  const seconds = wavSeconds(buf);
  budget.add("tts_gemini", (seconds / 10) * s.prices.gemini_tts_per_10s);
  return seconds;
}

function pcmWavHeader(dataBytes: number, rate = 24000): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

function wavSeconds(buf: Buffer): number {
  // Walk RIFF chunks to the "data" chunk; byte rate lives in "fmt ".
  let byteRate = 48000;
  for (let off = 12; off + 8 <= buf.length; ) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") byteRate = buf.readUInt32LE(off + 16);
    if (id === "data") return Math.min(size, buf.length - off - 8) / byteRate;
    off += 8 + size + (size % 2);
  }
  return (buf.length - 44) / byteRate;
}

/** Reference renders of Sílі sent with every "Sílі in frame" request (max 4 per the API). */
const SEAL_REFS = ["stand-happy.webp", "stand-surprised.webp", "read-happy.webp", "wave-happy.webp"];

/** A scene prompt that asks for Sílі (or any seal — the brand has only one). */
export const mentionsSeal = (prompt: string) => /\b(seals?|mascots?|sili)\b|sílі|сілі|тюлен/i.test(prompt);

// Without the references and this description the model draws a generic seal: furry, darker,
// dressed up (2026-10-07). Every trait it got wrong is spelled out here.
export const SEAL_DESCRIPTION = [
  "Sílі, the brand mascot — the SAME character as in the attached reference images. Any seal the scene mentions is him. Copy the references exactly; change only his pose and facial expression.",
  "- Material: smooth matte soft-vinyl / clay toy surface, like a 3D designer toy. NO fur, no hair strands, no realistic animal texture.",
  "- Color: light sky blue (#7FB4F5) all over; clean white muzzle and one big white oval belly patch.",
  "- Shape: chubby and short, a big round head about as large as the body, no neck, three small rounded bumps on top of the head, short stubby arms with mitten-like flippers, short feet, a small rounded tail.",
  "- Face: big round dark-navy eyes with one white highlight, thin short navy eyebrows, a small navy nose, round coral-pink cheeks, three thin navy whiskers on each side. Cute, friendly, baby-like.",
  "- He wears nothing: no scarf, bandana, clothes, hat or glasses. Headphones or another prop only if the scene asks for it.",
  "- His book is small, coral-red with a navy spine and blank covers.",
  "He stands upright and uses his flippers like hands. There is exactly one Sílі in the picture, lit by the scene's light and standing in it naturally, with contact shadows.",
].join("\n");

export async function drawGemini(
  s: FarmSettings,
  budget: Budget,
  prompt: string,
  outFile: string,
  withSeal: boolean,
  aspect: "9:16" | "4:5" = "9:16",
  /** Scene-only frame on the reference-capable model: the fallback when the lite model stays overloaded. */
  full = withSeal,
): Promise<void> {
  const input: Record<string, unknown>[] = [{ type: "text", text: prompt }];
  if (withSeal) {
    for (const f of SEAL_REFS) {
      const p = path.join(MASCOT_DIR, f);
      if (fs.existsSync(p)) input.push({ type: "image", mime_type: "image/webp", data: fs.readFileSync(p).toString("base64") });
    }
  }
  const json = await interact({
    model: full ? s.gemini_image_model : s.gemini_image_model_lite,
    input,
    response_format: { type: "image", aspect_ratio: aspect, image_size: "1K" },
  });
  const data = findMedia(json, "image");
  if (!data) throw new Error("Gemini image: у відповіді немає зображення");
  fs.writeFileSync(outFile, Buffer.from(data, "base64"));
  budget.add(withSeal ? "image_seal" : full ? "image_scene_full" : "image_scene", full ? s.prices.gemini_image : s.prices.gemini_image_lite);
}
