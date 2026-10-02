// Google Gemini (Interactions API): expressive multilingual TTS and reference-based image
// generation that keeps Sílі on-model in any scene.
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, secret, type FarmSettings } from "../env.ts";
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
const SEAL_REFS = ["stand-happy.webp", "wave-happy.webp", "read-happy.webp"];

export const SEAL_DESCRIPTION =
  "Sílі — the cute chubby baby seal mascot shown in the reference images: sky-blue fur, white belly and muzzle, big dark glossy eyes, pink cheeks, small navy whiskers, often holding a red-coral book. Keep his exact proportions, colors and 3D Pixar-like clay look; he can walk upright, gesture and use flippers like hands.";

export async function drawGemini(
  s: FarmSettings,
  budget: Budget,
  prompt: string,
  outFile: string,
  withSeal: boolean,
  aspect: "9:16" | "4:5" = "9:16",
): Promise<void> {
  const input: Record<string, unknown>[] = [{ type: "text", text: prompt }];
  if (withSeal) {
    for (const f of SEAL_REFS) {
      const p = path.join(REPO_ROOT, "public", "mascot3d", f);
      if (fs.existsSync(p)) input.push({ type: "image", mime_type: "image/webp", data: fs.readFileSync(p).toString("base64") });
    }
  }
  const json = await interact({
    model: withSeal ? s.gemini_image_model : s.gemini_image_model_lite,
    input,
    response_format: { type: "image", aspect_ratio: aspect, image_size: "1K" },
  });
  const data = findMedia(json, "image");
  if (!data) throw new Error("Gemini image: у відповіді немає зображення");
  fs.writeFileSync(outFile, Buffer.from(data, "base64"));
  budget.add(withSeal ? "image_seal" : "image_scene", withSeal ? s.prices.gemini_image : s.prices.gemini_image_lite);
}
