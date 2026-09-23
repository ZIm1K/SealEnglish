// Connect the school's Google account (Calendar + Meet) via OAuth 2.0.
//   POST {action:"start"}      (admin JWT) → { url } to redirect the browser to
//   GET  ?code=…&state=…       Google callback → stores refresh token in Vault → redirects back to the site
//   POST {action:"disconnect"} (admin JWT)
import {
  admin, functionsUrl, getSecret, handle, HttpError, json, randomToken, readJson, requireUser, setSecret, setSetting,
  siteUrl,
} from "../_shared/core.ts";

const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.events"];
const redirectUri = () => `${functionsUrl()}/google-oauth`;

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

async function callback(url: URL): Promise<Response> {
  const site = await siteUrl();
  const back = (status: string, reason?: string) =>
    redirect(`${site}/app/settings/integrations/?google=${status}${reason ? `&reason=${encodeURIComponent(reason.slice(0, 200))}` : ""}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) return back("denied");

  const { data: st } = await admin.from("oauth_states").select("*").eq("state", state).maybeSingle();
  if (!st || Date.now() - new Date(st.created_at).getTime() > 15 * 60_000) return back("expired");
  await admin.from("oauth_states").delete().eq("state", state);

  const [clientId, clientSecret] = await Promise.all([getSecret("google_client_id"), getSecret("google_client_secret")]);
  if (!clientId || !clientSecret) return back("no_client");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const tokens = await res.json();
  if (!res.ok) {
    console.error("google token exchange failed", tokens);
    return back("error", [tokens.error, tokens.error_description].filter(Boolean).join(": ") || `HTTP ${res.status}`);
  }
  if (!tokens.refresh_token) return back("no_refresh");

  let email: string | null = null;
  try {
    const payload = JSON.parse(atob(tokens.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    email = payload.email ?? null;
  } catch {
    // id_token is optional for our purposes
  }
  await setSecret("google_refresh_token", tokens.refresh_token);
  await setSetting("google_account", { email, connected_at: new Date().toISOString(), scopes: tokens.scope });
  return back("connected");
}

Deno.serve(handle(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") return callback(url);

  const { profile } = await requireUser(req, ["admin"]);
  const input = await readJson<{ action: string }>(req);

  if (input.action === "start") {
    const clientId = await getSecret("google_client_id");
    if (!clientId) throw new HttpError(409, "Спочатку збережіть Google Client ID та Client secret");
    const state = randomToken(24);
    await admin.from("oauth_states").insert({ state, user_id: profile.id });
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    }).toString();
    return json({ url: auth.toString() });
  }

  if (input.action === "disconnect") {
    const refresh = await getSecret("google_refresh_token");
    if (refresh) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: "POST" }).catch(() => {});
    }
    await setSecret("google_refresh_token", null);
    await setSetting("google_account", null);
    return json({ ok: true });
  }

  throw new HttpError(400, "Невідома дія");
}));
