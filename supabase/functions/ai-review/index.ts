// AI draft review of homework (FR-13). Called by the DB trigger on every submitted answer (internal secret)
// or by the teacher to regenerate a draft (JWT). The draft goes to submission_ai_reviews — the student
// sees only what the teacher confirms (P1).
import { admin, handle, HttpError, isInternal, isStaff, json, logError, readJson, requireUser } from "../_shared/core.ts";
import {
  aiClient, aiSettings, assertGlobalBudget, mistakeJsonSchema, mistakesValidator, structuredCall, z, type Anthropic,
} from "../_shared/ai.ts";
import { REVIEW_SYSTEM } from "../_shared/prompts.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_PDF = 10 * 1024 * 1024;
const MAX_FILES = 5;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "feedback", "teacher_note", "mistakes", "confidence"],
  properties: {
    score: { anyOf: [{ type: "integer" }, { type: "null" }], description: "Suggested score from 0 to the maximum, or null if it can't be assessed" },
    feedback: { type: "string" },
    teacher_note: { type: "string" },
    mistakes: { type: "array", items: mistakeJsonSchema },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
};
const validator = z.object({
  score: z.number().int().nullable(),
  feedback: z.string().trim().min(1).max(4000),
  teacher_note: z.string().max(2000).catch(""),
  mistakes: mistakesValidator,
  confidence: z.enum(["low", "medium", "high"]).catch("medium"),
});

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function attachmentBlocks(items: Any[], label: string, notes: string[]): Promise<Anthropic.ContentBlockParam[]> {
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const a of items ?? []) {
    if (blocks.length >= MAX_FILES) {
      notes.push(`${label} «${a.name}»: не проаналізовано (ліміт файлів)`);
      continue;
    }
    const type = String(a.type ?? "").toLowerCase();
    const isImage = (IMAGE_TYPES as readonly string[]).includes(type);
    const isPdf = type === "application/pdf";
    if (!a.path || (!isImage && !isPdf)) {
      notes.push(`${label} «${a.name}» (${type || "невідомий тип"}): ШІ не аналізує цей формат — перевірте вручну`);
      continue;
    }
    if ((isImage && (a.size ?? 0) > MAX_IMAGE) || (isPdf && (a.size ?? 0) > MAX_PDF)) {
      notes.push(`${label} «${a.name}»: завеликий файл для ШІ — перевірте вручну`);
      continue;
    }
    const { data, error } = await admin.storage.from("homework").download(a.path);
    if (error || !data) {
      notes.push(`${label} «${a.name}»: не вдалося завантажити`);
      continue;
    }
    const b64 = toBase64(new Uint8Array(await data.arrayBuffer()));
    blocks.push(
      isImage
        ? { type: "image", source: { type: "base64", media_type: type as ImageType, data: b64 } }
        : { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 }, title: `${label}: ${a.name}` },
    );
  }
  return blocks;
}

async function review(submissionId: string) {
  const { data: sub } = await admin
    .from("submissions")
    .select("*, assignment:assignments(id, title, description, max_score, attachments, teacher_id), student:profiles!submissions_student_id_fkey(id, full_name, level, age_group)")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub) throw new HttpError(404, "Роботу не знайдено");
  const settings = await aiSettings();
  const client = await aiClient(settings, "review_enabled");
  await assertGlobalBudget(settings);
  const version = sub.submitted_at;
  await admin.from("submission_ai_reviews").upsert({ submission_id: sub.id, status: "pending", error: null, reviewed_version: version });

  try {
    const { data: mistakes } = await admin
      .from("student_mistakes")
      .select("category, example, correction, occurrences")
      .eq("student_id", sub.student_id)
      .is("resolved_at", null)
      .order("occurrences", { ascending: false })
      .limit(8);
    const notes: string[] = [];
    const taskFiles = await attachmentBlocks((sub.assignment.attachments ?? []).slice(0, 2), "Файл завдання", notes);
    const answerFiles = await attachmentBlocks(sub.attachments ?? [], "Файл відповіді", notes);
    const text = [
      `Assignment: ${sub.assignment.title}`,
      `Task description: ${sub.assignment.description ?? "(no description — infer the task from the title and files)"}`,
      `Maximum score: ${sub.assignment.max_score}`,
      `Student level: ${sub.student?.level ?? "unknown"}; age group: ${sub.student?.age_group ?? "unknown"}`,
      `Known typical mistakes: ${(mistakes ?? []).map((m) => `[${m.category}] ${m.example} → ${m.correction} (×${m.occurrences})`).join("; ") || "none"}`,
      notes.length ? `Files not analysed: ${notes.join("; ")}` : "",
      "",
      "Student's written answer:",
      sub.body?.trim() || "(no text — see the attached files, if any)",
    ].filter(Boolean).join("\n");

    const { data } = await structuredCall({
      client, settings,
      model: settings.model_main,
      system: REVIEW_SYSTEM,
      content: [...taskFiles, ...answerFiles, { type: "text", text }],
      schema,
      validator,
      maxTokens: 4000,
      effort: "medium",
      feature: "review",
      userId: sub.student_id,
      refId: sub.id,
    });
    const score = data.score == null ? null : Math.min(Math.max(data.score, 0), sub.assignment.max_score);
    const teacherNote = [data.teacher_note, notes.length ? `⚠️ ${notes.join("; ")}` : "", `Впевненість ШІ: ${{ low: "низька", medium: "середня", high: "висока" }[data.confidence]}`]
      .filter(Boolean).join("\n");

    // The student may have edited the answer meanwhile — only the latest version's draft is kept.
    const { data: fresh } = await admin.from("submissions").select("submitted_at, status").eq("id", sub.id).maybeSingle();
    if (!fresh || fresh.submitted_at !== version) return { ok: true, stale: true };
    await admin.from("submission_ai_reviews").update({
      status: fresh.status === "submitted" ? "ready" : "discarded",
      feedback: data.feedback,
      score,
      teacher_note: teacherNote,
      mistakes: data.mistakes,
      model: settings.model_main,
      error: null,
    }).eq("submission_id", sub.id);
    return { ok: true, score, feedback: data.feedback, teacher_note: teacherNote, mistakes: data.mistakes };
  } catch (e) {
    await admin.from("submission_ai_reviews").update({
      status: "failed",
      error: e instanceof HttpError ? e.message : "Не вдалося створити чернетку",
    }).eq("submission_id", sub.id);
    if (!(e instanceof HttpError)) await logError("ai-review", e, { submission_id: sub.id });
    throw e;
  }
}

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
  if (await isInternal(req)) {
    const { submission_id } = await readJson<{ submission_id: string }>(req);
    try {
      return json(await review(submission_id));
    } catch (e) {
      // the failure is already recorded on the draft; the DB caller doesn't need a 5xx
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const { profile } = await requireUser(req, ["teacher", "manager", "admin"]);
  const { submission_id } = await readJson<{ submission_id: string }>(req);
  const { data: sub } = await admin.from("submissions").select("assignment:assignments(teacher_id)").eq("id", submission_id).maybeSingle();
  if (!sub) throw new HttpError(404, "Роботу не знайдено");
  // deno-lint-ignore no-explicit-any
  if (!isStaff(profile) && (sub as any).assignment?.teacher_id !== profile.id) throw new HttpError(403, "Недостатньо прав");
  return json(await review(submission_id));
}));
