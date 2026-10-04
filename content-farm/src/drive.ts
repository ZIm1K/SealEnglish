// Google Drive as the farm's video store. Videos are ~30 MB each and would fill the Supabase
// bucket within weeks, so they live on the school's Google Drive; Supabase keeps covers, post
// images and the asset cache.
//
// Access reuses the school's Google connection (cabinet → Налаштування → Інтеграції, the same one
// that creates Meet links): its OAuth client and refresh token sit in the Vault, and the
// drive.file scope lets the farm see only the files it created itself.
import fs from "node:fs";
import { saveSetting, secret, supabase, type FarmSettings } from "./env.ts";
import { withRetry } from "./media/retry.ts";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER = "application/vnd.google-apps.folder";
const ROOT_FOLDER = "Seal English — контент-ферма";

export const driveViewUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

async function credentials() {
  const [id, key, refresh] = await Promise.all([secret("googleClientId"), secret("googleClientSecret"), secret("googleRefreshToken")]);
  return id && key && refresh ? { id, key, refresh } : null;
}

let granted: boolean | null = null;
/** True once the school's Google account is connected with the Drive scope (re-connect after the scope was added). */
export async function driveAvailable(): Promise<boolean> {
  if (granted !== null) return granted;
  const sb = supabase();
  if (!sb || !(await credentials())) return (granted = false);
  const { data } = await sb.from("app_settings").select("value").eq("key", "google_account").maybeSingle();
  const scopes = String((data?.value as { scopes?: string } | null)?.scopes ?? "");
  return (granted = scopes.split(/\s+/).includes(SCOPE));
}

let token: { value: string; expires: number } | null = null;
/** Short-lived access token minted from the stored refresh token (cached until a minute before it expires). */
async function accessToken(): Promise<string> {
  if (token && Date.now() < token.expires) return token.value;
  const c = await credentials();
  if (!c) throw new Error("Google не підключено (кабінет → Налаштування → Інтеграції)");
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
export async function folderPath(s: FarmSettings, ...sub: string[]): Promise<string> {
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
