// GA4 Measurement Protocol: conversions that happen outside the browser (bot sign-ups) reach the same GA4 property.
import { getSecret, getSetting, logError } from "./core.ts";

/** The site's GA4 web stream (docs/marketing/gtm-container.json); app_settings.ga_measurement_id overrides it. */
const DEFAULT_MEASUREMENT_ID = "G-3E6R4HLJDZ";

/**
 * Sends one event. `clientId` is the visitor's `_ga` id carried from the site ("123.456" or "123-456"),
 * so the event joins their session history and campaign; without it a fresh id is made up.
 * A no-op until the admin saves the API secret (Інтеграції → Google Analytics); never throws.
 */
export async function gaEvent(clientId: string | undefined, name: string, params: Record<string, string | number> = {}) {
  try {
    const [secret, mid] = await Promise.all([getSecret("ga_api_secret"), getSetting<string>("ga_measurement_id")]);
    if (!secret) return;
    const cid = clientId && /^\d+[.-]\d+$/.test(clientId)
      ? clientId.replace("-", ".")
      : `${Math.floor(Math.random() * 1e10)}.${Math.floor(Date.now() / 1000)}`;
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(mid || DEFAULT_MEASUREMENT_ID)}&api_secret=${encodeURIComponent(secret)}`;
    const res = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ client_id: cid, events: [{ name, params: { ...params, engagement_time_msec: 1 } }] }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) await logError("ga", `${name}: HTTP ${res.status}`);
  } catch (e) {
    await logError("ga", e);
  }
}
