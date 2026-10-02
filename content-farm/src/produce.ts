// Two-stage production with the owner in the loop:
//   1) writeScripts — ideas → scripts saved as status "script" → owner edits/approves in the cabinet
//      (/app/content/), or asks for a rewrite with a note ("script_rewrite").
//   2) produceApproved — "approved" scripts → voice, backgrounds, render → storage → status "review".
import fs from "node:fs";
import path from "node:path";
import { HANDLES } from "./brand.ts";
import { ROOT, type FarmSettings } from "./env.ts";
import { buildRenderProps, buildStoryProps, type BeatMedia, type SceneAudio } from "./layout.ts";
import { Budget } from "./llm.ts";
import { canDraw, drawFrame, frameCost, type FrameRequest } from "./media/images.ts";
import { locateHead } from "./media/locate.ts";
import { speak, type Speech } from "./media/tts.ts";
import { notifyAdmins } from "./notify.ts";
import { jobDir, makeBundle, pickMusic, preparePublic, PUBLIC, renderVideo } from "./render.ts";
import type { Idea, RenderLocation, RenderProps, Script, Speaker, Story, StoryProps, TextPost } from "./schema.ts";
import { detectScript, normalizeScript, normalizeStory, rewriteWithNote, writeScript, writeStory, writeTextPost, type AnyScript } from "./script.ts";
import { claimItem, itemsWithStatus, markIdea, saveItem, siteUrl, updateItem, upload, writeLocal, type ItemRow, type StoredIdea } from "./store.ts";

type Log = (m: string) => void;

// Storage keys must be ASCII — transliterate Ukrainian (KMU 2010, simplified).
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch",
  ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia", "'": "", "’": "",
};
const slug = (s: string) =>
  [...s.toLowerCase()]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const outDir = () => path.join(ROOT, "out", new Date().toISOString().slice(0, 10));
const rel = (abs: string) => path.relative(PUBLIC, abs).split(path.sep).join("/");
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** Set after the first failure (e.g. provider down, no credits) so a run doesn't retry per scene. */
let ttsDown = false;
let imagesDown = false;

async function tryDraw(s: FarmSettings, budget: Budget, req: FrameRequest, file: string, log: Log): Promise<string | null> {
  if (imagesDown || !(await canDraw(s)) || !budget.canAfford(frameCost(s, req.withSeal) + 0.01)) return null;
  try {
    await drawFrame(s, budget, req, file);
    return rel(file);
  } catch (e) {
    if (!imagesDown) log(`  ⚠ ілюстрації недоступні в цьому запуску: ${(e as Error).message.slice(0, 160)}`);
    imagesDown = true;
    return null;
  }
}

async function trySpeak(
  s: FarmSettings,
  budget: Budget,
  text: string,
  base: string,
  log: Log,
  speaker: Speaker = "narrator",
  delivery = "",
  context: { previous?: string; next?: string } = {},
  opts: { speed?: number; display?: string } = {},
): Promise<Speech | null> {
  if (ttsDown || !text.trim()) return null;
  try {
    return await speak(s, budget, text, base, speaker, delivery, context, opts);
  } catch (e) {
    ttsDown = true;
    log(`  ⚠ озвучка недоступна: ${(e as Error).message.slice(0, 160)}`);
    return null;
  }
}

// ───────────────────────── Stage 1: scripts for approval ─────────────────────────

function scriptPreview(script: AnyScript): string {
  if (script.kind === "story") {
    const st = script.data;
    const lines = st.beats.map((b) => `${b.speaker === "narrator" ? "🎙" : b.speaker === "seal" ? "🦭" : "💬"} ${b.speaker_name || "Оповідач"}: ${b.narration}${b.translation ? `  (${b.translation})` : ""}`);
    return [`Хук: ${st.hook_overlay}`, "", ...lines].join("\n");
  }
  if (script.kind === "edu") return script.data.scenes.map((sc) => `• [${sc.kind}] ${sc.headline} — ${sc.voice}`).join("\n");
  return `🧵 Threads:\n${script.data.threads_post}\n\n✈️ Telegram:\n${script.data.telegram_post}`;
}

async function notifyScript(id: string | null, title: string, script: AnyScript, cost: number, rewritten = false) {
  const link = id ? `${await siteUrl()}/app/content/?id=${id}` : "";
  await notifyAdmins({
    title,
    summary: `${rewritten ? "✏️ Сценарій переписано за вашим коментарем" : "📝 Новий сценарій на затвердження"} · $${cost.toFixed(3)}${link ? `\nВідкрити й затвердити: ${link}` : ""}`,
    details: scriptPreview(script),
  });
}

/** Writes scripts for the chosen ideas and queues them for the owner's approval. */
export async function writeScripts(s: FarmSettings, videoIdeas: StoredIdea[], textIdeas: StoredIdea[], log: Log): Promise<number> {
  let made = 0;
  const jobs: [StoredIdea, "video" | "text"][] = [...videoIdeas.map((i) => [i, "video"] as [StoredIdea, "video"]), ...textIdeas.map((i) => [i, "text"] as [StoredIdea, "text"])];
  for (const [stored, kind] of jobs) {
    const budget = new Budget(kind === "video" ? s.max_usd_per_video : s.max_usd_per_text);
    try {
      log(`▶ сценарій: ${stored.idea.title} [${kind === "text" ? "текст" : stored.idea.format}]`);
      const script: AnyScript =
        kind === "text"
          ? { kind: "text", data: await writeTextPost(s, budget, stored.idea) }
          : stored.idea.format === "story"
            ? { kind: "story", data: normalizeStory(await writeStory(s, budget, stored.idea)) }
            : { kind: "edu", data: normalizeScript(await writeScript(s, budget, stored.idea)) };
      const record = {
        idea_id: stored.id,
        kind,
        status: "script",
        title: stored.idea.title,
        script: { ...script.data, idea: stored.idea },
        cost_usd: round4(budget.spent),
        cost_breakdown: budget.lines,
      };
      const itemId = await saveItem(record);
      writeLocal(outDir(), `${stamp()}-${slug(stored.idea.title)}-script`, { item_id: itemId, ...record });
      await markIdea(stored.id, "used");
      await notifyScript(itemId, stored.idea.title, script, budget.spent);
      log(`  ✔ на затвердженні · $${budget.spent.toFixed(3)}`);
      made++;
    } catch (e) {
      log(`  ✖ ${(e as Error).message}`);
    }
  }
  return made;
}

/** Owner asked for changes ("script_rewrite" + review_note): rewrite and send back for approval. */
export async function rewriteRequested(s: FarmSettings, log: Log): Promise<number> {
  let done = 0;
  for (const item of await itemsWithStatus(["script_rewrite"])) {
    if (!(await claimItem(item.id, "script_rewrite", "rewriting"))) continue;
    const budget = new Budget(1);
    try {
      log(`✏️ переписую: ${item.title}`);
      const { idea, ...raw } = item.script as { idea?: Idea } & Record<string, unknown>;
      const next = await rewriteWithNote(s, budget, detectScript(raw), item.review_note ?? "");
      await updateItem(item.id, {
        status: "script",
        script: { ...next.data, idea },
        cost_usd: round4(Number(item.cost_usd) + budget.spent),
        cost_breakdown: [...(item.cost_breakdown ?? []), ...budget.lines],
      });
      await notifyScript(item.id, item.title, next, budget.spent, true);
      done++;
    } catch (e) {
      await updateItem(item.id, { status: "script_rewrite" });
      log(`  ✖ ${(e as Error).message}`);
    }
  }
  return done;
}

// ───────────────────────── Stage 2: media from approved scripts ─────────────────────────

async function eduMedia(s: FarmSettings, budget: Budget, script: Script, dir: string, log: Log): Promise<RenderProps> {
  let imagesLeft = s.ai_images_per_video;
  const audio: SceneAudio[] = [];
  for (const [i, scene] of script.scenes.entries()) {
    const a: SceneAudio = { voice_src: null, voice_seconds: null, reveal_src: null, reveal_seconds: null, image_src: null };
    // Sílі hosts the edu rubrics, so he voices them.
    const v = await trySpeak(s, budget, scene.voice, path.join(dir, `s${i}`), log, "seal");
    if (v) Object.assign(a, { voice_src: rel(v.file), voice_seconds: v.seconds });
    if (scene.kind === "quiz" && scene.reveal_voice) {
      const r = await trySpeak(s, budget, scene.reveal_voice, path.join(dir, `s${i}r`), log, "seal");
      if (r) Object.assign(a, { reveal_src: rel(r.file), reveal_seconds: r.seconds });
    }
    if (scene.background === "image" && scene.image_prompt && imagesLeft > 0) {
      a.image_src = await tryDraw(s, budget, { prompt: scene.image_prompt, withSeal: false }, path.join(dir, `s${i}.jpg`), log);
      if (a.image_src) imagesLeft--;
    }
    audio.push(a);
  }
  // A half-voiced video is worse than none: if TTS broke mid-way, drop voice entirely.
  if (ttsDown) for (const a of audio) Object.assign(a, { voice_src: null, voice_seconds: null, reveal_src: null, reveal_seconds: null });
  return buildRenderProps(script, audio, pickMusic(script.music_mood));
}

async function storyMedia(s: FarmSettings, budget: Budget, story: Story, dir: string, log: Log): Promise<StoryProps> {
  // Voice: each line gets the same speaker's neighbouring lines as context, so one character
  // keeps one consistent intonation across the dialogue.
  const media: BeatMedia[] = [];
  for (const [i, beat] of story.beats.entries()) {
    const same = story.beats.map((b, j) => ({ b, j })).filter(({ b }) => b.speaker === beat.speaker);
    const at = same.findIndex(({ j }) => j === i);
    const context = { previous: same[at - 1]?.b.narration, next: same[at + 1]?.b.narration };
    const spoken = beat.spoken.trim() || beat.narration;
    const v = await trySpeak(s, budget, spoken, path.join(dir, `b${i}`), log, beat.speaker, beat.delivery, context, {
      speed: beat.speed || 1,
      display: beat.narration,
    });
    media.push({ voice_src: v ? rel(v.file) : null, voice_seconds: v?.seconds ?? null, words: v?.words ?? null });
  }
  if (ttsDown) for (const m of media) Object.assign(m, { voice_src: null, voice_seconds: null, words: null });

  // One generated background per location (Sílі is composited on top); then find the talking
  // background character's head so the camera frames them and bubbles stay off their face.
  const images: (string | null)[] = story.locations.map(() => null);
  const heads: RenderLocation["npc_head"][] = story.locations.map(() => null);
  const queue = story.locations.slice(0, s.images_per_story).map((loc, i) => ({ loc, i }));
  log(`  локацій: ${story.locations.length}`);
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const side = story.beats.find((b) => b.location === job.i && b.seal_visible)?.seal_side;
        const prompt = `${job.loc.prompt}${side ? `. Keep the ${side} foreground (lower ${side} third) empty floor space for a character to stand` : ""}`;
        const file = path.join(dir, `loc${job.i}.jpg`);
        images[job.i] = await tryDraw(s, budget, { prompt, withSeal: false, style: story.visual_style }, file, log);
        if (images[job.i] && job.loc.npc_side !== "none") heads[job.i] = await locateHead(s, budget, file, job.loc.prompt, job.loc.npc_side);
      }
    }),
  );
  return buildStoryProps(story, media, images, pickMusic(story.music_mood), 30, heads);
}

function captionsDigest(script: Script | Story) {
  const tags = script.hashtags.map((h) => `#${h}`).join(" ");
  return [
    `🎵 TikTok:\n${script.caption_tiktok}\n${tags}`,
    `📸 Instagram Reels:\n${script.caption_instagram}\n\n${tags}`,
    `🧵 Threads:\n${script.threads_post}`,
    `✈️ Telegram:\n${script.telegram_post}`,
    "sources" in script && script.sources ? `🔎 Джерела фактів (перевірте перед публікацією):\n${script.sources}` : "",
  ]
    .filter(Boolean)
    .join("\n\n— — —\n\n");
}

async function produceVideoItem(s: FarmSettings, item: ItemRow, log: Log) {
  const { idea, ...raw } = item.script as { idea?: Idea } & Record<string, unknown>;
  const script = detectScript(raw);
  if (script.kind === "text") throw new Error("очікувався сценарій відео");
  const budget = new Budget(s.max_usd_per_video);
  budget.spent = Number(item.cost_usd) || 0; // the script already cost something; the cap covers the whole video
  const id = `${stamp()}-${slug(item.title) || "video"}`;
  const dir = jobDir(id);
  try {
    log(`🎬 ${item.title}`);
    const props = script.kind === "story" ? await storyMedia(s, budget, script.data, dir, log) : await eduMedia(s, budget, script.data, dir, log);
    // The bundle snapshots the public dir, so it is built after this video's assets exist.
    log("  рендер…");
    const out = await renderVideo(await makeBundle(), props, outDir(), id);
    const videoPath = await upload(out.video, `videos/${id}.mp4`, "video/mp4");
    const coverPath = await upload(out.cover, `videos/${id}.jpg`, "image/jpeg");
    await updateItem(item.id, {
      status: "review",
      video_path: videoPath,
      cover_path: coverPath,
      duration_s: Math.round(out.seconds * 100) / 100,
      cost_usd: round4(budget.spent),
      cost_breakdown: [...(item.cost_breakdown ?? []), ...budget.lines],
    });
    writeLocal(outDir(), id, { item_id: item.id, script: script.data });
    const sent = await notifyAdmins({
      title: item.title,
      summary: `🎬 Відео готове · ${idea?.format ?? script.kind} · ${out.seconds.toFixed(0)} с · $${budget.spent.toFixed(3)}`,
      details: captionsDigest(script.data),
      videoFile: out.video,
    });
    log(`  ✔ ${out.video} · $${budget.spent.toFixed(3)}${sent ? " · надіслано в Telegram" : ""}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function produceTextItem(s: FarmSettings, item: ItemRow, log: Log) {
  const { idea, ...raw } = item.script as { idea?: Idea } & Record<string, unknown>;
  const post = raw as unknown as TextPost;
  const budget = new Budget(s.max_usd_per_text + (Number(item.cost_usd) || 0));
  budget.spent = Number(item.cost_usd) || 0;
  const id = `${stamp()}-${slug(item.title) || "post"}`;
  let imageFile: string | undefined;
  if (post.image_prompt && (await canDraw(s)) && budget.canAfford(frameCost(s, false))) {
    try {
      fs.mkdirSync(outDir(), { recursive: true });
      imageFile = path.join(outDir(), `${id}.jpg`);
      await drawFrame(s, budget, { prompt: post.image_prompt, withSeal: false, aspect: "4:5" }, imageFile);
    } catch (e) {
      imageFile = undefined;
      log(`  картинка пропущена: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  const imagePath = imageFile ? await upload(imageFile, `posts/${id}.jpg`, "image/jpeg") : null;
  await updateItem(item.id, { status: "review", image_path: imagePath, cost_usd: round4(budget.spent) });
  await notifyAdmins({
    title: item.title,
    summary: `✅ Пост готовий${idea?.trend ? ` · ${idea.trend}` : ""} · $${budget.spent.toFixed(3)}`,
    details: `🧵 Threads:\n${post.threads_post}\n\n— — —\n\n✈️ Telegram:\n${post.telegram_post}\n\n${HANDLES.telegram}`,
    imageFile,
  });
  log(`  ✔ пост · $${budget.spent.toFixed(3)}`);
}

/** Produces everything the owner approved. Safe to run often: items are claimed atomically. */
export async function produceApproved(s: FarmSettings, log: Log): Promise<number> {
  const items = await itemsWithStatus(["approved"], 5);
  if (!items.length) return 0;
  preparePublic();
  let made = 0;
  for (const item of items) {
    if (!(await claimItem(item.id, "approved", "rendering"))) continue;
    try {
      if (item.kind === "text") await produceTextItem(s, item, log);
      else await produceVideoItem(s, item, log);
      made++;
    } catch (e) {
      log(`  ✖ ${item.title}: ${(e as Error).message}`);
      await updateItem(item.id, { status: "failed", review_note: `Помилка виробництва: ${(e as Error).message.slice(0, 500)}` });
    }
  }
  return made;
}
