/**
 * Google Tag Manager. Off when NEXT_PUBLIC_GTM_ID is empty (dev, previews).
 * GA4 and ad pixels are configured inside GTM (import: docs/marketing/gtm-container.json);
 * the site only pushes page views and funnel events into the dataLayer.
 */
export const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID || "";

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

/** Signed-in areas and one-time links: no page views, no events. */
export const isPrivatePath = (path: string) => /^\/(app|login|auth|setup)(\/|$)/.test(path);

/**
 * Every key any event may carry. GTM's data model keeps values between pushes,
 * so each push resets the keys it doesn't use — otherwise `level` from quiz_complete would leak into bot_click.
 */
const PARAM_KEYS = [
  "page_location", "page_title", "answered", "level", "score", "form", "contact", "reason", "age_group", "placement", "method", "content_type",
] as const;

export type TrackParams = Partial<Record<(typeof PARAM_KEYS)[number], string | number>>;

let loaded = false;

/** Injects gtm.js once, on the first public page: people who open the cabinet directly never load GTM. */
export function loadGtm() {
  if (loaded || !GTM_ID) return;
  loaded = true;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
  document.head.appendChild(s);
}

export function track(event: string, params: TrackParams = {}) {
  if (!loaded || isPrivatePath(window.location.pathname)) return;
  const push: Record<string, unknown> = { event };
  for (const k of PARAM_KEYS) push[k] = params[k];
  window.dataLayer!.push(push);
}

/** GA4 client id from the `_ga` cookie ("GA1.1.123.456" → "123.456"), or "" before GA has set it. */
function gaClientId(): string {
  return document.cookie.match(/(?:^|;\s*)_ga=GA\d+\.\d+\.(\d+\.\d+)/)?.[1] ?? "";
}

/**
 * Deep link into the bot's trial flow (telegram function). Payload: `<head>_<ga client id>_<utm_campaign>`,
 * where head is `t`, or `q` + the 20 quiz answers so the bot can send the mistake breakdown.
 * The GA client id lets the bot report its lead to GA4 as this visitor; Telegram caps the payload at 64 chars.
 */
export function botTrialLink(bot: string, quizAnswers?: number[]): string {
  const campaign = new URLSearchParams(window.location.search).get("utm_campaign")?.replace(/[^A-Za-z0-9_-]/g, "") ?? "";
  const head = quizAnswers ? `q${quizAnswers.join("")}` : "t";
  const payload = `${head}_${gaClientId().replace(".", "-")}_${campaign}`.slice(0, 64);
  return `https://t.me/${bot}?start=${payload}`;
}
