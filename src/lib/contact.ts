/**
 * One "phone or Telegram" field: teens often won't give a phone number but will give their @nick.
 * The lead function accepts either (supabase/functions/lead).
 */
export type Contact = { phone: string } | { telegram: string };

const TG = /^(?:@|https?:\/\/t\.me\/|t\.me\/)?([a-zA-Z][a-zA-Z0-9_]{4,31})$/;

export const looksLikeTelegram = (raw: string) => /[a-zA-Z@]/.test(raw);

export function parseContact(raw: string): Contact | null {
  const v = raw.trim();
  if (looksLikeTelegram(v)) {
    const m = v.match(TG);
    return m ? { telegram: m[1] } : null;
  }
  const digits = v.replace(/\D/g, "").length;
  return digits >= 10 && digits <= 15 ? { phone: v } : null;
}

export const CONTACT_ERROR = "Вкажіть номер телефону або Telegram-нік, наприклад @seal_fan";

/** Ukrainian numbers get the familiar grouping; numbers from abroad keep up to 15 digits (E.164). Nicks are left as typed. */
export function formatContact(raw: string) {
  if (looksLikeTelegram(raw)) return raw.trim();
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("0")) d = "38" + d;
  if (!d) return "";
  if (d.startsWith("380")) {
    d = d.slice(0, 12);
    const p = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 8), d.slice(8, 10), d.slice(10, 12)].filter(Boolean);
    return "+" + p.join(" ");
  }
  d = d.slice(0, 15);
  return "+" + (d.match(/.{1,3}/g) ?? []).join(" ");
}
