// Starts the content farm's Cloud Run job the moment the owner approves an item or asks for a
// rewrite, instead of waiting for the farm's next scheduled run.
//   POST (internal secret, from the content_items trigger) → runs the job with its default command (`work`)
// Needs the Vault secret `gcp_farm_service_account`: the JSON key of a Google service account that
// may run the job (content-farm: `npm run farm -- kick-setup --key <file>`). Without it the call is
// a no-op and the scheduled run picks the item up.
import { getSecret, handle, HttpError, isInternal, json, logError } from "../_shared/core.ts";

const JOB = "projects/bond-bot-494410/locations/europe-west1/jobs/seal-farm";

const b64url = (data: string | ArrayBuffer) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** Service-account flow: a JWT signed with the account's private key is exchanged for an access token. */
async function googleToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 600,
    }),
  )}`;
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }),
  });
  const tokens = await res.json();
  if (!res.ok) throw new Error(`Google token: ${tokens.error_description ?? tokens.error ?? res.status}`);
  return tokens.access_token as string;
}

Deno.serve(handle(async (req) => {
  if (!(await isInternal(req))) throw new HttpError(403, "Недостатньо прав");
  const raw = await getSecret("gcp_farm_service_account");
  if (!raw) return json({ ok: false, reason: "service account key is not configured" });

  const res = await fetch(`https://run.googleapis.com/v2/${JOB}:run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await googleToken(JSON.parse(raw))}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) {
    await logError("farm-kick", `Cloud Run HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return json({ ok: false }, 502);
  }
  return json({ ok: true });
}));
