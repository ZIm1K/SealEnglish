// Level test for leads before the trial lesson (FR-22, phase 3). Public, authorised by the lead's one-time token
// that the `lead` function returns after the trial request.
//   POST {action:"questions", token} → { name, questions (no answers), writing_task, done? }
//   POST {action:"submit", token, answers:{[id]: index}, writing} → { level, mc_score, mc_total, feedback }
import { admin, clientIp, handle, HttpError, json, logError, readJson } from "../_shared/core.ts";
import { aiClient, aiSettings, assertGlobalBudget, structuredCall, z } from "../_shared/ai.ts";
import { LEVEL_TEST_SYSTEM } from "../_shared/prompts.ts";
import { combineLevels, LEVELS, mcLevel, QUESTIONS, WRITING_TASK, type Level } from "../_shared/level-test.ts";

async function allowed(bucket: string, max: number, windowSeconds: number) {
  const { data, error } = await admin.rpc("hit_rate_limit", { p_bucket: bucket, p_max: max, p_window_seconds: windowSeconds });
  return error ? true : data !== false;
}

async function leadByToken(token: string) {
  if (!/^[a-f0-9]{32,64}$/.test(token)) throw new HttpError(404, "Посилання на тест недійсне");
  const { data } = await admin.from("leads").select("id, name, level_estimate").eq("level_test_token", token).maybeSingle();
  if (!data) throw new HttpError(404, "Посилання на тест недійсне");
  return data;
}

const writingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["level", "feedback"],
  properties: { level: { type: "string", enum: [...LEVELS] }, feedback: { type: "string" } },
};
const writingValidator = z.object({ level: z.enum(LEVELS), feedback: z.string().max(1500) });

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
  const settings = await aiSettings();
  if (!settings.level_test_enabled) throw new HttpError(404, "Тест рівня зараз недоступний");
  const input = await readJson<{ action: string; token: string; answers?: Record<string, number>; writing?: string }>(req);
  const lead = await leadByToken(String(input.token ?? ""));

  const { data: existing } = await admin.from("level_tests").select("*").eq("lead_id", lead.id).not("completed_at", "is", null).maybeSingle();

  if (input.action === "questions") {
    return json({
      name: lead.name.split(" ")[0],
      done: existing ? { level: existing.level, mc_score: existing.mc_score, mc_total: existing.mc_total, feedback: existing.feedback } : null,
      questions: QUESTIONS.map(({ answer: _a, ...q }) => q),
      writing_task: WRITING_TASK,
    });
  }
  if (input.action !== "submit") throw new HttpError(400, "Невідома дія");
  if (existing) return json({ level: existing.level, mc_score: existing.mc_score, mc_total: existing.mc_total, feedback: existing.feedback });
  if (!(await allowed(`level:${clientIp(req)}`, 5, 3600)) || !(await allowed(`level:${lead.id}`, 3, 86400))) {
    throw new HttpError(429, "Забагато спроб. Спробуйте пізніше.");
  }

  const answers = input.answers ?? {};
  const mcScore = QUESTIONS.reduce((s, q) => s + (Number(answers[q.id]) === q.answer ? 1 : 0), 0);
  const mc = mcLevel(mcScore);
  const writing = String(input.writing ?? "").trim().slice(0, 1500);

  let writingLevel: Level | null = null;
  let feedback = "";
  if (writing.length >= 40) {
    try {
      const client = await aiClient(settings);
      await assertGlobalBudget(settings);
      const { data } = await structuredCall({
        client, settings,
        model: settings.model_fast,
        system: LEVEL_TEST_SYSTEM,
        content: `Task: ${WRITING_TASK}\n\nStudent's text:\n${writing}`,
        schema: writingSchema,
        validator: writingValidator,
        maxTokens: 800,
        feature: "level_test",
        userId: null,
        refId: lead.id,
      });
      writingLevel = data.level;
      feedback = data.feedback;
    } catch (e) {
      await logError("ai-level-test", e, { lead_id: lead.id });
    }
  }
  const level = combineLevels(mc, writingLevel);
  if (!feedback) {
    feedback = `Ваш орієнтовний рівень — ${level}. На пробному уроці викладач уточнить рівень у розмові й підкаже, з чого почати.`;
  }

  await admin.from("level_tests").insert({
    lead_id: lead.id, answers, mc_score: mcScore, mc_total: QUESTIONS.length, writing, level, feedback, completed_at: new Date().toISOString(),
  });
  await admin.from("leads").update({ level_estimate: level }).eq("id", lead.id);
  await admin.from("lead_events").insert({
    lead_id: lead.id, kind: "note", actor_name: "Тест рівня",
    body: `Тест рівня: ${level} (тест ${mcScore}/${QUESTIONS.length}${writingLevel ? `, письмо ${writingLevel}` : ""})`,
  });
  return json({ level, mc_score: mcScore, mc_total: QUESTIONS.length, feedback });
}));
