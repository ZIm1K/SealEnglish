// Frame illustrations: Gemini (Sílі kept on-model via reference renders; cheap lite model for
// scene-only frames) or OpenAI as a fallback (no Sílі reference).
import { cacheGet, cacheKey, cachePut } from "../cache.ts";
import { type FarmSettings } from "../env.ts";
import type { Budget } from "../llm.ts";
import { drawGemini, geminiAvailable, SEAL_DESCRIPTION } from "./gemini.ts";
import { illustrate, imagesAvailable } from "./openai.ts";

export interface FrameRequest {
  prompt: string;
  /** Sílі acts in this frame (needs the reference-capable model). */
  withSeal: boolean;
  /** Story-wide look; omitted for edu backgrounds (brand clay style). */
  style?: string;
  /** Default 9:16 (video); 4:5 for feed posts. */
  aspect?: "9:16" | "4:5";
}

export async function canDraw(s: FarmSettings) {
  return (await geminiAvailable()) || (await imagesAvailable());
}

export const frameCost = (s: FarmSettings, withSeal: boolean) =>
  withSeal ? s.prices.gemini_image : s.prices.gemini_image_lite;

export async function drawFrame(s: FarmSettings, budget: Budget, req: FrameRequest, outFile: string): Promise<void> {
  // Same prompt and model → same picture: reuse it instead of paying for a new one.
  const key = cacheKey("img", s.image_provider, s.gemini_image_model, s.gemini_image_model_lite, s.image_model, req);
  if (await cacheGet(key, "jpg", outFile)) return;
  await generate(s, budget, req, outFile);
  await cachePut(key, "jpg", outFile, "image/jpeg");
}

async function generate(s: FarmSettings, budget: Budget, req: FrameRequest, outFile: string): Promise<void> {
  const useGemini = (s.image_provider === "gemini" || !(await imagesAvailable())) && (await geminiAvailable());
  if (useGemini) {
    const prompt = [
      req.withSeal ? `Main character: ${SEAL_DESCRIPTION}` : "",
      `Scene: ${req.prompt}`,
      `Style: ${req.style || "stylized 3D animated film still, Pixar-like lighting, soft pastel colors with sky blue and coral accents"}.`,
      req.aspect === "4:5"
        ? "Portrait 4:5 feed image, clear focal point. No text, letters, captions, logos or watermarks."
        : "Vertical 9:16 frame, key action in the upper two thirds, cinematic depth of field. No text, letters, captions, logos or watermarks.",
    ]
      .filter(Boolean)
      .join("\n");
    return drawGemini(s, budget, prompt, outFile, req.withSeal, req.aspect ?? "9:16");
  }
  return illustrate(s, budget, req.prompt, outFile, req.aspect === "4:5" ? "1024x1024" : "1024x1536", req.style);
}
