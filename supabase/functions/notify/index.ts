// Internal: called by the DB (pg_net) → delivers to Telegram.
//   {id}                                     a notification row (retried by cron up to 3 times on failure)
//   {lead_lesson: {lesson_id, event}}        trial lesson reminder / move / cancel for leads (no account)
//   {parent_report: {contact_id}}            weekly parent report (FR-20, only with consent)
import { admin, fmtKyiv, handle, HttpError, isInternal, json, readJson, siteUrl } from "../_shared/core.ts";
import { esc, isPublicHttps, sendLeadCard, sendMessage, type InlineKeyboard } from "../_shared/telegram.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const ICONS: Record<string, string> = {
  homework_new: "📚",
  homework_due: "⏰",
  homework_submitted: "📥",
  homework_reviewed: "⭐️",
  lesson_new: "🗓",
  lesson_moved: "🔁",
  lesson_cancelled: "🚫",
  lesson_reminder: "🔔",
  trial_new: "🎁",
  practice_flagged: "⚠️",
  risk_high: "📉",
  ai_report: "🤖",
  info: "💙",
};

const blocked = (description?: string) => /blocked|deactivated|chat not found|user is deactivated/i.test(description ?? "");

async function deliverNotification(id: string) {
  const { data: n } = await admin
    .from("notifications")
    .select("*, user:profiles!notifications_user_id_fkey(telegram_chat_id, notify_telegram, is_active)")
    .eq("id", id)
    .maybeSingle();
  if (!n) return { ok: false, reason: "not_found" };
  const chatId: number | null = n.user?.telegram_chat_id ?? null;
  // sent/skipped are final; failed is retried by the scheduler (tg_attempts < 3)
  if (n.tg_status === "sent" || n.tg_status === "skipped" || n.tg_attempts >= 3) return { ok: true, skipped: true };
  if (!chatId || !n.user?.notify_telegram || !n.user?.is_active) {
    await admin.from("notifications").update({ tg_status: "skipped" }).eq("id", id);
    return { ok: true, skipped: true };
  }

  let res;
  if (n.kind === "lead_new" && n.data?.lead_id) {
    res = await sendLeadCard(chatId, n.data.lead_id);
  } else {
    const site = await siteUrl();
    const keyboard: InlineKeyboard = [];
    if (isPublicHttps(n.data?.meet_url) && ["lesson_reminder", "lesson_new", "lesson_moved", "trial_new"].includes(n.kind)) {
      keyboard.push([{ text: "🎥 Приєднатися до уроку", url: n.data.meet_url }]);
    }
    if (n.link && isPublicHttps(site)) keyboard.push([{ text: "Відкрити в кабінеті →", url: `${site}${n.link}` }]);
    const text = `${ICONS[n.kind] ?? "💙"} <b>${esc(n.title)}</b>${n.body ? `\n${esc(n.body)}` : ""}`;
    res = await sendMessage(chatId, text, keyboard.length ? { reply_markup: { inline_keyboard: keyboard } } : {});
  }

  const status = res === null ? "skipped" : res.ok ? "sent" : "failed";
  await admin.from("notifications").update({
    tg_status: status,
    tg_attempts: (n.tg_attempts ?? 0) + 1,
    tg_error: res && !res.ok ? String(res.description ?? "unknown").slice(0, 300) : null,
  }).eq("id", id);
  // User blocked the bot → stop trying.
  if (res && !res.ok && blocked(res.description)) {
    await admin.from("profiles").update({ notify_telegram: false }).eq("telegram_chat_id", chatId);
  }
  return { ok: true, status };
}

async function leadLesson(lessonId: string, event: "reminder" | "moved" | "cancelled") {
  const { data: lesson } = await admin
    .from("lessons")
    .select("id, starts_at, ends_at, meet_url, status, teacher:profiles!lessons_teacher_id_fkey(full_name), lesson_leads(lead:leads(id, name, telegram_chat_id, status))")
    .eq("id", lessonId)
    .maybeSingle();
  if (!lesson) return { ok: false };
  const when = `${fmtKyiv(lesson.starts_at, { weekday: "long" })}`;
  const meet = isPublicHttps(lesson.meet_url) ? { inline_keyboard: [[{ text: "🎥 Приєднатися до уроку", url: lesson.meet_url }]] } : undefined;
  let sent = 0;
  for (const ll of (lesson.lesson_leads ?? []) as Any[]) {
    const lead = ll.lead;
    if (!lead?.telegram_chat_id || ["won", "lost"].includes(lead.status)) continue;
    const text = event === "reminder"
      ? `🔔 <b>Скоро пробний урок!</b>\n\n🗓 ${esc(when)}\n👩‍🏫 ${esc((lesson as Any).teacher?.full_name ?? "Викладач Seal English")}\n\nПідготуйте, будь ласка, навушники й камеру. До зустрічі! 🦭`
      : event === "moved"
        ? `🔁 <b>Пробний урок перенесено</b>\n\nНовий час: ${esc(when)}.\nЯкщо час не підходить — просто напишіть сюди, менеджер допоможе.`
        : `🚫 <b>Пробний урок скасовано</b>\n\nМенеджер зв'яжеться з вами, щоб узгодити інший час. Вибачте за незручності 🙏`;
    const res = await sendMessage(lead.telegram_chat_id, text, event !== "cancelled" && meet ? { reply_markup: meet } : {});
    if (res?.ok) sent++;
  }
  return { ok: true, sent };
}

async function parentReport(contactId: string) {
  const { data: c } = await admin
    .from("parent_contacts")
    .select("*, student:profiles!parent_contacts_student_id_fkey(id, full_name, is_active)")
    .eq("id", contactId)
    .maybeSingle();
  if (!c || c.revoked_at || !c.student?.is_active) return { ok: false };
  const sid = c.student.id;
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data: groups } = await admin.from("group_members").select("group_id").eq("student_id", sid);
  const groupIds = (groups ?? []).map((g) => g.group_id);
  const lessonFilter = groupIds.length ? `student_id.eq.${sid},group_id.in.(${groupIds.join(",")})` : `student_id.eq.${sid}`;

  const [{ data: past }, { data: att }, { data: subs }, { data: upcoming }, { data: practice }, { data: due }] = await Promise.all([
    admin.from("lessons").select("id").or(lessonFilter).neq("status", "cancelled").gte("starts_at", since).lte("starts_at", new Date().toISOString()),
    admin.from("lesson_attendance").select("status, lesson:lessons!inner(starts_at)").eq("student_id", sid).gte("lesson.starts_at", since),
    admin.from("submissions").select("status, score, reviewed_at, assignment:assignments(title, max_score)").eq("student_id", sid).gte("submitted_at", since),
    admin.from("lessons").select("starts_at").or(lessonFilter).eq("status", "scheduled").gte("starts_at", new Date().toISOString()).order("starts_at").limit(1),
    admin.from("practice_sessions").select("id").eq("student_id", sid).gte("started_at", since),
    admin.from("assignments").select("id, submissions(student_id)").or(groupIds.length ? `student_id.eq.${sid},group_id.in.(${groupIds.join(",")})` : `student_id.eq.${sid}`).gte("due_at", since).lte("due_at", new Date().toISOString()),
  ]);
  const present = (att ?? []).filter((a) => a.status !== "absent").length;
  const missed = (due ?? []).filter((a: Any) => !(a.submissions ?? []).some((s: Any) => s.student_id === sid)).length;
  const graded = (subs ?? []).filter((s: Any) => s.status === "reviewed" && s.score != null) as Any[];
  const first = (c.student.full_name ?? "").split(" ")[0];
  const lines = [
    `📊 <b>Тиждень у Seal English: ${esc(first)}</b>`,
    "",
    `🎓 Уроки: ${present} з ${(past ?? []).length}${(att ?? []).length < (past ?? []).length ? " (відвідуваність відмічено не для всіх уроків)" : ""}`,
    `📝 Домашні завдання: здано ${(subs ?? []).length}${missed ? `, не здано вчасно — ${missed}` : ""}`,
  ];
  if (graded.length) lines.push(`⭐️ Оцінки: ${graded.map((s) => `${esc(s.assignment?.title ?? "ДЗ")} — ${s.score}/${s.assignment?.max_score}`).join("; ")}`);
  if ((practice ?? []).length) lines.push(`🦭 Практика з ШІ-тренером: ${(practice ?? []).length} сесій`);
  if (upcoming?.[0]) lines.push(`🗓 Наступний урок: ${esc(fmtKyiv(upcoming[0].starts_at, { weekday: "long" }))}`);
  lines.push("", "<i>Звіт надсилається раз на тиждень. Щоб відписатися — надішліть /stop.</i>");
  const res = await sendMessage(c.telegram_chat_id, lines.join("\n"));
  if (res?.ok) await admin.from("parent_contacts").update({ last_report_at: new Date().toISOString() }).eq("id", contactId);
  else if (res && blocked(res.description)) await admin.from("parent_contacts").update({ revoked_at: new Date().toISOString() }).eq("id", contactId);
  return { ok: !!res?.ok };
}

Deno.serve(handle(async (req) => {
  if (!(await isInternal(req))) throw new HttpError(401, "unauthorized");
  const body = await readJson<Any>(req);
  if (body.lead_lesson) return json(await leadLesson(body.lead_lesson.lesson_id, body.lead_lesson.event));
  if (body.parent_report) return json(await parentReport(body.parent_report.contact_id));
  if (body.id) return json(await deliverNotification(body.id));
  throw new HttpError(400, "bad request");
}));
