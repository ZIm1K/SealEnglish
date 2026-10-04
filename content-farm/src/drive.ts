// Google Drive as the farm's video store. Videos are ~30 MB each and would fill the Supabase
// bucket within weeks, so they live on the owner's Drive; Supabase keeps covers, post images and
// the asset cache. Access is OAuth with the drive.file scope: the farm sees only what it created.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { ROOT, saveSetting, secret, type FarmSettings } from "./env.ts";
import { withRetry } from "./media/retry.ts";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const ROOT_FOLDER = "Seal English — контент-ферма";

export const driveViewUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

async function credentials() {
  const [id, key, refresh] = await Promise.all([secret("driveClientId"), secret("driveClientSecret"), secret("driveRefreshToken")]);
  return id && key && refresh ? { id, key, refresh } : null;
}

export async function driveAvailable() {
  return !!(await credentials());
}

let token: { value: string; expires: number } | null = null;
/** Short-lived access token minted from the stored refresh token (cached until a minute before it expires). */
async function accessToken(): Promise<string> {
  if (token && Date.now() < token.expires) return token.value;
  const c = await credentials();
  if (!c) throw new Error("Google Drive не підключено (запустіть: npm run farm -- drive-auth)");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ client_id: c.id, client_secret: c.key, refresh_token: c.refresh, grant_type: "refresh_token" }),
  });
  if (!res.ok) throw new Error(`Drive token HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, expires: Date.now() + (json.expires_in - 60) * 1000 };
  return token.value;
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${await accessToken()}` } });
  if (!res.ok) throw new Error(`Drive HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

/** Finds the folder by name under `parent` (among the farm's own files) or creates it. */
async function folder(name: string, parent?: string): Promise<string> {
  const q = [`name = '${name.replace(/'/g, "\\'")}'`, `mimeType = '${FOLDER}'`, "trashed = false", ...(parent ? [`'${parent}' in parents`] : [])].join(" and ");
  const found = (await (await call(`${API}/files?${new URLSearchParams({ q, fields: "files(id)", pageSize: "1" })}`)).json()) as { files: { id: string }[] };
  if (found.files[0]) return found.files[0].id;
  const made = await call(`${API}/files?fields=id`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
  });
  return ((await made.json()) as { id: string }).id;
}

const folders = new Map<string, string>();
/** "Seal English — контент-ферма / <sub…>": the root id is remembered in settings, the rest per run. */
async function folderPath(s: FarmSettings, ...sub: string[]): Promise<string> {
  const key = sub.join("/");
  if (folders.has(key)) return folders.get(key)!;
  let id = s.drive_folder_id;
  if (!id) {
    id = await folder(ROOT_FOLDER);
    s.drive_folder_id = id;
    await saveSetting({ drive_folder_id: id }).catch(() => undefined);
  }
  for (const name of sub) id = await folder(name, id);
  folders.set(key, id);
  return id;
}

/** Resumable upload: one request opens a session with the metadata, the next sends the bytes. */
async function send(s: FarmSettings, file: string, name: string, mimeType: string, sub: string[], replaceId?: string): Promise<string> {
  const metadata = replaceId ? { name } : { name, parents: [await folderPath(s, ...sub)] };
  const session = await call(`${UPLOAD}/files${replaceId ? `/${replaceId}` : ""}?uploadType=resumable&fields=id`, {
    method: replaceId ? "PATCH" : "POST",
    headers: { "content-type": "application/json", "x-upload-content-type": mimeType },
    body: JSON.stringify(metadata),
  });
  const location = session.headers.get("location");
  if (!location) throw new Error("Drive: сесію завантаження не відкрито");
  const done = await call(location, { method: "PUT", headers: { "content-type": mimeType }, body: fs.readFileSync(file) });
  return ((await done.json()) as { id: string }).id;
}

/**
 * Puts a file on Drive and returns its id. With `replaceId` the existing file gets the new content
 * (a re-render keeps its link); if that file is gone, a new one is created.
 */
export async function uploadToDrive(s: FarmSettings, file: string, name: string, mimeType: string, sub: string[], replaceId?: string | null): Promise<string> {
  if (replaceId) {
    try {
      return await withRetry(() => send(s, file, name, mimeType, sub, replaceId), 3);
    } catch (e) {
      if (!/HTTP 404/.test((e as Error).message)) throw e;
    }
  }
  return withRetry(() => send(s, file, name, mimeType, sub), 3);
}

/** Month folder for a video, so the Drive stays browsable: Відео / 2026-10. */
export const videoFolder = () => ["Відео", new Date().toISOString().slice(0, 7)];

// ───────────────────────── one-time consent (`npm run farm -- drive-auth`) ─────────────────────────

function setEnvValue(name: string, value: string) {
  const file = path.join(ROOT, ".env");
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  const at = lines.findIndex((l) => l.startsWith(`${name}=`));
  if (at >= 0) lines[at] = `${name}=${value}`;
  else lines.push(`${name}=${value}`);
  fs.writeFileSync(file, lines.filter((l, i) => l || i < lines.length - 1).join("\n") + "\n");
  process.env[name] = value;
}

/**
 * Installed-app OAuth flow: opens Google's consent page, catches the redirect on a loopback port,
 * exchanges the code for a refresh token and stores it in content-farm/.env (never printed).
 */
export async function authorizeDrive(s: FarmSettings, log: (m: string) => void): Promise<void> {
  const [id, key] = await Promise.all([secret("driveClientId"), secret("driveClientSecret")]);
  if (!id || !key) throw new Error("У content-farm/.env немає GOOGLE_DRIVE_CLIENT_ID і GOOGLE_DRIVE_CLIENT_SECRET (OAuth-клієнт типу Desktop app)");
  const state = randomBytes(16).toString("hex");
  const code = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (!url.searchParams.has("code") && !url.searchParams.has("error")) return void res.writeHead(404).end();
      const ok = url.searchParams.get("state") === state && url.searchParams.has("code");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<p style="font:18px system-ui;padding:40px">${ok ? "Готово — Google Drive підключено. Вкладку можна закрити." : "Не вдалося: згоду не надано або запит не збігається."}</p>`);
      server.close();
      if (ok) resolve({ code: url.searchParams.get("code")!, redirect });
      else reject(new Error(`згоду не отримано (${url.searchParams.get("error") ?? "state не збігається"})`));
    });
    let redirect = "";
    server.listen(0, "127.0.0.1", () => {
      redirect = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const consent = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: id,
        redirect_uri: redirect,
        response_type: "code",
        scope: SCOPE,
        access_type: "offline",
        prompt: "consent",
        state,
      })}`;
      log(`Відкрийте в браузері й надайте доступ:\n${consent}\n`);
      const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", consent.replace(/&/g, "^&")]] : process.platform === "darwin" ? ["open", [consent]] : ["xdg-open", [consent]];
      spawn(cmd as string, args as string[], { stdio: "ignore", detached: true }).on("error", () => undefined);
    });
    setTimeout(() => reject(new Error("час очікування згоди вийшов (10 хв)")), 10 * 60_000).unref();
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ client_id: id, client_secret: key, code: code.code, redirect_uri: code.redirect, grant_type: "authorization_code" }),
  });
  if (!res.ok) throw new Error(`обмін коду не вдався: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { refresh_token?: string };
  if (!json.refresh_token) throw new Error("Google не повернув refresh-токен — відкличте доступ застосунку в myaccount.google.com/permissions і повторіть");
  setEnvValue("GOOGLE_DRIVE_REFRESH_TOKEN", json.refresh_token);
  token = null;
  const root = await folderPath(s);
  log(`Google Drive підключено. Тека ферми: https://drive.google.com/drive/folders/${root}\nТокен збережено в content-farm/.env; щоб він потрапив у хмару, потрібен деплой.`);
}
