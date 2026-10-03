// Finds where the speaking background character's head is on a generated location, so the camera
// can frame them and speech bubbles never cover their face.
import fs from "node:fs";
import { z } from "zod";
import { cacheGetJson, cacheKey, cachePutJson, fileHash } from "../cache.ts";
import type { FarmSettings } from "../env.ts";
import { structured, type Budget } from "../llm.ts";

const HeadSchema = z.object({
  found: z.boolean().describe("Чи є на зображенні такий персонаж"),
  x: z.number().describe("Центр голови по горизонталі, частка ширини 0–1"),
  y: z.number().describe("Центр голови по вертикалі, частка висоти 0–1"),
  top: z.number().describe("Верх голови (маківка), частка висоти 0–1"),
  size: z.number().describe("Висота голови, частка висоти зображення 0–1"),
});
export type Head = z.infer<typeof HeadSchema>;

export async function locateHead(s: FarmSettings, budget: Budget, imageFile: string, description: string, side: string): Promise<Head | null> {
  // Keyed by the picture itself: a cached background keeps its cached head position.
  const key = cacheKey("head", fileHash(imageFile), side);
  const cached = await cacheGetJson<Head>(key);
  if (cached) return cached.found ? cached : null;
  try {
    const head = await structured({
      s,
      budget,
      what: "locate_npc",
      schema: HeadSchema,
      effort: "low",
      system: "You locate characters on images and answer with precise normalized coordinates.",
      prompt: `Scene description: ${description}\nFind the main background character who talks to the viewer (expected on the ${side} side). Return the position of their HEAD.`,
      images: [{ media_type: "image/jpeg", data: fs.readFileSync(imageFile).toString("base64") }],
    });
    const c = (v: number) => Math.min(1, Math.max(0, v));
    const result: Head = { found: head.found, x: c(head.x), y: c(head.y), top: c(head.top), size: c(head.size) };
    await cachePutJson(key, result);
    return result.found ? result : null;
  } catch {
    return null;
  }
}
