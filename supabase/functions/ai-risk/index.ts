// Churn-risk explanation for managers (FR-19, phase 2). Scoring itself is SQL (private.compute_risk_scores);
// this function only turns the signals into 2–3 sentences. Internal (DB) or staff JWT.
import { admin, handle, HttpError, isInternal, json, readJson, requireUser } from "../_shared/core.ts";
import { aiClient, aiSettings, assertGlobalBudget, logUsage, textOf } from "../_shared/ai.ts";
import { RISK_SYSTEM } from "../_shared/prompts.ts";

async function explain(studentId: string, day?: string) {
  let q = admin.from("risk_scores").select("*, student:profiles!risk_scores_student_id_fkey(full_name, level, age_group)").eq("student_id", studentId);
  q = day ? q.eq("computed_on", day) : q.order("computed_on", { ascending: false }).limit(1);
  const { data: rows } = await q;
  const row = rows?.[0];
  if (!row) throw new HttpError(404, "Оцінку ризику не знайдено");
  const settings = await aiSettings();
  const client = await aiClient(settings, "risk_enabled");
  await assertGlobalBudget(settings);
  const s = row.signals ?? {};
  const facts = [
    `Risk score: ${row.score}/100`,
    `Lessons with attendance marked (4 weeks): ${s.lessons_marked}, absences: ${s.absent}`,
    `Homework due (4 weeks): ${s.hw_due}, not submitted: ${s.hw_missed}`,
    `AI practice sessions: last 2 weeks ${s.practice_recent}, 2 weeks before ${s.practice_prev}`,
    `Scheduled lessons in the next 2 weeks: ${s.upcoming}`,
    `Days since last attended lesson: ${s.days_since_attended}`,
    `Student level: ${row.student?.level ?? "unknown"}, age group: ${row.student?.age_group ?? "unknown"}`,
  ].join("\n");
  const msg = await client.messages.create({
    model: settings.model_fast,
    max_tokens: 400,
    system: RISK_SYSTEM,
    messages: [{ role: "user", content: facts }],
  });
  await logUsage(settings, { userId: studentId, feature: "risk", model: settings.model_fast, usage: msg.usage });
  const explanation = textOf(msg).trim().slice(0, 1200);
  await admin.from("risk_scores").update({ explanation }).eq("student_id", studentId).eq("computed_on", row.computed_on);
  return { explanation };
}

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
  const internal = await isInternal(req);
  if (!internal) await requireUser(req, ["manager", "admin"]);
  const { student_id, computed_on } = await readJson<{ student_id: string; computed_on?: string }>(req);
  if (internal) {
    try {
      return json(await explain(student_id, computed_on));
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return json(await explain(student_id, computed_on));
}));
