// Internal: called by the DB (pg_net) for every notification row → delivers it to Telegram.
import { admin, getSecret, handle, HttpError, json, readJson, siteUrl, timingSafeEqual } from "../_shared/core.ts";
import { esc, isPublicHttps, sendLeadCard, sendMessage, type InlineKeyboard } from "../_shared/telegram.ts";

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
  info: "💙",
};

Deno.serve(handle(async (req) => {
  const secret = await getSecret("internal_secret");
  const given = req.headers.get("x-internal-secret") ?? "";
  if (!secret || !timingSafeEqual(given, secret)) throw new HttpError(401, "unauthorized");

  const { id } = await readJson<{ id: string }>(req);
  const { data: n } = await admin
    .from("notifications")
    .select("*, user:profiles!notifications_user_id_fkey(telegram_chat_id, notify_telegram, is_active)")
    .eq("id", id)
    .maybeSingle();
  if (!n) return json({ ok: false, reason: "not_found" });
  const chatId: number | null = n.user?.telegram_chat_id ?? null;
  if (!chatId || !n.user?.notify_telegram || !n.user?.is_active || n.tg_status) {
    return json({ ok: true, skipped: true });
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
  await admin.from("notifications").update({ tg_status: status }).eq("id", id);
  // User blocked the bot → stop trying.
  if (res && !res.ok && /blocked|deactivated|chat not found/i.test(res.description ?? "")) {
    await admin.from("profiles").update({ notify_telegram: false }).eq("telegram_chat_id", chatId);
  }
  return json({ ok: true, status });
}));
