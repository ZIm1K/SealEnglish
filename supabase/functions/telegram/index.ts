// Telegram bot webhook: trial sign-up, lead management for staff, schedule & homework for students/teachers.
import {
  admin, fmtKyiv, fmtKyivDay, fmtKyivTime, getSecret, handle, HttpError, isStaff, json, logError, siteUrl,
  timingSafeEqual, TZ, type Profile,
} from "../_shared/core.ts";
import { aiClient, aiSettings, assertGlobalBudget, logUsage, textOf } from "../_shared/ai.ts";
import { nightReplySystem } from "../_shared/prompts.ts";
import { SCHOOL_FACTS } from "../_shared/school.ts";
import {
  AGE_GROUP, esc, isPublicHttps, LEAD_STATUS, leadCard, leadKeyboard, loadLead, sendLeadCard, sendMessage, tg,
  type InlineKeyboard,
} from "../_shared/telegram.ts";

const MASCOT = "Сілі";

const BTN = {
  trial: "🎁 Безкоштовний пробний урок",
  about: "ℹ️ Про школу",
  login: "🔑 Особистий кабінет",
  next: "🎥 Найближчий урок",
  schedule: "📅 Мій розклад",
  homework: "📝 Домашні завдання",
  review: "📥 На перевірку",
  leadsNew: "🆕 Нові заявки",
  leadsActive: "📋 Заявки в роботі",
  cabinet: "🌐 Кабінет",
  cancel: "✖️ Скасувати",
} as const;

// deno-lint-ignore no-explicit-any
type Any = any;

interface Session {
  chat_id: number;
  state: string | null;
  data: Record<string, Any>;
}

// ───────────── helpers ─────────────
async function getSession(chatId: number): Promise<Session> {
  const { data } = await admin.from("tg_sessions").select("*").eq("chat_id", chatId).maybeSingle();
  return (data as Session) ?? { chat_id: chatId, state: null, data: {} };
}
async function setSession(chatId: number, state: string | null, data: Record<string, Any> = {}) {
  await admin.from("tg_sessions").upsert({ chat_id: chatId, state, data, updated_at: new Date().toISOString() });
}
async function clearSession(chatId: number) {
  await admin.from("tg_sessions").delete().eq("chat_id", chatId);
}
async function profileByChat(chatId: number): Promise<Profile | null> {
  const { data } = await admin.from("profiles").select("*").eq("telegram_chat_id", chatId).eq("is_active", true).maybeSingle();
  return data as Profile | null;
}

function menuFor(p: Profile | null) {
  let rows: string[][];
  if (!p) rows = [[BTN.trial], [BTN.about, BTN.login]];
  else if (isStaff(p)) rows = [[BTN.leadsNew, BTN.leadsActive], [BTN.schedule, BTN.cabinet]];
  else if (p.role === "teacher") rows = [[BTN.next, BTN.schedule], [BTN.review, BTN.cabinet]];
  else rows = [[BTN.next, BTN.schedule], [BTN.homework, BTN.cabinet]];
  return { keyboard: rows.map((r) => r.map((text) => ({ text }))), resize_keyboard: true, is_persistent: true };
}

async function cabinetButton(path = "/app/", text = "Відкрити кабінет →"): Promise<InlineKeyboard> {
  const site = await siteUrl();
  return isPublicHttps(site) ? [[{ text, url: `${site}${path}` }]] : [];
}

function firstName(p: Profile | null, fallback?: string) {
  return (p?.full_name || fallback || "").split(" ")[0] || "друже";
}

// ───────────── lessons & homework ─────────────
async function studentGroupIds(id: string): Promise<string[]> {
  const { data } = await admin.from("group_members").select("group_id").eq("student_id", id);
  return (data ?? []).map((r) => r.group_id);
}

async function upcomingLessons(p: Profile, days: number, limit: number) {
  const now = new Date();
  let q = admin
    .from("lessons")
    .select("id, kind, title, topic, starts_at, ends_at, meet_url, group:groups(name), student:profiles!lessons_student_id_fkey(full_name), lesson_leads(lead:leads(name)), teacher:profiles!lessons_teacher_id_fkey(full_name)")
    .eq("status", "scheduled")
    .gte("ends_at", now.toISOString())
    .lte("starts_at", new Date(now.getTime() + days * 86400_000).toISOString())
    .order("starts_at")
    .limit(limit);
  if (p.role === "teacher") q = q.eq("teacher_id", p.id);
  else if (p.role === "student") {
    const groups = await studentGroupIds(p.id);
    q = groups.length ? q.or(`student_id.eq.${p.id},group_id.in.(${groups.join(",")})`) : q.eq("student_id", p.id);
  }
  const { data } = await q;
  return (data ?? []) as Any[];
}

function lessonLabel(l: Any, p: Profile) {
  const leads = (l.lesson_leads ?? []).map((x: Any) => x.lead?.name).filter(Boolean);
  const who = l.group?.name ?? l.student?.full_name ?? (leads.length ? `Пробний · ${leads.join(", ")}` : "");
  const title = l.title ?? (l.kind === "trial" ? "Пробний урок" : "Урок англійської");
  if (p.role === "student") return `${title}${l.teacher?.full_name ? ` · ${l.teacher.full_name}` : ""}`;
  return `${title}${who ? ` · ${who}` : ""}${isStaff(p) && l.teacher?.full_name ? ` · ${l.teacher.full_name}` : ""}`;
}

async function sendSchedule(chatId: number, p: Profile) {
  const days = isStaff(p) ? 2 : 7;
  const lessons = await upcomingLessons(p, days, 25);
  if (!lessons.length) {
    await sendMessage(chatId, `🌊 На найближчі ${days === 7 ? "7 днів" : "2 дні"} уроків немає.`, {
      reply_markup: { inline_keyboard: await cabinetButton("/app/schedule/", "Розклад у кабінеті →") },
    });
    return;
  }
  const lines = [`📅 <b>${isStaff(p) ? "Уроки школи на 2 дні" : "Ваш розклад на тиждень"}</b>`];
  let day = "";
  for (const l of lessons) {
    const d = fmtKyivDay(l.starts_at);
    if (d !== day) {
      day = d;
      lines.push("", `<b>${esc(d[0].toUpperCase() + d.slice(1))}</b>`);
    }
    const meet = isPublicHttps(l.meet_url) ? ` · <a href="${esc(l.meet_url)}">Meet</a>` : "";
    lines.push(`• ${fmtKyivTime(l.starts_at)}–${fmtKyivTime(l.ends_at)} ${esc(lessonLabel(l, p))}${meet}`);
  }
  await sendMessage(chatId, lines.join("\n"), {
    reply_markup: { inline_keyboard: await cabinetButton("/app/schedule/", "Повний розклад →") },
  });
}

async function sendNextLesson(chatId: number, p: Profile) {
  const [l] = await upcomingLessons(p, 30, 1);
  if (!l) {
    await sendMessage(chatId, "🌊 Найближчих уроків поки немає. Відпочивайте! 🦭");
    return;
  }
  const kb: InlineKeyboard = [];
  if (isPublicHttps(l.meet_url)) kb.push([{ text: "🎥 Приєднатися до уроку", url: l.meet_url }]);
  kb.push(...(await cabinetButton("/app/schedule/", "Розклад у кабінеті →")));
  const topic = l.topic ? `\n📖 Тема: ${esc(l.topic)}` : "";
  await sendMessage(chatId, `🔔 <b>Найближчий урок</b>\n\n${esc(lessonLabel(l, p))}\n🗓 ${esc(fmtKyivDay(l.starts_at))}, ${fmtKyivTime(l.starts_at)}–${fmtKyivTime(l.ends_at)}${topic}`, {
    reply_markup: { inline_keyboard: kb },
  });
}

async function sendHomework(chatId: number, p: Profile) {
  const groups = await studentGroupIds(p.id);
  let q = admin.from("assignments").select("id, title, due_at, submissions(status, score, student_id)").order("due_at", { ascending: true, nullsFirst: false }).limit(30);
  q = groups.length ? q.or(`student_id.eq.${p.id},group_id.in.(${groups.join(",")})`) : q.eq("student_id", p.id);
  const { data } = await q;
  const open = (data ?? []).filter((a: Any) => {
    const mine = (a.submissions ?? []).find((s: Any) => s.student_id === p.id);
    return !mine || mine.status === "needs_revision";
  });
  if (!open.length) {
    await sendMessage(chatId, "✨ Усі домашні завдання здано. Ти супер! 🦭", {
      reply_markup: { inline_keyboard: await cabinetButton("/app/homework/", "Домашні завдання →") },
    });
    return;
  }
  const site = await siteUrl();
  const lines = ["📝 <b>Домашні завдання</b>", ""];
  for (const a of open.slice(0, 12) as Any[]) {
    const mine = (a.submissions ?? []).find((s: Any) => s.student_id === p.id);
    const late = a.due_at && new Date(a.due_at) < new Date();
    const due = a.due_at ? ` · ${late ? "⚠️ прострочено" : "до"} ${fmtKyiv(a.due_at)}` : "";
    const title = isPublicHttps(site) ? `<a href="${site}/app/homework/view/?id=${a.id}">${esc(a.title)}</a>` : esc(a.title);
    lines.push(`• ${title}${due}${mine?.status === "needs_revision" ? " · 🔁 доопрацювати" : ""}`);
  }
  await sendMessage(chatId, lines.join("\n"));
}

async function sendReviewQueue(chatId: number, p: Profile) {
  const { data } = await admin
    .from("submissions")
    .select("id, submitted_at, student:profiles!submissions_student_id_fkey(full_name), assignment:assignments!inner(id, title, teacher_id)")
    .eq("status", "submitted")
    .eq("assignment.teacher_id", p.id)
    .order("submitted_at")
    .limit(20);
  if (!data?.length) {
    await sendMessage(chatId, "✨ Немає робіт на перевірку.");
    return;
  }
  const site = await siteUrl();
  const lines = [`📥 <b>На перевірку: ${data.length}</b>`, ""];
  for (const s of data as Any[]) {
    const t = isPublicHttps(site) ? `<a href="${site}/app/homework/view/?id=${s.assignment.id}">${esc(s.assignment.title)}</a>` : esc(s.assignment.title);
    lines.push(`• ${esc(s.student?.full_name ?? "Учень")} — ${t} <i>(${fmtKyiv(s.submitted_at)})</i>`);
  }
  await sendMessage(chatId, lines.join("\n"));
}

// ───────────── leads (staff) ─────────────
async function sendLeadList(chatId: number, statuses: string[], title: string) {
  const { data } = await admin
    .from("leads")
    .select("id, no, name, age_group, status, created_at")
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .limit(15);
  if (!data?.length) {
    await sendMessage(chatId, `${title}\n\nПорожньо ✨`);
    return;
  }
  const kb: InlineKeyboard = data.map((l: Any) => [{
    text: `${LEAD_STATUS[l.status]?.emoji ?? ""} #${l.no} · ${l.name}${l.age_group ? ` · ${AGE_GROUP[l.age_group]}` : ""}`.slice(0, 60),
    callback_data: `lv:${l.id}`,
  }]);
  await sendMessage(chatId, `${title} <i>(${data.length})</i>\nОберіть заявку:`, { reply_markup: { inline_keyboard: kb } });
}

async function refreshLeadMessage(chatId: number, messageId: number, leadId: string) {
  const lead = await loadLead(leadId);
  if (!lead) return;
  await tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: await leadCard(lead),
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: await leadKeyboard(lead) },
  });
}

// ───────────── trial sign-up flow ─────────────
const TIME_SLOTS: Record<string, string> = {
  morning: "Ранок (9–12)",
  day: "День (12–16)",
  evening: "Вечір (16–21)",
  weekend: "Вихідні",
  any: "Будь-коли",
};

async function startTrial(chatId: number) {
  await setSession(chatId, "trial:name", {});
  await sendMessage(chatId, `🎁 <b>Запис на безкоштовний пробний урок</b>\n\nПробний урок проходить у Google Meet у міні-групі до 4 учасників (60 хв) або індивідуально (30 хв): знайомимось, визначаємо рівень і складаємо план навчання.\n\nЯк звати учня? ✍️`, {
    reply_markup: { keyboard: [[{ text: BTN.cancel }]], resize_keyboard: true, one_time_keyboard: false },
  });
}

async function askPhone(chatId: number) {
  const site = await siteUrl();
  const privacy = isPublicHttps(site) ? `<a href="${site}/privacy/">політикою конфіденційності</a>` : "політикою конфіденційності";
  await sendMessage(chatId, `📱 Залиште номер телефону, щоб менеджер міг зв'язатися. Можна натиснути кнопку нижче або ввести номер вручну.\n\n<i>Надсилаючи номер, ви (або один із батьків, якщо учню менше 18) погоджуєтесь з ${privacy}.</i>`, {
    reply_markup: {
      keyboard: [[{ text: "📱 Поділитися номером", request_contact: true }], [{ text: BTN.cancel }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

async function askTime(chatId: number) {
  const kb: InlineKeyboard = [
    [{ text: TIME_SLOTS.morning, callback_data: "tt:morning" }, { text: TIME_SLOTS.day, callback_data: "tt:day" }],
    [{ text: TIME_SLOTS.evening, callback_data: "tt:evening" }, { text: TIME_SLOTS.weekend, callback_data: "tt:weekend" }],
    [{ text: TIME_SLOTS.any, callback_data: "tt:any" }],
  ];
  await sendMessage(chatId, "🕐 Коли зручно займатися?", { reply_markup: { inline_keyboard: kb } });
}

async function finishTrial(chatId: number, from: Any, s: Session) {
  const d = s.data;
  const { data: lead, error } = await admin
    .from("leads")
    .insert({
      name: d.name,
      phone: d.phone,
      age_group: d.age_group ?? null,
      preferred_time: d.time ?? null,
      source: "telegram",
      telegram_chat_id: chatId,
      telegram_username: from?.username ?? null,
    })
    .select("no")
    .single();
  await clearSession(chatId);
  if (error) {
    await logError("telegram:lead", error.message);
    await sendMessage(chatId, "😔 Не вдалося зберегти заявку. Спробуйте ще раз трохи пізніше.", { reply_markup: menuFor(null) });
    return;
  }
  await sendMessage(chatId, `🎉 <b>Дякуємо, заявку #${lead.no} прийнято!</b>\n\nМенеджер зв'яжеться з вами найближчим часом, щоб узгодити час пробного уроку. Після призначення уроку я надішлю сюди посилання на Google Meet 🦭`, {
    reply_markup: menuFor(await profileByChat(chatId)),
  });
}

// ───────────── parents: weekly reports with consent (FR-20) ─────────────
async function parentInvite(chatId: number, code: string) {
  const { data: link } = await admin
    .from("parent_link_codes")
    .select("student_id, expires_at, student:profiles!parent_link_codes_student_id_fkey(full_name)")
    .eq("code", code)
    .maybeSingle();
  if (!link || new Date(link.expires_at) < new Date()) {
    return sendMessage(chatId, "⏳ Посилання застаріло. Попросіть у менеджера школи нове.");
  }
  const name = ((link as Any).student?.full_name ?? "").split(" ")[0];
  const site = await siteUrl();
  return sendMessage(chatId, `👋 Вітаємо! Це бот школи Seal English.\n\nРаз на тиждень ми можемо надсилати вам короткий звіт про навчання <b>${esc(name)}</b>: відвідування уроків, домашні завдання й оцінки, активність практики. Лише зведені дані — без листування учня.\n\nВідписатися можна будь-коли командою /stop.${isPublicHttps(site) ? `\nДетальніше: ${site}/privacy/` : ""}\n\nПогоджуєтесь отримувати звіти й на обробку цих даних?`, {
    reply_markup: { inline_keyboard: [[{ text: "✅ Так, погоджуюсь", callback_data: `pc:${code}` }, { text: "Ні", callback_data: "pn" }]] },
  });
}

async function parentConsent(chatId: number, from: Any, code: string) {
  const { data: link } = await admin.from("parent_link_codes").select("student_id, expires_at").eq("code", code).maybeSingle();
  if (!link || new Date(link.expires_at) < new Date()) return false;
  await admin.from("parent_contacts").upsert({
    student_id: link.student_id,
    telegram_chat_id: chatId,
    name: [from?.first_name, from?.last_name].filter(Boolean).join(" ") || null,
    consent_at: new Date().toISOString(),
    consent_source: "telegram_bot",
    revoked_at: null,
  }, { onConflict: "student_id,telegram_chat_id" });
  await admin.from("parent_link_codes").delete().eq("code", code);
  return true;
}

async function stopReports(chatId: number) {
  const { data } = await admin.from("parent_contacts").update({ revoked_at: new Date().toISOString() }).eq("telegram_chat_id", chatId).is("revoked_at", null).select("id");
  return sendMessage(chatId, data?.length ? "Готово, звіти більше не надходитимуть. Повернутися можна за новим посиланням від школи 💙" : "У вас немає активних підписок на звіти.");
}

// ───────────── night answers for visitors (FR-23) ─────────────
function isNight(): boolean {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return h >= 21 || h < 8;
}

async function nightReply(chatId: number, text: string): Promise<boolean> {
  try {
    const settings = await aiSettings();
    if (!settings.night_reply_enabled || !isNight() || text.length < 3 || text.length > 800) return false;
    const { data: ok } = await admin.rpc("hit_rate_limit", { p_bucket: `night:${chatId}`, p_max: 8, p_window_seconds: 12 * 3600 });
    if (ok === false) return false;
    const client = await aiClient(settings);
    await assertGlobalBudget(settings);
    const msg = await client.messages.create({
      model: settings.model_fast,
      max_tokens: 500,
      system: nightReplySystem(SCHOOL_FACTS),
      messages: [{ role: "user", content: text }],
    });
    await logUsage(settings, { userId: null, feature: "bot_night", model: settings.model_fast, usage: msg.usage });
    const answer = textOf(msg).trim();
    if (!answer || msg.stop_reason === "refusal") return false;
    await sendMessage(chatId, `${esc(answer)}\n\n<i>🌙 Це автоматична відповідь Сілі. Менеджер відповість зранку.</i>`, {
      reply_markup: { inline_keyboard: [[{ text: BTN.trial, callback_data: "trial" }]] },
    });
    return true;
  } catch (e) {
    await logError("telegram:night", e);
    return false;
  }
}

// ───────────── routing ─────────────
async function greet(chatId: number, p: Profile | null, fromName?: string) {
  if (!p) {
    await sendMessage(chatId, `👋 Привіт, ${esc(fromName || "друже")}! Я ${MASCOT} — тюлень-талісман школи англійської <b>Seal English</b> 🦭📘\n\nТут можна записатися на <b>безкоштовний пробний урок</b>, а наші учні й викладачі отримують розклад, нагадування про уроки та домашні завдання.`, {
      reply_markup: menuFor(null),
    });
    return;
  }
  const roleText = isStaff(p)
    ? "Сюди приходитимуть нові заявки з сайту й бота. Статуси можна змінювати просто з повідомлення."
    : p.role === "teacher"
      ? "Надсилатиму нагадування про уроки та нові роботи на перевірку."
      : "Надсилатиму нагадування про уроки, нові домашні завдання й оцінки.";
  await sendMessage(chatId, `👋 Привіт, ${esc(firstName(p))}! ${roleText}`, { reply_markup: menuFor(p) });
}

async function linkAccount(chatId: number, from: Any, code: string) {
  const { data: link } = await admin
    .from("tg_link_codes")
    .select("user_id, expires_at")
    .eq("code", code)
    .maybeSingle();
  if (!link || new Date(link.expires_at) < new Date()) {
    await sendMessage(chatId, "⏳ Посилання застаріло. Згенеруйте нове в кабінеті: Налаштування → Telegram.");
    return;
  }
  await admin.from("profiles").update({ telegram_chat_id: null, telegram_username: null }).eq("telegram_chat_id", chatId).neq("id", link.user_id);
  const { data: p } = await admin
    .from("profiles")
    .update({ telegram_chat_id: chatId, telegram_username: from?.username ?? null, notify_telegram: true })
    .eq("id", link.user_id)
    .select("*")
    .single();
  await admin.from("tg_link_codes").delete().eq("code", code);
  await clearSession(chatId);
  await sendMessage(chatId, `✅ <b>Акаунт підключено!</b>\nТепер усі сповіщення з кабінету приходитимуть сюди.`);
  await greet(chatId, p as Profile);
}

async function onMessage(msg: Any) {
  const chatId: number = msg.chat.id;
  if (msg.chat.type !== "private") return;
  const text: string = (msg.text ?? "").trim();
  const from = msg.from;
  const p = await profileByChat(chatId);

  if (text.startsWith("/start")) {
    const payload = text.split(/\s+/)[1] ?? "";
    if (payload.startsWith("link_")) return linkAccount(chatId, from, payload.slice(5));
    if (payload.startsWith("parent_")) return parentInvite(chatId, payload.slice(7));
    if (payload === "trial") return startTrial(chatId);
    await clearSession(chatId);
    return greet(chatId, p, from?.first_name);
  }
  if (text === "/cancel" || text === BTN.cancel) {
    await clearSession(chatId);
    return sendMessage(chatId, "Гаразд, скасовано 👌", { reply_markup: menuFor(p) });
  }
  if (text === "/menu" || text === "/help") return greet(chatId, p, from?.first_name);
  if (text === "/stop") return stopReports(chatId);

  // stateful flows
  const s = await getSession(chatId);
  if (s.state === "trial:name") {
    if (text.length < 2 || text.startsWith("/")) return sendMessage(chatId, "Напишіть, будь ласка, ім'я учня ✍️");
    await setSession(chatId, "trial:age", { ...s.data, name: text.slice(0, 80) });
    return sendMessage(chatId, "Скільки років учню? Оберіть групу:", {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🧒 Діти 6–11", callback_data: "ta:kids" }, { text: "🧑‍🎓 Підлітки 12–18", callback_data: "ta:teens" }],
          [{ text: "💼 Дорослі", callback_data: "ta:adults" }],
        ],
      },
    });
  }
  if (s.state === "trial:phone") {
    const phone = (msg.contact?.phone_number ?? text).replace(/[^\d+]/g, "");
    const digits = phone.replace(/\D/g, "").length;
    if (digits < 9 || digits > 15) return sendMessage(chatId, "Схоже, номер неповний. Спробуйте ще раз 📱");
    await setSession(chatId, "trial:time", { ...s.data, phone: phone.startsWith("+") ? phone : `+${phone}` });
    await sendMessage(chatId, "Дякую! 🙌", { reply_markup: { remove_keyboard: true } });
    return askTime(chatId);
  }
  if (s.state === "note" && p && isStaff(p)) {
    if (!text || text.startsWith("/")) return sendMessage(chatId, "Напишіть текст нотатки або /cancel");
    await admin.from("lead_events").insert({ lead_id: s.data.lead_id, kind: "note", body: text.slice(0, 1000), actor_id: p.id, actor_name: "Telegram" });
    await clearSession(chatId);
    await sendMessage(chatId, "📝 Нотатку додано", { reply_markup: menuFor(p) });
    if (s.data.message_id) await refreshLeadMessage(chatId, s.data.message_id, s.data.lead_id);
    return;
  }

  // menu buttons
  switch (text) {
    case BTN.trial:
      return startTrial(chatId);
    case BTN.about: {
      const site = await siteUrl();
      return sendMessage(chatId, `🦭 <b>Seal English</b> — онлайн-школа англійської для підлітків 12–18 (а також дітей і дорослих).\n\n• живі уроки в Google Meet з викладачем\n• особистий кабінет з розкладом, матеріалами й домашкою\n• нагадування тут, у Telegram\n\n<b>Ціни за урок</b> (помісячно / пакетом):\n• міні-група 4–6 учнів, 60 хв — 300 / 270 ₴\n• індивідуально, 50 хв — 450 / 420 ₴\n• підготовка до НМТ, 60 хв — 300 / 270 ₴\n\nПерший урок — безкоштовно 🎁`, {
        reply_markup: { inline_keyboard: [[{ text: BTN.trial, callback_data: "trial" }], ...(isPublicHttps(site) ? [[{ text: "Сайт школи →", url: site }]] : [])] },
      });
    }
    case BTN.login:
    case BTN.cabinet: {
      if (!p) {
        return sendMessage(chatId, "🔑 Особистий кабінет з'являється після запису до школи.\n\nЯкщо ви вже навчаєтесь — увійдіть на сайті й натисніть <b>Профіль → Підключити Telegram</b>, щоб отримувати сповіщення тут.", {
          reply_markup: { inline_keyboard: await cabinetButton("/login/", "Увійти в кабінет →") },
        });
      }
      return sendMessage(chatId, "🌐 Ваш кабінет:", { reply_markup: { inline_keyboard: await cabinetButton() } });
    }
  }
  if (p) {
    if (text === BTN.schedule) return sendSchedule(chatId, p);
    if (text === BTN.next) return sendNextLesson(chatId, p);
    if (text === BTN.homework && p.role === "student") return sendHomework(chatId, p);
    if (text === BTN.review && (p.role === "teacher" || isStaff(p))) return sendReviewQueue(chatId, p);
    if (isStaff(p) && text === BTN.leadsNew) return sendLeadList(chatId, ["new"], "🆕 <b>Нові заявки</b>");
    if (isStaff(p) && text === BTN.leadsActive) return sendLeadList(chatId, ["contacted", "trial_scheduled", "trial_done"], "📋 <b>Заявки в роботі</b>");
  }
  if (!p && !text.startsWith("/") && (await nightReply(chatId, text))) return;
  return sendMessage(chatId, p
    ? "Я поки не розумію це повідомлення 🦭 Скористайтеся меню нижче."
    : "Я поки не розумію це повідомлення 🦭 Скористайтеся меню нижче — або запишіться на пробний урок, і менеджер відповість на всі питання.", { reply_markup: menuFor(p) });
}

async function onCallback(cq: Any) {
  const chatId: number = cq.message?.chat?.id;
  const messageId: number = cq.message?.message_id;
  const data: string = cq.data ?? "";
  const answer = (text?: string, alert = false) => tg("answerCallbackQuery", { callback_query_id: cq.id, text, show_alert: alert });
  if (!chatId) return answer();

  if (data === "trial") {
    await answer();
    return startTrial(chatId);
  }
  if (data.startsWith("ta:")) {
    const s = await getSession(chatId);
    if (s.state !== "trial:age") return answer("Почніть запис заново: /start");
    const age = data.slice(3);
    await setSession(chatId, "trial:phone", { ...s.data, age_group: age });
    await answer(AGE_GROUP[age]);
    await tg("editMessageText", { chat_id: chatId, message_id: messageId, text: `Група: <b>${esc(AGE_GROUP[age] ?? age)}</b> ✓`, parse_mode: "HTML" });
    return askPhone(chatId);
  }
  if (data.startsWith("pc:")) {
    const ok = await parentConsent(chatId, cq.from, data.slice(3));
    await answer(ok ? "Дякуємо!" : "Посилання застаріло", !ok);
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
    if (ok) await sendMessage(chatId, "✅ Готово! Перший звіт прийде в неділю ввечері. Відписатися — /stop");
    return;
  }
  if (data === "pn") {
    await answer("Гаразд");
    return tg("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
  }
  if (data.startsWith("tt:")) {
    const s = await getSession(chatId);
    if (s.state !== "trial:time") return answer("Почніть запис заново: /start");
    const slot = TIME_SLOTS[data.slice(3)] ?? "Будь-коли";
    await answer(slot);
    await tg("editMessageText", { chat_id: chatId, message_id: messageId, text: `Зручний час: <b>${esc(slot)}</b> ✓`, parse_mode: "HTML" });
    return finishTrial(chatId, cq.from, { ...s, data: { ...s.data, time: slot } });
  }

  // staff-only lead actions
  const p = await profileByChat(chatId);
  if (!p || !isStaff(p)) return answer("Недостатньо прав", true);

  if (data.startsWith("lv:")) {
    await answer();
    return sendLeadCard(chatId, data.slice(3));
  }
  if (data.startsWith("ls:")) {
    const [, leadId, status] = data.split(":");
    if (!LEAD_STATUS[status]) return answer("Невідомий статус");
    const { data: old } = await admin.from("leads").select("status, manager_id").eq("id", leadId).maybeSingle();
    if (!old) return answer("Заявку не знайдено", true);
    if (old.status !== status) {
      await admin.from("leads").update({ status, manager_id: old.manager_id ?? p.id }).eq("id", leadId);
      await admin.from("lead_events").insert({ lead_id: leadId, kind: "status", from_status: old.status, to_status: status, actor_id: p.id, actor_name: "Telegram" });
    }
    await answer(status === "trial_scheduled" ? "Статус змінено. Час уроку й Meet — у кабінеті." : `Статус: ${LEAD_STATUS[status].label}`);
    return refreshLeadMessage(chatId, messageId, leadId);
  }
  if (data.startsWith("lt:")) {
    const leadId = data.slice(3);
    const { data: lead } = await admin.from("leads").select("manager_id").eq("id", leadId).maybeSingle();
    if (lead?.manager_id && lead.manager_id !== p.id) return answer("Заявку вже взяв інший менеджер", true);
    await admin.from("leads").update({ manager_id: p.id }).eq("id", leadId);
    await admin.from("lead_events").insert({ lead_id: leadId, kind: "assigned", actor_id: p.id, actor_name: "Telegram", body: p.full_name });
    await answer("Заявка ваша 🙌");
    return refreshLeadMessage(chatId, messageId, leadId);
  }
  if (data.startsWith("ln:")) {
    const leadId = data.slice(3);
    await setSession(chatId, "note", { lead_id: leadId, message_id: messageId });
    await answer();
    return sendMessage(chatId, "✍️ Напишіть нотатку до заявки (або /cancel):", { reply_markup: { force_reply: true, input_field_placeholder: "Нотатка…" } });
  }
  return answer();
}

Deno.serve(handle(async (req) => {
  const secret = await getSecret("telegram_webhook_secret");
  const given = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!secret || !timingSafeEqual(given, secret)) throw new HttpError(401, "unauthorized");
  const update = await req.json();
  try {
    if (update.message) await onMessage(update.message);
    else if (update.callback_query) await onCallback(update.callback_query);
  } catch (e) {
    await logError("telegram", e, { update_id: update.update_id });
  }
  return json({ ok: true });
}));
