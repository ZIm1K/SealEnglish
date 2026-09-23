import { admin, fmtKyiv, getSecret, siteUrl } from "./core.ts";

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type InlineKeyboard = InlineButton[][];

export async function tg<T = unknown>(method: string, payload: Record<string, unknown>): Promise<{ ok: boolean; result?: T; description?: string } | null> {
  const token = await getSecret("telegram_bot_token");
  if (!token) return null;
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!data.ok) console.error("telegram", method, data.description);
  return data;
}

export function sendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return tg("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...extra,
  });
}

export const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Telegram URL buttons require public https URLs. */
export const isPublicHttps = (url?: string | null) => !!url && /^https:\/\/(?!localhost|127\.)/i.test(url);

export const LEAD_STATUS: Record<string, { label: string; emoji: string }> = {
  new: { label: "Нова", emoji: "🆕" },
  contacted: { label: "Зв'язалися", emoji: "📞" },
  trial_scheduled: { label: "Пробний призначено", emoji: "📅" },
  trial_done: { label: "Пробний проведено", emoji: "✅" },
  won: { label: "Став учнем", emoji: "🎉" },
  lost: { label: "Відмова", emoji: "✖️" },
};

export const AGE_GROUP: Record<string, string> = {
  kids: "Діти 6–11",
  teens: "Підлітки 12–18",
  adults: "Дорослі",
};

export interface LeadRow {
  id: string;
  no: number;
  name: string;
  phone: string | null;
  email: string | null;
  telegram_username: string | null;
  age_group: string | null;
  student_age: number | null;
  level: string | null;
  goal: string | null;
  preferred_time: string | null;
  comment: string | null;
  source: string;
  status: string;
  manager_id: string | null;
  created_at: string;
  manager?: { full_name: string } | null;
}

export async function loadLead(id: string): Promise<LeadRow | null> {
  const { data } = await admin
    .from("leads")
    .select("*, manager:profiles!leads_manager_id_fkey(full_name)")
    .eq("id", id)
    .maybeSingle();
  return data as LeadRow | null;
}

export async function leadCard(lead: LeadRow): Promise<string> {
  const st = LEAD_STATUS[lead.status] ?? { label: lead.status, emoji: "•" };
  const src = lead.source === "telegram" ? "Telegram" : lead.source === "website" ? "Сайт" : "Вручну";
  const lines = [
    `<b>${st.emoji} Заявка #${lead.no}</b> · ${esc(st.label)}`,
    "",
    `👤 <b>${esc(lead.name)}</b>${lead.student_age ? `, ${lead.student_age} р.` : ""}`,
  ];
  if (lead.phone) lines.push(`📱 <code>${esc(lead.phone)}</code>`);
  if (lead.telegram_username) lines.push(`💬 @${esc(lead.telegram_username.replace(/^@/, ""))}`);
  if (lead.email) lines.push(`✉️ ${esc(lead.email)}`);
  if (lead.age_group) lines.push(`🎯 ${esc(AGE_GROUP[lead.age_group] ?? lead.age_group)}${lead.level ? ` · рівень ${esc(lead.level)}` : ""}`);
  if (lead.goal) lines.push(`🏁 Мета: ${esc(lead.goal)}`);
  if (lead.preferred_time) lines.push(`🕐 Зручно: ${esc(lead.preferred_time)}`);
  if (lead.comment) lines.push(`💭 ${esc(lead.comment)}`);
  lines.push("", `<i>${src} · ${fmtKyiv(lead.created_at)}${lead.manager?.full_name ? ` · веде ${esc(lead.manager.full_name)}` : ""}</i>`);

  const { data: notes } = await admin
    .from("lead_events")
    .select("body, created_at, actor:profiles!lead_events_actor_id_fkey(full_name)")
    .eq("lead_id", lead.id)
    .eq("kind", "note")
    .order("created_at", { ascending: false })
    .limit(3);
  if (notes?.length) {
    lines.push("", "<b>Нотатки:</b>");
    for (const n of notes.reverse()) {
      // deno-lint-ignore no-explicit-any
      const who = (n as any).actor?.full_name ?? "";
      lines.push(`— ${esc(n.body)}${who ? ` <i>(${esc(who)})</i>` : ""}`);
    }
  }
  return lines.join("\n");
}

export async function leadKeyboard(lead: LeadRow): Promise<InlineKeyboard> {
  const flow = ["contacted", "trial_scheduled", "trial_done", "won", "lost"].filter((s) => s !== lead.status);
  const statusButtons = flow.map((s) => ({ text: `${LEAD_STATUS[s].emoji} ${LEAD_STATUS[s].label}`, callback_data: `ls:${lead.id}:${s}` }));
  const rows: InlineKeyboard = [];
  for (let i = 0; i < statusButtons.length; i += 2) rows.push(statusButtons.slice(i, i + 2));
  const actions: InlineButton[] = [{ text: "📝 Нотатка", callback_data: `ln:${lead.id}` }];
  if (!lead.manager_id) actions.push({ text: "🙋 Беру в роботу", callback_data: `lt:${lead.id}` });
  rows.push(actions);
  const site = await siteUrl();
  if (isPublicHttps(site)) rows.push([{ text: "🌐 Відкрити в кабінеті", url: `${site}/app/leads/?id=${lead.id}` }]);
  if (lead.telegram_username) rows.push([{ text: "💬 Написати в Telegram", url: `https://t.me/${lead.telegram_username.replace(/^@/, "")}` }]);
  return rows;
}

export async function sendLeadCard(chatId: number, leadId: string) {
  const lead = await loadLead(leadId);
  if (!lead) return null;
  return sendMessage(chatId, await leadCard(lead), { reply_markup: { inline_keyboard: await leadKeyboard(lead) } });
}
