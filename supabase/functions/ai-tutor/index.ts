// AI practice coach (FR-14, FR-17): text chat streamed over SSE, grounded in the student's latest lesson
// and mistake profile, with daily limits, moderation and a session summary for the teacher (FR-15).
//   POST {action:"start", mode, lesson_id?}      (student JWT) → { session_id, greeting, messages_left }
//   POST {action:"message", session_id, text}    (student JWT) → text/event-stream
//   POST {action:"end", session_id}              (student JWT) → { summary }
//   POST {action:"finalize", session_id}         (internal: cron closes abandoned sessions)
import { admin, cors, handle, HttpError, isInternal, json, logError, readJson, requireUser, type Profile } from "../_shared/core.ts";
import {
  aiClient, aiSettings, assertGlobalBudget, CRISIS_REPLY, FLAG_LABEL, logUsage, mistakeJsonSchema, mistakesValidator,
  moderate, structuredCall, supportsEffort, tutorQuota, z, type AiSettings, type Anthropic, type ModerationFlag,
} from "../_shared/ai.ts";
import {
  PRACTICE_MODES, PRACTICE_SUMMARY_SYSTEM, TUTOR_SAFETY_MARKER, TUTOR_SYSTEM, tutorContext, tutorGreeting,
  type PracticeMode, type TutorContext,
} from "../_shared/prompts.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const MAX_INPUT = 1500;
const HISTORY_TURNS = 40;
const OPENER = "(The student opened a practice session.)";

async function studentGroups(studentId: string): Promise<string[]> {
  const { data } = await admin.from("group_members").select("group_id").eq("student_id", studentId);
  return (data ?? []).map((r) => r.group_id);
}

async function assertTutorAllowed(settings: AiSettings, me: Profile) {
  if (!settings.tutor_enabled) throw new HttpError(409, "ШІ-тренер зараз вимкнений");
  if (settings.pilot_group_ids.length) {
    const groups = await studentGroups(me.id);
    if (!groups.some((g) => settings.pilot_group_ids.includes(g))) {
      throw new HttpError(403, "ШІ-тренер поки доступний лише в пілотних групах");
    }
  }
}

async function buildContext(me: Profile & { level?: string | null; age_group?: string | null }, mode: PracticeMode, lessonId?: string) {
  const groups = await studentGroups(me.id);
  let q = admin
    .from("lessons")
    .select("id, title, topic, starts_at, lesson_summaries!inner(vocabulary, grammar, status)")
    .eq("lesson_summaries.status", "published")
    .neq("status", "cancelled")
    .lte("starts_at", new Date().toISOString())
    .order("starts_at", { ascending: false })
    .limit(1);
  q = groups.length ? q.or(`student_id.eq.${me.id},group_id.in.(${groups.join(",")})`) : q.eq("student_id", me.id);
  if (lessonId) q = q.eq("id", lessonId);
  const { data: lessons } = await q;
  const l = (lessons ?? [])[0] as Any | undefined;
  const summary = l ? (Array.isArray(l.lesson_summaries) ? l.lesson_summaries[0] : l.lesson_summaries) : null;

  const { data: mistakes } = await admin
    .from("student_mistakes")
    .select("category, example, correction, occurrences")
    .eq("student_id", me.id)
    .is("resolved_at", null)
    .order("occurrences", { ascending: false })
    .order("last_seen_at", { ascending: false })
    .limit(10);

  const ctx: TutorContext = {
    firstName: (me.full_name || "").split(" ")[0],
    level: me.level ?? null,
    ageGroup: me.age_group ?? null,
    mode,
    lesson: l && summary
      ? {
        title: l.title,
        topic: l.topic,
        date: new Date(l.starts_at).toISOString().slice(0, 10),
        vocabulary: summary.vocabulary ?? [],
        grammar: summary.grammar ?? [],
      }
      : null,
    mistakes: (mistakes ?? []) as TutorContext["mistakes"],
  };
  return { ctx, lessonId: l?.id ?? null, topic: l?.topic ?? null };
}

async function teachersOf(studentId: string): Promise<string[]> {
  const groups = await studentGroups(studentId);
  const ids = new Set<string>();
  if (groups.length) {
    const { data } = await admin.from("groups").select("teacher_id").in("id", groups);
    for (const g of data ?? []) if (g.teacher_id) ids.add(g.teacher_id);
  }
  const { data: lessons } = await admin.from("lessons").select("teacher_id").eq("student_id", studentId).limit(50);
  for (const l of lessons ?? []) ids.add(l.teacher_id);
  return [...ids];
}

async function flagSession(session: Any, student: Profile, flags: ModerationFlag[]) {
  const reason = [...new Set(flags)].map((f) => FLAG_LABEL[f]).join(", ");
  const wasFlagged = session.flagged;
  await admin.from("practice_sessions").update({
    flagged: true,
    flag_reason: session.flag_reason ? `${session.flag_reason}; ${reason}` : reason,
  }).eq("id", session.id);
  if (wasFlagged && !flags.includes("crisis")) return;
  const teachers = await teachersOf(student.id);
  if (!teachers.length) return;
  await admin.from("notifications").insert(teachers.map((uid) => ({
    user_id: uid,
    kind: "practice_flagged",
    title: flags.includes("crisis") ? "⚠️ Терміново: сесія практики учня" : "Позначена сесія практики",
    body: `${student.full_name} · ${reason}`,
    link: `/app/practice/?session=${session.id}`,
    data: { session_id: session.id, student_id: student.id },
  })));
}

// ───────────── start ─────────────
async function start(me: Profile, input: Any) {
  const settings = await aiSettings();
  await aiClient(settings, "tutor_enabled");
  await assertTutorAllowed(settings, me);
  const mode: PracticeMode = input.mode in PRACTICE_MODES ? input.mode : "lesson";
  const quota = await tutorQuota(settings, me.id);
  if (quota.messagesLeft <= 0 || quota.usdLeft <= 0) {
    throw new HttpError(429, "На сьогодні ліміт практики вичерпано. Повертайся завтра! 🦭");
  }
  const { ctx, lessonId, topic } = await buildContext(me as Any, mode, input.lesson_id);
  if (mode === "mistakes" && !ctx.mistakes.length) throw new HttpError(422, "Поки немає помилок для відпрацювання — обери інший режим 🙂");
  const greeting = tutorGreeting(ctx);
  const { data: session, error } = await admin
    .from("practice_sessions")
    .insert({ student_id: me.id, lesson_id: lessonId, mode: "text", topic: topic ?? PRACTICE_MODES[mode].slice(0, 80), context: tutorContext(ctx) })
    .select("id")
    .single();
  if (error) throw error;
  await admin.from("practice_turns").insert({ session_id: session.id, role: "assistant", content: greeting });
  return { session_id: session.id, greeting, messages_left: quota.messagesLeft, lesson_topic: topic };
}

// ───────────── message (SSE) ─────────────
function sse(body: (send: (event: Record<string, unknown>) => void) => Promise<void>): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // client went away; keep processing so the turn is still saved
        }
      };
      try {
        await body(send);
      } catch (e) {
        if (e instanceof HttpError) send({ type: "error", message: e.message });
        else {
          await logError("ai-tutor", e);
          send({ type: "error", message: "Сілі зараз не може відповісти. Спробуй ще раз за хвилину." });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
  return new Response(stream, {
    headers: { ...cors, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
  });
}

async function message(me: Profile, input: Any): Promise<Response> {
  const raw = String(input.text ?? "").trim();
  if (!raw) throw new HttpError(422, "Напиши повідомлення");
  if (raw.length > MAX_INPUT) throw new HttpError(422, `Повідомлення задовге (до ${MAX_INPUT} символів)`);

  // Latency: every check is independent, so they run in parallel instead of ~8 sequential round trips.
  const settings = await aiSettings();
  const [client, , { data: session }, quota, , { data: history }] = await Promise.all([
    aiClient(settings, "tutor_enabled"),
    assertTutorAllowed(settings, me),
    admin.from("practice_sessions").select("*").eq("id", input.session_id).maybeSingle(),
    tutorQuota(settings, me.id),
    assertGlobalBudget(settings),
    admin.from("practice_turns").select("role, content").eq("session_id", input.session_id).order("id", { ascending: false }).limit(HISTORY_TURNS),
  ]);
  if (!session || session.student_id !== me.id) throw new HttpError(404, "Сесію не знайдено");
  if (session.ended_at) throw new HttpError(409, "Сесію завершено. Почни нову 🙂");
  if (quota.messagesLeft <= 0 || quota.usdLeft <= 0) {
    throw new HttpError(429, "На сьогодні ліміт практики вичерпано. Повертайся завтра! 🦭");
  }

  const mod = moderate(raw);
  // Saved while the model is already generating; awaited before the reply is stored so turn order stays intact.
  // Supabase builders are lazy, so .then() starts the insert right away.
  const userTurn = admin.from("practice_turns").insert({ session_id: session.id, role: "user", content: mod.masked, flagged: mod.flags.length > 0 }).then((r) => r);

  return sse(async (send) => {
    const touch = (extra: Record<string, unknown> = {}) =>
      admin.from("practice_sessions").update({ turns: (session.turns ?? 0) + 1, last_activity_at: new Date().toISOString(), ...extra }).eq("id", session.id);

    if (mod.crisis) {
      await Promise.all([userTurn, flagSession(session, me, mod.flags)]);
      await admin.from("practice_turns").insert({ session_id: session.id, role: "assistant", content: CRISIS_REPLY, flagged: true });
      await touch();
      send({ type: "delta", text: CRISIS_REPLY });
      send({ type: "done", flagged: true, messages_left: quota.messagesLeft - 1 });
      return;
    }

    // Layer 5: dialogue history. The API needs a user turn first, so the stored greeting follows a synthetic opener.
    const turns = [...(history ?? [])].reverse();
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: OPENER }];
    for (const t of turns) messages.push({ role: t.role as "user" | "assistant", content: t.content });
    messages.push({ role: "user", content: mod.masked });

    // Chat replies are short, so the fast model gives the snappiest first token; only full-size models take an effort setting.
    const model = settings.model_fast;
    const stream = client.messages.stream({
      model,
      max_tokens: 700,
      ...(supportsEffort(model) ? { output_config: { effort: "low" as const } } : {}),
      cache_control: { type: "ephemeral" },
      system: [
        { type: "text", text: TUTOR_SYSTEM },
        { type: "text", text: session.context ?? "", cache_control: { type: "ephemeral" } },
      ],
      messages,
    });

    let full = "";
    let decided = false;
    let safety = false;
    let sent = 0;
    const flush = () => {
      const visible = safety ? full.trimStart().slice(TUTOR_SAFETY_MARKER.length).trimStart() : full;
      if (visible.length > sent) {
        send({ type: "delta", text: visible.slice(sent) });
        sent = visible.length;
      }
    };
    for await (const ev of stream) {
      if (ev.type !== "content_block_delta" || ev.delta.type !== "text_delta") continue;
      full += ev.delta.text;
      if (!decided) {
        const t = full.trimStart();
        if (t.length >= TUTOR_SAFETY_MARKER.length) {
          decided = true;
          safety = t.startsWith(TUTOR_SAFETY_MARKER);
        } else if (!TUTOR_SAFETY_MARKER.startsWith(t)) {
          decided = true;
        } else continue;
      }
      flush();
    }
    decided = true;
    safety = full.trimStart().startsWith(TUTOR_SAFETY_MARKER);
    flush();

    const final = await stream.finalMessage();

    let reply = safety ? full.trimStart().slice(TUTOR_SAFETY_MARKER.length).trimStart() : full;
    if (final.stop_reason === "refusal" && !reply.trim()) {
      reply = "Давай краще повернемося до англійської 🙂 Про що хочеш поговорити?";
      send({ type: "delta", text: reply });
    }
    const outFlags = moderate(reply).flags.filter((f) => f !== "contact");
    // The student is done waiting here; bookkeeping below happens before the stream closes but after "done".
    send({ type: "done", flagged: safety || mod.flags.length > 0 || outFlags.length > 0, messages_left: quota.messagesLeft - 1 });

    const flags: ModerationFlag[] = [...mod.flags, ...outFlags];
    if (safety && !mod.flags.length) flags.push("model");
    await userTurn;
    await Promise.all([
      logUsage(settings, { userId: me.id, feature: "tutor", model, usage: final.usage, refId: session.id }),
      flags.length ? flagSession(session, me, flags) : null,
      admin.from("practice_turns").insert({ session_id: session.id, role: "assistant", content: reply || "…", flagged: safety || outFlags.length > 0 }),
      touch(),
    ]);
  });
}

// ───────────── finalize (summary for the teacher + mistakes → profile) ─────────────
const summarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "strengths", "mistakes", "vocabulary_used", "engagement"],
  properties: {
    summary: { type: "string", description: "2–3 sentences in Ukrainian: what was practised and how it went" },
    strengths: { type: "array", items: { type: "string" } },
    mistakes: { type: "array", items: mistakeJsonSchema },
    vocabulary_used: { type: "array", items: { type: "string" } },
    engagement: { type: "string", enum: ["low", "medium", "high"] },
  },
};
const summaryValidator = z.object({
  summary: z.string().max(1500),
  strengths: z.array(z.string().max(300)).max(10).catch([]),
  mistakes: mistakesValidator,
  vocabulary_used: z.array(z.string().max(80)).max(40).catch([]),
  engagement: z.enum(["low", "medium", "high"]).catch("medium"),
});

async function finalize(sessionId: string) {
  const { data: session } = await admin.from("practice_sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!session) throw new HttpError(404, "Сесію не знайдено");
  if (session.ended_at) return { summary: session.summary };
  const { data: turns } = await admin.from("practice_turns").select("role, content").eq("session_id", sessionId).order("id");
  const userTurns = (turns ?? []).filter((t) => t.role === "user");
  if (!userTurns.length) {
    await admin.from("practice_sessions").update({ ended_at: new Date().toISOString() }).eq("id", sessionId);
    return { summary: null };
  }
  let summary: z.infer<typeof summaryValidator> | null = null;
  try {
    const settings = await aiSettings();
    const client = await aiClient(settings);
    const transcript = (turns ?? []).map((t) => `${t.role === "user" ? "STUDENT" : "COACH"}: ${t.content}`).join("\n").slice(-24_000);
    const res = await structuredCall({
      client, settings,
      model: settings.model_fast,
      system: PRACTICE_SUMMARY_SYSTEM,
      content: `Practice transcript:\n${transcript}`,
      schema: summarySchema,
      validator: summaryValidator,
      maxTokens: 2000,
      feature: "practice_summary",
      userId: session.student_id,
      refId: sessionId,
    });
    summary = res.data;
    if (summary.mistakes.length) {
      await admin.rpc("ingest_mistakes", { p_student: session.student_id, p_source: "practice", p_source_id: sessionId, p_items: summary.mistakes });
    }
  } catch (e) {
    await logError("ai-tutor:finalize", e, { session_id: sessionId });
  }
  await admin.from("practice_sessions").update({ ended_at: new Date().toISOString(), summary }).eq("id", sessionId);
  return { summary };
}

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
  if (await isInternal(req)) {
    const input = await readJson<Any>(req);
    if (input.action !== "finalize" || !input.session_id) throw new HttpError(400, "Невідома дія");
    return json(await finalize(input.session_id));
  }
  const { profile } = await requireUser(req, ["student"]);
  const input = await readJson<Any>(req);
  switch (input.action) {
    case "start":
      return json(await start(profile, input));
    case "message":
      return await message(profile, input);
    case "end": {
      const { data: s } = await admin.from("practice_sessions").select("student_id").eq("id", input.session_id).maybeSingle();
      if (!s || s.student_id !== profile.id) throw new HttpError(404, "Сесію не знайдено");
      return json(await finalize(input.session_id));
    }
    default:
      throw new HttpError(400, "Невідома дія");
  }
}));
