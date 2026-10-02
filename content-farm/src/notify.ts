// Sends each generated item to the school admins in Telegram for a quick look (via the school bot).
import fs from "node:fs";
import path from "node:path";
import { secret, supabase } from "./env.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function adminChats(): Promise<number[]> {
  const override = process.env.FARM_NOTIFY_CHAT_ID;
  if (override) return override.split(",").map(Number);
  const sb = supabase();
  if (!sb) return [];
  const { data } = await sb.from("profiles").select("telegram_chat_id").eq("role", "admin").eq("is_active", true).not("telegram_chat_id", "is", null);
  return (data ?? []).map((r) => Number(r.telegram_chat_id));
}

async function call(token: string, method: string, body: FormData | Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    ...(body instanceof FormData ? { body } : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
}

export async function notifyAdmins(opts: { title: string; summary: string; details: string; videoFile?: string; imageFile?: string }) {
  const token = await secret("telegram");
  const chats = await adminChats();
  if (!token || !chats.length) return false;
  for (const chat of chats) {
    const caption = `<b>🦭 Контент-ферма: ${esc(opts.title)}</b>\n${esc(opts.summary)}`.slice(0, 1000);
    const media = opts.videoFile ?? opts.imageFile;
    if (media) {
      const form = new FormData();
      form.set("chat_id", String(chat));
      form.set("caption", caption);
      form.set("parse_mode", "HTML");
      const field = opts.videoFile ? "video" : "photo";
      form.set(field, new Blob([fs.readFileSync(media)]), path.basename(media));
      if (opts.videoFile) form.set("supports_streaming", "true");
      await call(token, opts.videoFile ? "sendVideo" : "sendPhoto", form);
    } else {
      await call(token, "sendMessage", { chat_id: chat, text: caption, parse_mode: "HTML" });
    }
    // Telegram caps messages at 4096 chars.
    for (let i = 0; i < opts.details.length; i += 3900) {
      await call(token, "sendMessage", { chat_id: chat, text: opts.details.slice(i, i + 3900), disable_web_page_preview: true });
    }
  }
  return true;
}
