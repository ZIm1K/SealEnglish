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
