// Lesson transcription (killer feature): the teacher's browser uploads the lesson audio as two tracks
// (t = teacher mic, s = Meet tab = students) in 10-minute chunks; this function turns them into one
// speaker-labelled transcript with an OpenAI-compatible speech-to-text API (Groq Whisper by default —
// the cheapest option), deletes the audio and asks ai-lesson to draft the summary in the background.
//   POST {action:"transcribe", lesson_id}              (teacher / staff JWT) → { duration_sec, auto_summary }
//   POST {action:"status"}                             (admin) → speech-to-text settings
//   POST {action:"save_key", provider, key}            (admin) → validates and stores the key in Vault
//   POST {action:"remove_key"}                         (admin)
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

async function requireAdmin(req: Request) {
  const { profile } = await requireUser(req, ["admin"]);
  return profile;
}

// ───────────── transcribe ─────────────
interface Line { t: number; who: "t" | "s"; text: string }

async function transcribeFile(cfg: SttProvider, key: string, path: string): Promise<{ lines: Line[]; seconds: number }> {
  const [, track, , offsetRaw] = path.split("/").pop()!.replace(/\.webm$/, "").match(/^([ts])-(\d+)-(\d+)$/) ?? [];
  if (!track) return { lines: [], seconds: 0 };
  const offset = Number(offsetRaw) || 0;
  const { data: blob, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !blob) throw new Error(`download ${path}: ${error?.message}`);
  if (blob.size < 2000) return { lines: [], seconds: 0 }; // header only — nothing recorded

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
  const lines: Line[] = [];
  for (const s of (data.segments ?? []) as Any[]) {
    const text = String(s.text ?? "").trim();
    if (!text || JUNK.test(text)) continue;
    if ((s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -0.8) continue; // silence the model "heard" words in
    lines.push({ t: offset + Number(s.start ?? 0), who: track as "t" | "s", text });
  }
  return { lines, seconds: Number(data.duration ?? 0) };
}

const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/** Interleaves both tracks by time and merges consecutive lines of the same speaker. */
function merge(lines: Line[]): string {
  lines.sort((a, b) => a.t - b.t);
  const out: { t: number; who: Line["who"]; text: string }[] = [];
  for (const l of lines) {
    const last = out[out.length - 1];
    if (last && last.who === l.who && l.t - last.t < 60) last.text += ` ${l.text}`;
    else out.push({ ...l });
  }
  return out.map((l) => `[${mmss(l.t)}] ${l.who === "t" ? "ВИКЛАДАЧ" : "УЧНІ"}: ${l.text}`).join("\n");
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
  const { data: lesson } = await admin.from("lessons").select("id, teacher_id, kind").eq("id", lessonId).maybeSingle();
  if (!lesson) throw new HttpError(404, "Урок не знайдено");
  if (!isStaff(profile) && lesson.teacher_id !== profile.id) throw new HttpError(403, "Це не ваш урок");

  const { cfg, key } = await sttConfig();
  if (!key) throw new HttpError(409, "Розшифровку не налаштовано (Налаштування → Інтеграції)");

  const { data: files, error } = await admin.storage.from(BUCKET).list(lessonId, { limit: 1000 });
  if (error) throw error;
  const paths = (files ?? []).filter((f) => f.name.endsWith(".webm")).map((f) => `${lessonId}/${f.name}`);
  if (!paths.length) throw new HttpError(422, "Запису для цього уроку немає");

  await admin.from("lesson_transcripts").upsert({ lesson_id: lessonId, status: "processing", error: null, created_by: profile.id });
  try {
    const parts = await pool(paths, 4, (p) => transcribeFile(cfg, key, p));
    const lines = parts.flatMap((p) => p.lines);
    const audioSeconds = parts.reduce((s, p) => s + p.seconds, 0);
    const duration = Math.round(Math.max(0, ...lines.map((l) => l.t)) + 5);
    if (!lines.length) throw new HttpError(422, "У записі не вдалося розпізнати мову. Перевірте, що при старті запису було вибрано вкладку Meet зі звуком.");

    await admin.from("lesson_transcripts").update({ status: "ready", text: merge(lines), duration_sec: duration, error: null }).eq("lesson_id", lessonId);
    await admin.from("ai_usage").insert({
      user_id: profile.id, feature: "transcribe", model: cfg.model, input_tokens: 0, output_tokens: 0,
      cost_usd: Number(((audioSeconds / 3600) * cfg.usd_per_hour).toFixed(6)), ref_id: lessonId,
    });
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
  return {
    configured: !!key,
    provider,
    key_hint: key ? `…${key.slice(-4)}` : null,
    providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, label: p.label, usd_per_hour: p.usd_per_hour })),
    usd_per_hour: cfg.usd_per_hour,
  };
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
    default:
      throw new HttpError(400, "Невідома дія");
  }
}));
