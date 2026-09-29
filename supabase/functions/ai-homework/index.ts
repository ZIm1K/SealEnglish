// Homework draft from the latest lesson: the lesson summary (vocabulary / grammar / mistakes / recap) + the students'
// open mistakes → title and description for the "new assignment" form. Nothing is saved; the teacher edits and creates it.
//   POST {group_id | student_id, wish?} (teacher / staff JWT) → {title, description, lesson, due_at}
import { admin, fmtKyiv, handle, HttpError, isStaff, json, readJson, requireUser } from "../_shared/core.ts";
import { aiClient, aiSettings, assertGlobalBudget, structuredCall, z } from "../_shared/ai.ts";
import { HOMEWORK_SYSTEM, levelGuide } from "../_shared/prompts.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description"],
  properties: { title: { type: "string" }, description: { type: "string" } },
};
const validator = z.object({
  title: z.string().trim().min(1).transform((s) => s.slice(0, 120)),
  description: z.string().trim().min(1).transform((s) => s.slice(0, 6000)),
});

const CEFR = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
  const { profile } = await requireUser(req, ["teacher", "manager", "admin"]);
  const input = await readJson<{ group_id?: string; student_id?: string; wish?: string }>(req);
  const wish = String(input.wish ?? "").trim().slice(0, 500);
  if (!input.group_id === !input.student_id) throw new HttpError(422, "Оберіть групу або учня");

  // Lessons of the target: a student's individual lessons plus the lessons of their groups.
  let groupIds: string[] = [];
  if (input.group_id) groupIds = [input.group_id];
  else {
    const { data } = await admin.from("group_members").select("group_id").eq("student_id", input.student_id);
    groupIds = (data ?? []).map((r: Any) => r.group_id);
  }
  const targetFilter = [
    ...(input.student_id ? [`student_id.eq.${input.student_id}`] : []),
    ...(groupIds.length ? [`group_id.in.(${groupIds.join(",")})`] : []),
  ].join(",");
  if (!targetFilter) throw new HttpError(404, "У цього учня ще немає уроків");

  const now = new Date().toISOString();
  const scoped = (q: Any) => (isStaff(profile) ? q : q.eq("teacher_id", profile.id));
  const { data: past } = await scoped(
    admin.from("lessons")
      .select("id, title, topic, starts_at, teacher_notes, group_id, student_id, summary:lesson_summaries(vocabulary, grammar, mistakes, recap)")
      .or(targetFilter)
      .neq("kind", "trial")
      .neq("status", "cancelled")
      .lte("starts_at", now)
      .order("starts_at", { ascending: false })
      .limit(5),
  );
  const lessons = (past ?? []) as Any[];
  const summaryOf = (l: Any) => (Array.isArray(l.summary) ? l.summary[0] : l.summary) ?? null;
  // The newest lesson with a summary; otherwise the newest one the teacher at least wrote a topic or notes for.
  const lesson = lessons.find((l) => summaryOf(l)) ?? lessons.find((l) => l.topic || l.teacher_notes);
  if (!lesson) {
    throw new HttpError(422, lessons.length
      ? "У минулому уроці немає підсумку чи теми — заповніть підсумок уроку або опишіть завдання вручну"
      : "Не знайдено минулих уроків для цієї групи чи учня");
  }
  const summary = summaryOf(lesson);

  // The next lesson is the natural deadline.
  const { data: next } = await scoped(
    admin.from("lessons").select("starts_at").or(targetFilter).neq("kind", "trial").neq("status", "cancelled")
      .gt("starts_at", now).order("starts_at").limit(1),
  );

  // Level: the student's own, or the weakest in the group so every student can do the tasks.
  let levels: (string | null)[] = [];
  if (input.student_id) {
    const { data } = await admin.from("profiles").select("level").eq("id", input.student_id).maybeSingle();
    levels = [data?.level ?? null];
  } else {
    const { data } = await admin.from("group_members").select("student:profiles!group_members_student_id_fkey(level)").eq("group_id", input.group_id);
    levels = (data ?? []).map((r: Any) => r.student?.level ?? null);
  }
  const level = levels.map((l) => (l ?? "").toUpperCase().slice(0, 2)).filter((l) => CEFR.includes(l))
    .sort((a, b) => CEFR.indexOf(a) - CEFR.indexOf(b))[0] ?? null;

  const lessonMistakes = ((summary?.mistakes ?? []) as Any[])
    .filter((m) => !input.student_id || !m.student_id || m.student_id === input.student_id)
    .slice(0, 12)
    .map((m) => `- "${m.example}" → "${m.correction}"`);
  let openMistakes: string[] = [];
  if (input.student_id) {
    const { data } = await admin.from("student_mistakes").select("example, correction, occurrences")
      .eq("student_id", input.student_id).is("resolved_at", null).order("occurrences", { ascending: false }).limit(8);
    openMistakes = (data ?? []).map((m: Any) => `- "${m.example}" → "${m.correction}" (×${m.occurrences})`);
  }

  const settings = await aiSettings();
  const client = await aiClient(settings, "lesson_enabled");
  await assertGlobalBudget(settings);
  const { data } = await structuredCall({
    client, settings,
    model: settings.model_main,
    system: HOMEWORK_SYSTEM,
    content: [{
      type: "text",
      text: [
        `Homework for: ${input.student_id ? "one student (one-to-one)" : "a group"}`,
        `Level rules (${level ?? "unknown"}):`,
        levelGuide(level),
        "",
        `Latest lesson (${fmtKyiv(lesson.starts_at, { day: "numeric", month: "long" })}): ${lesson.title ?? "English lesson"}`,
        `Topic: ${lesson.topic ?? "—"}`,
        ...(summary
          ? [
            `Vocabulary: ${JSON.stringify(summary.vocabulary ?? []).slice(0, 3000)}`,
            `Grammar: ${JSON.stringify(summary.grammar ?? []).slice(0, 1500)}`,
            `Recap: ${summary.recap ?? "—"}`,
          ]
          : [`Teacher's notes: ${String(lesson.teacher_notes ?? "—").slice(0, 2000)}`]),
        "",
        "Mistakes made in this lesson:",
        lessonMistakes.join("\n") || "—",
        ...(openMistakes.length ? ["", "The student's recurring mistakes:", openMistakes.join("\n")] : []),
        ...(wish ? ["", `Teacher's wish: ${wish}`] : []),
      ].join("\n"),
    }],
    schema,
    validator,
    maxTokens: 3000,
    effort: "low",
    feature: "homework_draft",
    userId: profile.id,
    refId: lesson.id,
  });

  return json({
    ...data,
    lesson: { id: lesson.id, title: lesson.title, topic: lesson.topic, starts_at: lesson.starts_at, has_summary: !!summary },
    due_at: next?.[0]?.starts_at ?? null,
  });
}));
