// Word timings for karaoke captions. TTS doesn't return timestamps, so words are spread over the
// clip proportionally to their length (+ pauses after punctuation) — accurate enough for 1–2
// sentence scenes, and free.
import type { RenderWord } from "../schema.ts";

export function spreadWords(text: string, duration: number): RenderWord[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const weight = (w: string) => Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, "").length) + (/[.,!?:;—…]$/.test(w) ? 3 : 0);
  const total = words.reduce((a, w) => a + weight(w), 0);
  let t = 0;
  return words.map((w) => {
    const len = (weight(w) / total) * duration;
    const word = { text: w, start: t, end: t + len };
    t += len;
    return word;
  });
}

/** Reading-speed duration for caption-only videos (no TTS). */
export const readingSeconds = (text: string) => Math.max(1.6, text.split(/\s+/).filter(Boolean).length * 0.36 + 0.6);
