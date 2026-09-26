// Lesson summary (FR-11): photos of the lesson boards + the teacher's text about students' mistakes →
// structured vocabulary / grammar / mistakes draft. The teacher edits the draft and publishes it (RPC publish_lesson_summary).
//   POST {lesson_id, notes, images?: [{media_type, data(base64)}]} (teacher / staff JWT) → saved draft
// Photos are analysed only, never stored.
import { admin, handle, HttpError, isStaff, json, readJson, requireUser } from "../_shared/core.ts";
import { aiClient, aiSettings, assertGlobalBudget, MISTAKE_CATEGORIES, structuredCall, z, type Anthropic } from "../_shared/ai.ts";
import { LESSON_SYSTEM, levelGuide } from "../_shared/prompts.ts";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["topic", "vocabulary", "grammar", "mistakes", "recap"],
  properties: {
    topic: { type: "string" },
    vocabulary: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "meaning", "example"],
        properties: { term: { type: "string" }, meaning: { type: "string" }, example: { type: "string" } },
      },
    },
    grammar: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["point", "note"],
        properties: { point: { type: "string" }, note: { type: "string" } },
      },
    },
    mistakes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "example", "correction", "explanation", "student"],
        properties: {
          category: { type: "string", enum: [...MISTAKE_CATEGORIES] },
          example: { type: "string" },
          correction: { type: "string" },
          explanation: { type: "string" },
          student: { anyOf: [{ type: "string" }, { type: "null" }] },
        },
      },
    },
    recap: { type: "string" },
  },
};

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];
const MAX_IMAGES = 8;
const MAX_IMAGE_B64 = Math.floor((5 * 1024 * 1024 * 4) / 3); // provider limit: 5 MB per image

const validator = z.object({
  topic: z.string().trim().max(200).catch(""),
  vocabulary: z.array(z.object({ term: z.string().trim().min(1).max(120), meaning: z.string().max(200).catch(""), example: z.string().max(300).catch("") })).max(40).catch([]),
  grammar: z.array(z.object({ point: z.string().trim().min(1).max(200), note: z.string().max(400).catch("") })).max(15).catch([]),
  mistakes: z.array(z.object({
    category: z.enum(MISTAKE_CATEGORIES).catch("other"),
    example: z.string().trim().min(1).max(300),
    correction: z.string().trim().min(1).max(300),
    explanation: z.string().max(500).catch(""),
    student: z.string().nullable().catch(null),
  })).max(30).catch([]),
  recap: z.string().max(2000).catch(""),
});

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
  const { profile } = await requireUser(req, ["teacher", "manager", "admin"]);
  const input = await readJson<{ lesson_id: string; notes: string; images?: { media_type: string; data: string }[] }>(req);
  const notes = String(input.notes ?? "").trim();
  const images = Array.isArray(input.images) ? input.images : [];
  if (images.length > MAX_IMAGES) throw new HttpError(422, `Не більше ${MAX_IMAGES} фото`);
  for (const img of images) {
    if (!IMAGE_TYPES.includes(img?.media_type as ImageType) || typeof img.data !== "string" || !img.data) throw new HttpError(422, "Непідтримуваний формат фото (JPG, PNG, WebP)");
    if (img.data.length > MAX_IMAGE_B64) throw new HttpError(422, "Фото завелике (до 5 МБ)");
  }
  if (!images.length && notes.length < 15) throw new HttpError(422, "Додайте фото дошки або опишіть урок кількома реченнями");
  if (notes.length > 8000) throw new HttpError(422, "Текст задовгий (до 8000 символів)");

  const { data: lesson } = await admin.from("lessons").select("id, title, topic, teacher_id, group_id, student_id, kind").eq("id", input.lesson_id).maybeSingle();
  if (!lesson) throw new HttpError(404, "Урок не знайдено");
  if (!isStaff(profile) && lesson.teacher_id !== profile.id) throw new HttpError(403, "Це не ваш урок");
  if (lesson.kind === "trial") throw new HttpError(422, "Для пробних уроків підсумок не створюється");

  const roster: { id: string; full_name: string; level: string | null }[] = [];
  if (lesson.group_id) {
    const { data } = await admin.from("group_members").select("student:profiles!group_members_student_id_fkey(id, full_name, level)").eq("group_id", lesson.group_id);
    // deno-lint-ignore no-explicit-any
    for (const r of (data ?? []) as any[]) if (r.student) roster.push(r.student);
  } else if (lesson.student_id) {
    const { data } = await admin.from("profiles").select("id, full_name, level").eq("id", lesson.student_id).maybeSingle();
    if (data) roster.push(data);
  }

  // Examples must be readable by every student, so the lowest level in the group wins.
  const CEFR = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
  const level = roster.map((s) => (s.level ?? "").toUpperCase().slice(0, 2)).filter((l) => CEFR.includes(l)).sort((a, b) => CEFR.indexOf(a) - CEFR.indexOf(b))[0] ?? null;

  const settings = await aiSettings();
  const client = await aiClient(settings, "lesson_enabled");
  await assertGlobalBudget(settings);
  const { data } = await structuredCall({
    client, settings,
    model: settings.model_main,
    system: LESSON_SYSTEM,
    content: [
      ...images.map((img): Anthropic.ImageBlockParam => ({ type: "image", source: { type: "base64", media_type: img.media_type as ImageType, data: img.data } })),
      {
        type: "text",
        text: [
          `Lesson: ${lesson.title ?? "English lesson"}${lesson.topic ? ` · planned topic: ${lesson.topic}` : ""}`,
          `Roster: ${roster.map((s) => s.full_name).join(", ") || "—"}`,
          "",
          `Write the vocabulary meanings, example sentences and the recap for the weakest level in the group (${level ?? "unknown"}):`,
          levelGuide(level),
          `Board photos attached: ${images.length}`,
          "",
          "Teacher's text (students' mistakes, optional comments):",
          notes || "—",
        ].join("\n"),
      },
    ],
    schema,
    validator,
    maxTokens: 6000,
    effort: "medium",
    feature: "lesson_summary",
    userId: profile.id,
    refId: lesson.id,
  });

  // Match names from the notes to roster ids (first name is enough when unique).
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\s]/gu, "").trim();
  const byName = (name: string | null) => {
    if (!name) return null;
    const n = norm(name);
    const exact = roster.find((s) => norm(s.full_name) === n);
    if (exact) return exact.id;
    const partial = roster.filter((s) => norm(s.full_name).split(/\s+/).includes(n.split(/\s+/)[0]));
    return partial.length === 1 ? partial[0].id : null;
  };
  const same = (a: string, b: string) => a.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === b.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const mistakes = data.mistakes.filter((m) => !same(m.example, m.correction)).map(({ student, ...m }) => ({ ...m, student_id: byName(student), student_name: student }));

  const row = {
    lesson_id: lesson.id,
    notes: notes || null,
    vocabulary: data.vocabulary,
    grammar: data.grammar,
    mistakes,
    recap: data.recap,
    source: "teacher_form",
    status: "draft",
    model: settings.model_main,
    created_by: profile.id,
  };
  const { error } = await admin.from("lesson_summaries").upsert(row);
  if (error) throw error;
  if (!lesson.topic && data.topic) await admin.from("lessons").update({ topic: data.topic.slice(0, 200) }).eq("id", lesson.id);
  return json({ ...row, topic: data.topic, roster: roster.map(({ id, full_name }) => ({ id, full_name })) });
}));
