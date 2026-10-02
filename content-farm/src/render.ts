// Stage 5: Remotion render (headless Chrome + bundled ffmpeg) — free, runs locally or in CI.
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MASCOT_DIR, ROOT, WORK } from "./env.ts";
import { ensureMusic } from "./media/music.ts";
import { ensureSfx } from "./media/sfx.ts";
import type { IgCardProps, RenderProps, StoryProps } from "./schema.ts";

export const PUBLIC = path.join(WORK, "public");

/** Static assets every render needs: mascot poses (from the site), synthesized SFX, music. */
export function preparePublic() {
  fs.mkdirSync(PUBLIC, { recursive: true });
  const mascotDst = path.join(PUBLIC, "mascot3d");
  if (!fs.existsSync(mascotDst)) fs.cpSync(MASCOT_DIR, mascotDst, { recursive: true });
  ensureSfx(path.join(PUBLIC, "sfx"));
  const musicSrc = path.join(ROOT, "assets", "music");
  const musicDst = path.join(PUBLIC, "music");
  fs.mkdirSync(musicDst, { recursive: true });
  for (const f of fs.readdirSync(musicSrc).filter((f) => /\.(mp3|wav|m4a|ogg)$/i.test(f))) {
    const dst = path.join(musicDst, f);
    if (!fs.existsSync(dst)) fs.copyFileSync(path.join(musicSrc, f), dst);
  }
  ensureMusic(musicDst);
}

/** Real tracks (assets/music/<mood>-*.mp3) win; generated gen-<mood>-N.wav is the fallback. */
export function pickMusic(mood: string): string | null {
  const dir = path.join(PUBLIC, "music");
  if (!fs.existsSync(dir)) return null;
  const all = fs.readdirSync(dir).filter((f) => /\.(mp3|wav|m4a|ogg)$/i.test(f));
  const real = all.filter((f) => !f.startsWith("gen-"));
  const pools = [real.filter((f) => f.toLowerCase().startsWith(mood)), all.filter((f) => f.startsWith(`gen-${mood}-`)), real, all];
  const pool = pools.find((p) => p.length) ?? [];
  return pool.length ? `music/${pool[Math.floor(Math.random() * pool.length)]}` : null;
}

export const jobDir = (id: string) => {
  const dir = path.join(PUBLIC, "jobs", id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/** Bundle once per batch — the bundle snapshots the public dir, so call after assets exist. */
export async function makeBundle(): Promise<string> {
  return bundle({ entryPoint: path.join(ROOT, "remotion", "index.ts"), publicDir: PUBLIC });
}

const isStory = (p: RenderProps | StoryProps): p is StoryProps => Array.isArray((p as StoryProps).beats);

export async function renderVideo(serveUrl: string, props: RenderProps | StoryProps, outDir: string, name: string) {
  fs.mkdirSync(outDir, { recursive: true });
  const id = isStory(props) ? "Story" : "Short";
  const composition = await selectComposition({ serveUrl, id, inputProps: props });
  const video = path.join(outDir, `${name}.mp4`);
  const cover = path.join(outDir, `${name}.jpg`);
  let last = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    crf: 20,
    audioCodec: "aac",
    // Remotion defaults to half the cores; use all of them (Cloud Run gives 2 vCPU).
    concurrency: os.cpus().length,
    outputLocation: video,
    inputProps: props,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct !== last) {
        last = pct;
        process.stdout.write(`    рендер ${pct}%\r`);
      }
    },
  });
  process.stdout.write("\n");
  // Cover: Short — end of the hook scene (headline fully shown); Story — hook card on the first beat.
  const first = isStory(props) ? Math.min(props.beats[0].duration, 2) : props.scenes[0].duration;
  const coverFrame = Math.min(composition.durationInFrames - 1, Math.round(first * props.fps) - 2);
  await renderStill({ composition, serveUrl, output: cover, inputProps: props, frame: Math.max(0, coverFrame), imageFormat: "jpeg", jpegQuality: 88 });
  return { video, cover, seconds: composition.durationInFrames / composition.fps };
}

/** Instagram feed card (4:5 JPEG). */
export async function renderIgCard(serveUrl: string, props: IgCardProps, outFile: string) {
  const composition = await selectComposition({ serveUrl, id: "IgCard", inputProps: props });
  await renderStill({ composition, serveUrl, output: outFile, inputProps: props, frame: 0, imageFormat: "jpeg", jpegQuality: 92 });
}
