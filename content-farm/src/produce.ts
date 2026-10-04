// Two-stage production with the owner in the loop:
//   1) writePack — every 2 days: TikTok story + Stories edu video scripts + Threads/Telegram/Instagram
//      posts, saved as status "script" in one pack → owner edits/approves in the cabinet
//      (/app/content/) or asks for a rewrite with a note ("script_rewrite").
//   2) produceApproved — "approved" items → voices, images, render → storage → status "review".
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CTA_VOICE, HANDLES } from "./brand.ts";
import { driveAvailable, driveViewUrl, uploadToDrive, videoFolder } from "./drive.ts";
import { ROOT, type FarmSettings } from "./env.ts";
import { buildRenderProps, buildStoryProps, type BeatMedia, type SceneAudio } from "./layout.ts";
import { Budget } from "./llm.ts";
import { canDraw, drawFrame, frameCost, type FrameRequest } from "./media/images.ts";
import { locateHead } from "./media/locate.ts";
import { isTransient } from "./media/retry.ts";
import { speak, type Speech } from "./media/tts.ts";
import { notifyAdmins } from "./notify.ts";
import { jobDir, makeBundle, pickMusic, preparePublic, PUBLIC, renderIgCard, renderVideo } from "./render.ts";
import type { Channel, Idea, RenderLocation, RenderProps, Script, Speaker, Story, StoryProps } from "./schema.ts";
import {
  detectScript,
  normalizeScript,
  normalizeStory,
  refreshCaptions,
  rewriteWithNote,
  scriptMeta,
  writePostsBundle,
  writeScript,
  writeStory,
  type AnyScript,
  type ScriptMeta,
} from "./script.ts";
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

export const CHANNEL_LABEL: Record<Channel, string> = {
  tiktok: "🎵 TikTok — історія",
  stories: "📲 Stories — навчальне відео",
  threads: "🧵 Threads",
  telegram: "✈️ Telegram",
  instagram: "📸 Instagram",
};

/** Set by a voice failure that waiting won't fix (bad key, no credits) so the run stops asking per line. */
let ttsDown = false;
let voiceError = "";
/** Lines that should have been voiced and weren't — a video never ships silent or half-voiced. */
let voiceFailures = 0;
/** Set only by a failure that waiting won't fix (bad key, no credits); overloads are retried per picture. */
let imagesDown = false;
let imageError = "";
/** Pictures that were attempted and failed — a story must not ship with any of its locations missing. */
let imageFailures = 0;
/** Engines other than settings.tts_provider that voiced lines of the current video. */
const standInVoices = new Set<string>();
/** Posts are image-first: without the picture they must not be reported as ready. */
const noImage = () => new Error(`Не вдалося згенерувати картинку${imageError ? ` (${imageError})` : ""}. Перевірте баланс генератора зображень і затвердіть ще раз.`);

async function tryDraw(s: FarmSettings, budget: Budget, req: FrameRequest, file: string, log: Log): Promise<string | null> {
  if (imagesDown) {
    imageFailures++;
    return null;
  }
  if (!(await canDraw(s)) || !budget.canAfford(frameCost(s, req.withSeal) + 0.01)) return null;
  try {
    // drawFrame already waits out overloads (retries with backoff, then the full model).
    await drawFrame(s, budget, req, file);
    return rel(file);
  } catch (e) {
    imageFailures++;
    imageError = (e as Error).message.replace(/\s+/g, " ").slice(0, 220);
    log(`  ⚠ картинку не згенеровано: ${imageError.slice(0, 160)}`);
    if (!isTransient(e)) imagesDown = true;
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
  if (!text.trim()) return null;
  if (ttsDown) {
    voiceFailures++;
    return null;
  }
  try {
    // speak() already waits out rate limits and overloads (3 tries with backoff).
    const speech = await speak(s, budget, text, base, speaker, delivery, context, opts);
    if (speech.provider !== s.tts_provider) standInVoices.add(speech.provider);
    return speech;
  } catch (e) {
    voiceFailures++;
    voiceError = (e as Error).message.replace(/\s+/g, " ").slice(0, 220);
    log(`  ⚠ репліку не озвучено: ${voiceError.slice(0, 160)}`);
    if (!isTransient(e)) ttsDown = true;
    return null;
  }
}

/** Stops production before any picture or render is paid for when a line has no voice. */
function requireVoices(failedBefore: number, s: FarmSettings) {
  if (voiceFailures > failedBefore) {
    throw new Error(`Не вдалося озвучити репліки (${voiceError || `${s.tts_provider} недоступний`}). Готові репліки збережено в кеші.`);
  }
}

// ───────────────────────── Stage 1: scripts for approval ─────────────────────────

function scriptPreview(script: AnyScript): string {
  switch (script.kind) {
    case "story":
      return [
        `Хук: ${script.data.hook_overlay}`,
        "",
        ...script.data.beats.map(
          (b) => `${b.speaker === "narrator" ? "🎙" : b.speaker === "seal" ? "🦭" : "💬"} ${b.speaker_name || "Оповідач"}: ${b.narration}${b.translation ? `  (${b.translation})` : ""}`,
        ),
      ].join("\n");
    case "edu":
      return script.data.scenes.map((sc) => `• [${sc.kind}] ${sc.headline} — ${sc.voice}`).join("\n");
    case "threads":
      return script.data.text;
    case "telegram":
      return `${script.data.text}\n\n🖼 ${script.data.image_prompt}`;
    case "instagram":
      return `На картинці: ${script.data.image_headline}${script.data.image_sub ? ` / ${script.data.image_sub}` : ""}\n\n${script.data.caption}`;
    default:
      return `🧵 ${script.data.threads_post}\n\n✈️ ${script.data.telegram_post}`;
  }
}

export const warningLines = (warnings: string[]) => warnings.map((w) => `\n⚠ ${w}`).join("");

async function notifyScript(id: string | null, title: string, script: AnyScript, cost: number, rewritten = false, warnings: string[] = []) {
  const link = id ? `${await siteUrl()}/app/content/?id=${id}` : "";
  await notifyAdmins({
    title,
    summary: `${rewritten ? "✏️ Переписано за вашим коментарем" : "📝 Новий сценарій на затвердження"} · $${cost.toFixed(3)}${link ? `\nВідкрити: ${link}` : ""}${warningLines(warnings)}`,
    details: scriptPreview(script),
  });
}

interface PackIdeas {
  story: StoredIdea | null;
  edu: StoredIdea | null;
  posts: StoredIdea[];
}

/** Picks the pack's ideas from ranked ideas: best story, best edu idea, then three for the posts. */
export function pickPackIdeas(ideas: StoredIdea[]): PackIdeas {
  const story = ideas.find((i) => i.idea.format === "story") ?? null;
  const edu = ideas.find((i) => i.idea.format !== "story") ?? null;
  const rest = ideas.filter((i) => i !== story && i !== edu);
  const posts = [...rest.filter((i) => i.idea.text_post_ok), ...rest.filter((i) => !i.idea.text_post_ok)].slice(0, 3);
  return { story, edu, posts };
}

export async function saveScriptItem(
  s: FarmSettings,
  packId: string,
  channel: Channel,
  title: string,
  stored: StoredIdea | null,
  data: Record<string, unknown>,
  budget: Budget,
  kind: "video" | "text",
) {
  const record = {
    idea_id: stored?.id ?? null,
    pack_id: packId,
    channel,
    kind,
    status: "script",
    title,
    script: { ...data, idea: stored?.idea, ...(kind === "video" ? { _meta: scriptMeta(detectScript(data)) } : {}) },
    cost_usd: round4(budget.spent),
    cost_breakdown: budget.lines,
  };
  const id = await saveItem(record);
  writeLocal(outDir(), `${stamp()}-${channel}-${slug(title)}`, { item_id: id, ...record });
  if (stored) await markIdea(stored.id, "used");
  return id;
}

/** Writes one pack (2 video scripts + 3 posts) and sends the owner one Telegram message with the link. */
export async function writePack(s: FarmSettings, ideas: PackIdeas, log: Log, warnings: string[] = []): Promise<number> {
  const packId = randomUUID();
  const made: string[] = [];
  const notes: string[] = [];
  let total = 0;

  const video = async (channel: "tiktok" | "stories", stored: StoredIdea | null) => {
    if (!stored) return log(`  ⚠ немає ідеї для ${CHANNEL_LABEL[channel]}`);
    const budget = new Budget(s.max_usd_per_video);
    try {
      log(`▶ ${CHANNEL_LABEL[channel]}: ${stored.idea.title}`);
      const data =
        channel === "tiktok"
          ? normalizeStory(await writeStory(s, budget, stored.idea))
          : normalizeScript(await writeScript(s, budget, stored.idea));
      await saveScriptItem(s, packId, channel, stored.idea.title, stored, data as unknown as Record<string, unknown>, budget, "video");
      made.push(CHANNEL_LABEL[channel]);
    } catch (e) {
      log(`  ✖ ${(e as Error).message}`);
    }
    notes.push(...budget.notes.map((n) => `${CHANNEL_LABEL[channel]}: ${n}`));
    total += budget.spent;
  };
  await video("tiktok", ideas.story);
  // The Stories slot is for the edu rubrics (quiz, wrong/right…); a story idea is reformatted if that's all we have.
  await video("stories", ideas.edu ? ideas.edu : ideas.story && { ...ideas.story, idea: { ...ideas.story.idea, format: "quiz" } });

  if (ideas.posts.length) {
    const budget = new Budget(s.max_usd_per_text * 3);
    try {
      log(`▶ пости Threads / Telegram / Instagram`);
      const bundle = await writePostsBundle(s, budget, ideas.posts.map((p) => p.idea));
      const share = new Budget(Infinity);
      share.add("posts_share", budget.spent / 3);
      const titleOf = (text: string) => text.split("\n")[0].replace(/[*_#]/g, "").slice(0, 80) || "Пост";
      await saveScriptItem(s, packId, "threads", titleOf(bundle.threads.text), null, { channel: "threads", ...bundle.threads }, share, "text");
      await saveScriptItem(s, packId, "telegram", titleOf(bundle.telegram.text), null, { channel: "telegram", ...bundle.telegram }, share, "text");
      await saveScriptItem(s, packId, "instagram", bundle.instagram.image_headline, null, { channel: "instagram", ...bundle.instagram }, share, "text");
      for (const p of ideas.posts) await markIdea(p.id, "used");
      made.push(CHANNEL_LABEL.threads, CHANNEL_LABEL.telegram, CHANNEL_LABEL.instagram);
    } catch (e) {
      log(`  ✖ пости: ${(e as Error).message}`);
    }
    notes.push(...budget.notes.map((n) => `пости: ${n}`));
    total += budget.spent;
  }

  if (made.length) {
    await notifyAdmins({
      title: "Новий контент-пакет",
      summary: `📦 Пакет на затвердження: ${made.length} матеріалів · $${total.toFixed(2)}\nВідкрити: ${await siteUrl()}/app/content/${warningLines([...warnings, ...notes])}`,
      details: made.map((m) => `• ${m}`).join("\n"),
    });
  }
  log(`Пакет ${packId}: ${made.length} матеріалів · $${total.toFixed(3)}`);
  return made.length;
}

/** One-off video scripts on a given topic (`custom`), outside packs. */
export async function writeScripts(s: FarmSettings, videoIdeas: StoredIdea[], log: Log, warnings: string[] = []): Promise<number> {
  let made = 0;
  for (const stored of videoIdeas) {
    const budget = new Budget(s.max_usd_per_video);
    try {
      log(`▶ сценарій: ${stored.idea.title} [${stored.idea.format}]`);
      const channel: Channel = stored.idea.format === "story" ? "tiktok" : "stories";
      const script: AnyScript =
        channel === "tiktok"
          ? { kind: "story", data: normalizeStory(await writeStory(s, budget, stored.idea)) }
          : { kind: "edu", data: normalizeScript(await writeScript(s, budget, stored.idea)) };
      const id = await saveScriptItem(s, randomUUID(), channel, stored.idea.title, stored, script.data as unknown as Record<string, unknown>, budget, "video");
      await notifyScript(id, stored.idea.title, script, budget.spent, false, [...warnings, ...budget.notes]);
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
      const { idea, channel, ...raw } = item.script as { idea?: Idea; channel?: string } & Record<string, unknown>;
      const next = await rewriteWithNote(s, budget, detectScript({ ...raw, channel }), item.review_note ?? "");
      await updateItem(item.id, {
        status: "script",
        script: { ...(channel ? { channel } : {}), ...next.data, idea, ...(scriptMeta(next) ? { _meta: scriptMeta(next) } : {}) },
        cost_usd: round4(Number(item.cost_usd) + budget.spent),
        cost_breakdown: [...(item.cost_breakdown ?? []), ...budget.lines],
      });
      await notifyScript(item.id, item.title, next, budget.spent, true, budget.notes);
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
  const voiceFailedBefore = voiceFailures;
  for (const [i, scene] of script.scenes.entries()) {
    const a: SceneAudio = { voice_src: null, voice_seconds: null, reveal_src: null, reveal_seconds: null, image_src: null };
    // Sílі hosts the edu rubrics, so he voices them.
    // The CTA line is fixed brand-wide (site first, then the Telegram bot); scripts that already
    // say both keep their wording, older ones that only named the bot get the standard line.
    if (scene.kind === "cta" && !(/сайт/i.test(scene.voice) && /телеграм|telegram/i.test(scene.voice))) scene.voice = CTA_VOICE;
    const v = await trySpeak(s, budget, scene.voice, path.join(dir, `s${i}`), log, "seal");
    if (v) Object.assign(a, { voice_src: rel(v.file), voice_seconds: v.seconds });
    if (scene.kind === "quiz" && scene.reveal_voice) {
      const r = await trySpeak(s, budget, scene.reveal_voice, path.join(dir, `s${i}r`), log, "seal");
      if (r) Object.assign(a, { reveal_src: rel(r.file), reveal_seconds: r.seconds });
    }
    audio.push(a);
  }
  requireVoices(voiceFailedBefore, s);
  for (const [i, scene] of script.scenes.entries()) {
    if (scene.background === "image" && scene.image_prompt && imagesLeft > 0) {
      audio[i].image_src = await tryDraw(s, budget, { prompt: scene.image_prompt, withSeal: false }, path.join(dir, `s${i}.jpg`), log);
      if (audio[i].image_src) imagesLeft--;
    }
  }
  // One backdrop for the whole video, so it reads as a scene in the feed rather than a slide deck.
  const backdrop = script.backdrop_prompt
    ? await tryDraw(s, budget, { prompt: `${script.backdrop_prompt}. Keep the lower-left area calm and uncluttered`, withSeal: false }, path.join(dir, "backdrop.jpg"), log)
    : null;
  // Scripts without their own backdrop: stretch the first scene picture over the whole video
  // instead of dropping back to the plain brand background after one scene.
  const fallback = backdrop ? null : (audio.find((a) => a.image_src)?.image_src ?? null);
  // The picture now lives in the shared backdrop; drawing it again per scene would change the dimming.
  if (fallback) for (const a of audio) if (a.image_src === fallback) a.image_src = null;
  return buildRenderProps(script, audio, pickMusic(script.music_mood), 30, backdrop ?? fallback);
}

async function storyMedia(s: FarmSettings, budget: Budget, story: Story, dir: string, log: Log): Promise<StoryProps> {
  // Voice: each line gets the same speaker's neighbouring lines as context, so one character
  // keeps one consistent intonation across the dialogue.
  const media: BeatMedia[] = [];
  const voiceFailedBefore = voiceFailures;
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
  requireVoices(voiceFailedBefore, s);

  // One generated background per location (Sílі is composited on top); then find the talking
  // background character's head so the camera frames them and bubbles stay off their face.
  const images: (string | null)[] = story.locations.map(() => null);
  const heads: RenderLocation["npc_head"][] = story.locations.map(() => null);
  const queue = story.locations.slice(0, s.images_per_story).map((loc, i) => ({ loc, i }));
  log(`  локацій: ${story.locations.length}`);
  const failedBefore = imageFailures;
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
  // A story is a scene: Sílі on the brand gradient instead of the café is not the video the owner
  // approved. Stop before the render; the voices and the finished locations stay in the cache.
  if (imageFailures > failedBefore) {
    throw new Error(
      `Не вдалося згенерувати фони локацій (${imageError || "генератор недоступний"}). Затвердіть ще раз: голоси й готові фони вже збережено, повтор коштує лише відсутні фони.`,
    );
  }
  return buildStoryProps(story, media, images, pickMusic(story.music_mood), 30, heads);
}

function captionsDigest(script: Script | Story) {
  const tags = script.hashtags.map((h) => `#${h}`).join(" ");
  return [
    `🎵 TikTok:\n${script.caption_tiktok}\n${tags}`,
    `📸 Instagram Reels:\n${script.caption_instagram}\n\n${tags}`,
    "sources" in script && script.sources ? `🔎 Джерела фактів (перевірте перед публікацією):\n${script.sources}` : "",
  ]
    .filter(Boolean)
    .join("\n\n— — —\n\n");
}

async function produceVideoItem(s: FarmSettings, item: ItemRow, log: Log) {
  const { idea, _meta, ...raw } = item.script as { idea?: Idea; _meta?: ScriptMeta } & Record<string, unknown>;
  const script = detectScript(raw);
  if (script.kind !== "story" && script.kind !== "edu") throw new Error("очікувався сценарій відео");
  // The cap applies to each production run; the item's cost_usd keeps the running total
  // (script + every regeneration), so repeated regenerations never starve a run of its budget.
  const budget = new Budget(s.max_usd_per_video);
  const before = Number(item.cost_usd) || 0;
  const id = `${stamp()}-${slug(item.title) || "video"}`;
  const dir = jobDir(id);
  try {
    log(`🎬 ${item.title}`);
    // Lines edited by hand since the farm wrote the script: bring its own captions in line first.
    const fixed = _meta ? await refreshCaptions(s, budget, script, _meta).catch(() => null) : null;
    if (fixed) {
      Object.assign(script.data, fixed);
      await updateItem(item.id, { script: { ...script.data, idea, _meta: scriptMeta(script) } });
      log(`  підписи узгоджено з новими репліками: ${Object.keys(fixed).join(", ")}`);
    }
    standInVoices.clear();
    const props = script.kind === "story" ? await storyMedia(s, budget, script.data, dir, log) : await eduMedia(s, budget, script.data, dir, log);
    const voiceNote = standInVoices.size ? `\n⚠ Частину реплік озвучив запасний голос (${[...standInVoices].join(", ")}) — ${s.tts_provider} був недоступний` : "";
    // The bundle snapshots the public dir, so it is built after this video's assets exist.
    log("  рендер…");
    const out = await renderVideo(await makeBundle(), props, outDir(), id);
    // The video goes to Google Drive (a re-render replaces the same file, so its link stays);
    // the Supabase bucket is the fallback, so a Drive hiccup never loses a finished render.
    let driveId: string | null = null;
    if (await driveAvailable()) {
      driveId = await uploadToDrive(s, out.video, `${id}.mp4`, "video/mp4", videoFolder(), item.drive_file_id).catch((e) => {
        log(`  ⚠ Google Drive не прийняв відео (${(e as Error).message.slice(0, 120)}) — кладу в Supabase`);
        return null;
      });
    }
    const videoPath = driveId ? null : await upload(out.video, `videos/${id}.mp4`, "video/mp4");
    const coverPath = await upload(out.cover, `videos/${id}.jpg`, "image/jpeg");
    await updateItem(item.id, {
      status: "review",
      attempts: 0,
      review_note: null,
      video_path: videoPath,
      drive_file_id: driveId,
      cover_path: coverPath,
      duration_s: Math.round(out.seconds * 100) / 100,
      cost_usd: round4(before + budget.spent),
      cost_breakdown: [...(item.cost_breakdown ?? []), ...budget.lines],
    });
    const note = {
      title: item.title,
      summary: `🎬 Відео готове · ${idea?.format ?? script.kind} · ${out.seconds.toFixed(0)} с · цей запуск $${budget.spent.toFixed(3)}, разом $${(before + budget.spent).toFixed(3)}${voiceNote}`,
      details: [captionsDigest(script.data), driveId ? `📁 Google Drive:\n${driveViewUrl(driveId)}` : ""].filter(Boolean).join("\n\n— — —\n\n"),
    };
    // The video is already saved and marked ready; a Telegram hiccup (bots can't upload files over
    // 50 MB) must not turn it into a failed item — fall back to a link to the cabinet.
    const sent = await notifyAdmins({ ...note, videoFile: out.video }).catch(async (e) => {
      log(`  ⚠ відео не надіслано в Telegram (${(e as Error).message.slice(0, 120)}) — надсилаю посилання`);
      const link = `${await siteUrl()}/app/content/?id=${item.id}`;
      return notifyAdmins({ ...note, summary: `${note.summary}
Відео завелике для Telegram, дивіться в кабінеті: ${link}` }).catch(() => false);
    });
    log(`  ✔ ${out.video} · $${budget.spent.toFixed(3)}${sent ? " · надіслано в Telegram" : ""}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Posts: Threads needs nothing; Telegram gets an illustration; Instagram gets a rendered card. */
async function producePostItem(s: FarmSettings, item: ItemRow, log: Log) {
  const { idea: _idea, ...raw } = item.script as { idea?: Idea } & Record<string, unknown>;
  void _idea;
  const script = detectScript(raw);
  const budget = new Budget(s.max_usd_per_text + (Number(item.cost_usd) || 0));
  budget.spent = Number(item.cost_usd) || 0;
  const id = `${stamp()}-${item.channel ?? "post"}-${slug(item.title) || "post"}`;
  let imageFile: string | undefined;
  const dir = jobDir(id);
  try {
    if (script.kind === "telegram" || script.kind === "text") {
      const prompt = script.data.image_prompt;
      if (prompt) {
        const src = await tryDraw(s, budget, { prompt, withSeal: false, aspect: "4:5" }, path.join(dir, "img.jpg"), log);
        if (!src) throw noImage();
        imageFile = path.join(PUBLIC, src);
      }
    } else if (script.kind === "instagram") {
      const bg = await tryDraw(s, budget, { prompt: script.data.image_prompt, withSeal: false, aspect: "4:5" }, path.join(dir, "bg.jpg"), log);
      if (!bg) throw noImage();
      imageFile = path.join(dir, "card.jpg");
      await renderIgCard(await makeBundle(), { image_src: bg, headline: script.data.image_headline, sub: script.data.image_sub, handle: HANDLES.instagram }, imageFile);
    }
    const imagePath = imageFile ? await upload(imageFile, `posts/${id}.jpg`, "image/jpeg") : null;
    await updateItem(item.id, {
      status: "review",
      attempts: 0,
      review_note: null,
      image_path: imagePath,
      cost_usd: round4(budget.spent),
      cost_breakdown: [...(item.cost_breakdown ?? []), ...budget.lines],
    });
    await notifyAdmins({
      title: item.title,
      summary: `✅ Готово: ${CHANNEL_LABEL[(item.channel as Channel) ?? "telegram"] ?? "пост"} · $${budget.spent.toFixed(3)}`,
      details: scriptPreview(script),
      imageFile,
    }).catch((e) => log(`  ⚠ не надіслано в Telegram: ${(e as Error).message.slice(0, 120)}`));
    log(`  ✔ ${item.channel} · $${budget.spent.toFixed(3)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Produces everything the owner approved. Safe to run often: items are claimed atomically. */
export async function produceApproved(s: FarmSettings, log: Log): Promise<number> {
  const items = await itemsWithStatus(["approved"], 8);
  if (!items.length) return 0;
  preparePublic();
  let made = 0;
  for (const item of items) {
    if (!(await claimItem(item.id, "approved", "rendering"))) continue;
    try {
      if (item.kind === "text") await producePostItem(s, item, log);
      else await produceVideoItem(s, item, log);
      made++;
    } catch (e) {
      const reason = (e as Error).message.slice(0, 500);
      const attempt = (item.attempts ?? 0) + 1;
      // The in-run retries cover a minute or two; an outage that outlasts them is waited out
      // across runs: the item goes back to the queue, and the asset cache keeps what is done.
      if (isTransient(e) && attempt < s.production_attempts) {
        log(`  ↻ ${item.title}: спроба ${attempt} з ${s.production_attempts} не вдалася — повторю на наступному запуску (${reason.slice(0, 160)})`);
        await updateItem(item.id, { status: "approved", attempts: attempt, review_note: `Спроба ${attempt} з ${s.production_attempts} не вдалася, повторю автоматично: ${reason}` });
        continue;
      }
      log(`  ✖ ${item.title}: ${reason}`);
      await updateItem(item.id, { status: "failed", attempts: attempt, review_note: `Помилка виробництва: ${reason}` });
      // An approved item that silently never arrives looks like a hung farm — say what happened.
      await notifyAdmins({
        title: item.title,
        summary: `❌ Не вдалося виробити: ${reason}\nВідкрити: ${await siteUrl()}/app/content/?id=${item.id}`,
        details: "",
      }).catch(() => undefined);
    }
  }
  return made;
}
