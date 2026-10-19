// Lesson transcription (killer feature): the teacher's browser uploads the lesson audio as two tracks
// (t = teacher mic, s = Meet tab = students) in 10-minute chunks; this function turns them into one
// speaker-labelled transcript with an OpenAI-compatible speech-to-text API (Groq Whisper by default —
// the cheapest option), deletes the audio and asks ai-lesson to draft the summary in the background.
// Whisper can't tell voices apart, so in group lessons every student is one "УЧНІ". With an AssemblyAI key
// the students' track of group lessons goes there instead and is split by voice into "УЧЕНЬ 1/2/…".
//   POST {action:"transcribe", lesson_id}              (teacher / staff JWT) → { duration_sec, auto_summary }
//   POST {action:"status"}                             (admin) → speech-to-text settings
//   POST {action:"save_key", provider, key}            (admin) → validates and stores the key in Vault
//   POST {action:"remove_key"}                         (admin)
//   POST {action:"save_diarize_key", key}              (admin) → AssemblyAI key for group lessons' students
//   POST {action:"remove_diarize_key"}                 (admin)
import {
  admin, functionsUrl, getSecret, getSetting, handle, HttpError, isStaff, json, logError, readJson, requireUser, setSecret, setSetting,
} from "../_shared/core.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

interface SttProvider {
  label: string;
  base_url: string;
  model: string;
  usd_per_hour: number;
}
const PROVIDERS: Record<string, SttProvider> = {
  groq: { label: "Groq (Whisper large v3 turbo)", base_url: "https://api.groq.com/openai/v1", model: "whisper-large-v3-turbo", usd_per_hour: 0.04 },
  openai: { label: "OpenAI (Whisper)", base_url: "https://api.openai.com/v1", model: "whisper-1", usd_per_hour: 0.36 },
};
const BUCKET = "lesson-audio";
const PROMPT = "Online English lesson for Ukrainian teenagers. The teacher mixes Ukrainian and English. Vocabulary, grammar, homework.";
// Whisper's classic hallucinations on silence.
const JUNK = /^(thank you( for watching)?\.?|thanks for watching!?|subtitles by.*|продовження слідує.*|дякую за перегляд.*|редактор субтитрів.*|\.+|you)$/i;

async function sttConfig(): Promise<{ provider: string; cfg: SttProvider; key: string | null }> {
  const saved = (await getSetting<{ provider?: string }>("stt_settings")) ?? {};
  const provider = saved.provider && PROVIDERS[saved.provider] ? saved.provider : "groq";
  return { provider, cfg: PROVIDERS[provider], key: await getSecret("stt_api_key") };
}

// Speaker separation for the students' track (AssemblyAI). Ukrainian is only on Universal-2, which can also
// switch between Ukrainian and English inside one file. $0.15/h + $0.02/h for speaker labels.
const AAI = "https://api.assemblyai.com/v2";
const AAI_MODEL = "universal-2";
const AAI_USD_PER_HOUR = 0.17;
const DIARIZE_KEY = "stt_diarize_api_key";

async function requireAdmin(req: Request) {
  const { profile } = await requireUser(req, ["admin"]);
  return profile;
}

// ───────────── transcribe ─────────────
/** spk: student number within one file (diarized students' track only); chunk: that file's start offset. */
interface Line { t: number; who: "t" | "s"; text: string; spk?: number; chunk?: number }
interface Part { lines: Line[]; seconds: number; diarized: boolean }
/** deadline: after it the students' file falls back to Whisper so the teacher's request doesn't time out. */
interface Diarize { key: string; maxSpeakers: number | null; deadline: number }

async function transcribeFile(cfg: SttProvider, key: string, path: string, diarize: Diarize | null): Promise<Part> {
  const [, track, , offsetRaw] = path.split("/").pop()!.replace(/\.webm$/, "").match(/^([ts])-(\d+)-(\d+)$/) ?? [];
  if (!track) return { lines: [], seconds: 0, diarized: false };
  const offset = Number(offsetRaw) || 0;
  const { data: blob, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !blob) throw new Error(`download ${path}: ${error?.message}`);
  if (blob.size < 2000) return { lines: [], seconds: 0, diarized: false }; // header only — nothing recorded

  if (track === "s" && diarize) {
    try {
      const { segments, seconds } = await diarizeBlob(diarize, blob);
      // Speaker ids are only stable within one file, so number them by first appearance per file.
      const ids = new Map<string, number>();
      const lines = segments.map((s): Line => {
        if (s.speaker && !ids.has(s.speaker)) ids.set(s.speaker, ids.size + 1);
        return { t: offset + s.start, who: "s", text: s.text, spk: s.speaker ? ids.get(s.speaker) : undefined, chunk: offset };
      });
      return { lines, seconds, diarized: true };
    } catch (e) {
      // The diarizer is an extra: if it fails, the students' track still gets the usual Whisper text.
      await logError("ai-transcribe:diarize", e, { path });
    }
  }
  const { segments, seconds } = await whisper(cfg, key, blob);
  return { lines: segments.map((s) => ({ t: offset + s.start, who: track as "t" | "s", text: s.text })), seconds, diarized: false };
}

interface Segment { start: number; text: string; speaker?: string }

async function whisper(cfg: SttProvider, key: string, blob: Blob): Promise<{ segments: Segment[]; seconds: number }> {
  const form = new FormData();
  form.append("file", new File([blob], "audio.webm", { type: "audio/webm" }));
  form.append("model", cfg.model);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  form.append("prompt", PROMPT);
  const res = await fetch(`${cfg.base_url}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 401 || res.status === 403) throw new HttpError(409, "Сервіс розшифровки не прийняв ключ — перевірте його в Інтеграціях");
    if (res.status === 429) throw new HttpError(429, "Сервіс розшифровки перевантажений або вичерпано ліміт. Спробуйте за кілька хвилин.");
    throw new Error(`stt ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const segments: Segment[] = [];
  for (const s of (data.segments ?? []) as Any[]) {
    const text = String(s.text ?? "").trim();
    if (!text || JUNK.test(text)) continue;
    if ((s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -0.8) continue; // silence the model "heard" words in
    segments.push({ start: Number(s.start ?? 0), text });
  }
  return { segments, seconds: Number(data.duration ?? 0) };
}

/** One file of the students' track → AssemblyAI (upload, submit, poll) → utterances with per-file speaker letters. Throws on any failure. */
async function diarizeBlob(d: Diarize, blob: Blob): Promise<{ segments: Segment[]; seconds: number }> {
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${AAI}${path}`, { ...init, headers: { authorization: d.key, ...init.headers }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`assemblyai ${path.split("/")[1]} ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
    return res.json();
  };
  const { upload_url } = await call("/upload", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: blob });
  const { id } = await call("/transcript", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      audio_url: upload_url,
      speech_models: [AAI_MODEL],
      language_detection: true,
      language_detection_options: { expected_languages: ["uk", "en"], code_switching: true },
      speaker_labels: true,
      ...(d.maxSpeakers ? { speaker_options: { max_speakers_expected: d.maxSpeakers } } : {}),
    }),
  });
  try {
    let t: Any;
    for (;;) {
      t = await call(`/transcript/${id}`);
      if (t.status === "completed") break;
      if (t.status === "error") throw new Error(`assemblyai: ${t.error}`);
      if (Date.now() > d.deadline) throw new Error("assemblyai: not finished in time");
      await new Promise((r) => setTimeout(r, 3000));
    }
    const segments: Segment[] = [];
    for (const u of (t.utterances ?? []) as Any[]) {
      const text = String(u.text ?? "").replace(/\s+/g, " ").trim();
      if (text) segments.push({ start: Number(u.start ?? 0) / 1000, text, speaker: u.speaker ? String(u.speaker) : undefined });
    }
    return { segments, seconds: Number(t.audio_duration ?? 0) };
  } finally {
    // Like our own storage: the audio and text don't stay at AssemblyAI once we have them.
    await fetch(`${AAI}/transcript/${id}`, { method: "DELETE", headers: { authorization: d.key } }).then((r) => r.body?.cancel()).catch(() => {});
  }
}

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
const speaker = (l: Line) => (l.who === "t" ? "ВИКЛАДАЧ" : l.spk ? `УЧЕНЬ ${l.spk}` : "УЧНІ");

/**
 * Interleaves both tracks by time and merges consecutive lines of the same speaker. Student numbers restart
 * with every 10-minute file, so a marker line shows where the numbering changes.
 */
function merge(lines: Line[]): string {
  lines.sort((a, b) => a.t - b.t);
  const out: string[] = [];
  let last: (Line & { label: string }) | null = null;
  let chunk: number | undefined;
  const flush = () => last && out.push(`[${mmss(last.t)}] ${last.label}: ${last.text}`);
  for (const l of lines) {
    if (l.chunk !== undefined) {
      if (chunk !== undefined && l.chunk !== chunk) {
        flush();
        last = null;
        out.push(`[${mmss(l.chunk)}] ── новий фрагмент запису: номери учнів далі визначено заново ──`);
      }
      chunk = l.chunk;
    }
    const label = speaker(l);
    if (last && last.label === label && last.chunk === l.chunk && l.t - last.t < 60) last.text += ` ${l.text}`;
    else {
      flush();
      last = { ...l, label };
    }
  }
  flush();
  return out.join("\n");
}

async function pool<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }));
  return out;
}

async function transcribe(req: Request, lessonId: string) {
  const { profile } = await requireUser(req, ["teacher", "manager", "admin"]);
  const { data: lesson } = await admin.from("lessons").select("id, teacher_id, kind, group_id").eq("id", lessonId).maybeSingle();
  if (!lesson) throw new HttpError(404, "Урок не знайдено");
  if (!isStaff(profile) && lesson.teacher_id !== profile.id) throw new HttpError(403, "Це не ваш урок");

  const { cfg, key } = await sttConfig();
  if (!key) throw new HttpError(409, "Розшифровку не налаштовано (Налаштування → Інтеграції)");

  const { data: files, error } = await admin.storage.from(BUCKET).list(lessonId, { limit: 1000 });
  if (error) throw error;
  const paths = (files ?? []).filter((f) => f.name.endsWith(".webm")).map((f) => `${lessonId}/${f.name}`);
  if (!paths.length) throw new HttpError(422, "Запису для цього уроку немає");

  // Separating students only makes sense when there are several of them: group lessons only.
  let diarize: Diarize | null = null;
  const diarizeKey = lesson.group_id ? await getSecret(DIARIZE_KEY) : null;
  if (diarizeKey) {
    const { count } = await admin.from("group_members").select("student_id", { count: "exact", head: true }).eq("group_id", lesson.group_id);
    // +1 for a stray voice (a video played in the call); 0 or 1 known students → let the model decide.
    diarize = { key: diarizeKey, maxSpeakers: count && count > 1 ? count + 1 : null, deadline: Date.now() + 100_000 };
  }

  await admin.from("lesson_transcripts").upsert({ lesson_id: lessonId, status: "processing", error: null, created_by: profile.id });
  try {
    // AssemblyAI works asynchronously on its side, so all students' files go at once; Groq keeps its pool of 4.
    const isStudents = (p: string) => /\/s-[^/]*$/.test(p);
    const parts = diarize
      ? (await Promise.all([
        pool(paths.filter((p) => !isStudents(p)), 4, (p) => transcribeFile(cfg, key, p, null)),
        pool(paths.filter(isStudents), 8, (p) => transcribeFile(cfg, key, p, diarize)),
      ])).flat()
      : await pool(paths, 4, (p) => transcribeFile(cfg, key, p, null));
    const lines = parts.flatMap((p) => p.lines);
    const duration = Math.round(Math.max(0, ...lines.map((l) => l.t)) + 5);
    if (!lines.length) throw new HttpError(422, "У записі не вдалося розпізнати мову. Перевірте, що при старті запису було вибрано вкладку Meet зі звуком.");

    await admin.from("lesson_transcripts").update({ status: "ready", text: merge(lines), duration_sec: duration, error: null }).eq("lesson_id", lessonId);
    const usage = (model: string, usdPerHour: number, seconds: number) => ({
      user_id: profile.id, feature: "transcribe", model, input_tokens: 0, output_tokens: 0,
      cost_usd: Number(((seconds / 3600) * usdPerHour).toFixed(6)), ref_id: lessonId,
    });
    const secs = (diarized: boolean) => parts.filter((p) => p.diarized === diarized).reduce((s, p) => s + p.seconds, 0);
    await admin.from("ai_usage").insert([
      usage(cfg.model, cfg.usd_per_hour, secs(false)),
      ...(secs(true) ? [usage(`assemblyai-${AAI_MODEL}`, AAI_USD_PER_HOUR, secs(true))] : []),
    ]);
    await admin.storage.from(BUCKET).remove(paths); // audio isn't kept once it's text

    // Draft the summary right away unless the teacher already has one for this lesson.
    const { data: existing } = await admin.from("lesson_summaries").select("lesson_id").eq("lesson_id", lessonId).maybeSingle();
    const auto = !existing && lesson.kind === "regular";
    if (auto) {
      const secret = await getSecret("internal_secret");
      const task = fetch(`${functionsUrl()}/ai-lesson`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-secret": secret ?? "" },
        body: JSON.stringify({ lesson_id: lessonId, use_transcript: true, auto: true }),
      }).then(async (r) => {
        if (!r.ok) await logError("ai-transcribe:auto-summary", await r.text(), { lesson_id: lessonId });
      }).catch((e) => logError("ai-transcribe:auto-summary", e, { lesson_id: lessonId }));
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(task);
      else await task;
    }
    return { ok: true, duration_sec: duration, auto_summary: auto };
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : "Не вдалося розшифрувати запис. Спробуйте ще раз — аудіо збережено.";
    await admin.from("lesson_transcripts").update({ status: "failed", error: msg }).eq("lesson_id", lessonId);
    if (!(e instanceof HttpError)) await logError("ai-transcribe", e, { lesson_id: lessonId });
    throw e instanceof HttpError ? e : new HttpError(502, msg);
  }
}

// ───────────── admin: key & provider ─────────────
async function status() {
  const { provider, cfg, key } = await sttConfig();
  const dKey = await getSecret(DIARIZE_KEY);
  return {
    configured: !!key,
    provider,
    key_hint: key ? `…${key.slice(-4)}` : null,
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, usd_per_hour: p.usd_per_hour })),
    usd_per_hour: cfg.usd_per_hour,
    diarize: { configured: !!dKey, key_hint: dKey ? `…${dKey.slice(-4)}` : null, usd_per_hour: AAI_USD_PER_HOUR },
  };
}

async function saveDiarizeKey(key: string) {
  key = String(key ?? "").trim();
  if (key.length < 20) throw new HttpError(422, "Схоже, це не API-ключ");
  const res = await fetch(`${AAI}/transcript?limit=1`, { headers: { authorization: key }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res) throw new HttpError(502, "Не вдалося перевірити ключ. Спробуйте ще раз.");
  await res.body?.cancel();
  if (res.status === 401 || res.status === 403) throw new HttpError(422, "AssemblyAI не прийняв ключ");
  if (!res.ok) throw new HttpError(502, `Перевірка ключа повернула помилку ${res.status}`);
  await setSecret(DIARIZE_KEY, key);
  return status();
}

async function saveKey(provider: string, key: string) {
  const cfg = PROVIDERS[provider];
  if (!cfg) throw new HttpError(422, "Невідомий провайдер");
  key = String(key ?? "").trim();
  if (key.length < 20) throw new HttpError(422, "Схоже, це не API-ключ");
  const res = await fetch(`${cfg.base_url}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res) throw new HttpError(502, "Не вдалося перевірити ключ. Спробуйте ще раз.");
  if (res.status === 401 || res.status === 403) throw new HttpError(422, `${cfg.label.split(" ")[0]} не прийняв ключ`);
  if (!res.ok) throw new HttpError(502, `Перевірка ключа повернула помилку ${res.status}`);
  await setSecret("stt_api_key", key);
  await setSetting("stt_settings", { provider });
  await setSetting("stt_configured", true);
  return status();
}

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
  const input = await readJson<Any>(req);
  switch (input.action ?? "transcribe") {
    case "transcribe":
      if (!/^[0-9a-f-]{36}$/.test(String(input.lesson_id))) throw new HttpError(422, "Некоректний урок");
      return json(await transcribe(req, input.lesson_id));
    case "status":
      await requireAdmin(req);
      return json(await status());
    case "save_key":
      await requireAdmin(req);
      return json(await saveKey(String(input.provider), input.key));
    case "remove_key":
      await requireAdmin(req);
      await setSecret("stt_api_key", null);
      await setSetting("stt_configured", false);
      return json(await status());
    case "save_diarize_key":
      await requireAdmin(req);
      return json(await saveDiarizeKey(input.key));
    case "remove_diarize_key":
      await requireAdmin(req);
      await setSecret(DIARIZE_KEY, null);
      return json(await status());
    default:
      throw new HttpError(400, "Невідома дія");
  }
}));
