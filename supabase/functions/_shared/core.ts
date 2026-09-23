import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.117.1";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

function secretKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const keys = JSON.parse(raw);
      if (keys?.default) return keys.default as string;
    } catch {
      // fall through to legacy key
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

/** Service client: bypasses RLS. Never expose its results without an explicit permission check. */
export const admin: SupabaseClient = createClient(SUPABASE_URL, secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Внутрішня помилка сервера. Спробуйте ще раз." }, 500);
    }
  };
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Некоректний запит");
  }
}

// ───────────── Secrets (Vault) & settings ─────────────
const secretCache = new Map<string, { value: string | null; at: number }>();

export async function getSecret(name: string): Promise<string | null> {
  const hit = secretCache.get(name);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const { data, error } = await admin.rpc("get_app_secret", { p_name: name });
  if (error) throw error;
  const value = (data as string | null) ?? null;
  secretCache.set(name, { value, at: Date.now() });
  return value;
}

export async function setSecret(name: string, value: string | null): Promise<void> {
  const { error } = await admin.rpc("set_app_secret", { p_name: name, p_value: value ?? "" });
  if (error) throw error;
  secretCache.delete(name);
}

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? null) as T | null;
}

export async function setSetting(key: string, value: unknown, isPublic?: boolean): Promise<void> {
  const row: Record<string, unknown> = { key, value, updated_at: new Date().toISOString() };
  if (isPublic !== undefined) row.is_public = isPublic;
  const { error } = await admin.from("app_settings").upsert(row);
  if (error) throw error;
}

export async function siteUrl(): Promise<string> {
  return ((await getSetting<string>("site_url")) ?? "https://sealenglish.wasmer.app").replace(/\/$/, "");
}

export function functionsUrl(): string {
  return `${SUPABASE_URL}/functions/v1`;
}

// ───────────── Auth ─────────────
export type Role = "student" | "teacher" | "manager" | "admin";

export interface Profile {
  id: string;
  role: Role;
  full_name: string;
  email: string | null;
  phone: string | null;
  telegram_chat_id: number | null;
  telegram_username: string | null;
  meet_room_url: string | null;
  is_active: boolean;
}

export async function requireUser(req: Request, roles?: Role[]): Promise<{ user: User; profile: Profile }> {
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "Потрібна авторизація");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Сесія недійсна. Увійдіть знову.");
  const { data: profile } = await admin.from("profiles").select("*").eq("id", data.user.id).single();
  if (!profile || !profile.is_active) throw new HttpError(403, "Акаунт неактивний");
  if (roles && !roles.includes(profile.role)) throw new HttpError(403, "Недостатньо прав");
  return { user: data.user, profile: profile as Profile };
}

export const isStaff = (p: Pick<Profile, "role">) => p.role === "manager" || p.role === "admin";

export function randomToken(bytes = 24): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ───────────── Dates (school timezone) ─────────────
export const TZ = "Europe/Kyiv";

function tzOffsetMinutes(at: Date, tz = TZ): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Wall-clock time in the school timezone → UTC instant (DST-safe). */
export function zonedToUtc(date: string, time: string, tz = TZ): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = tzOffsetMinutes(new Date(guess), tz);
  let t = guess - off * 60000;
  const off2 = tzOffsetMinutes(new Date(t), tz);
  if (off2 !== off) t = guess - off2 * 60000;
  return new Date(t);
}

export function fmtKyiv(iso: string | Date, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: TZ, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", ...opts,
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

export function fmtKyivDay(iso: string | Date): string {
  return new Intl.DateTimeFormat("uk-UA", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" })
    .format(typeof iso === "string" ? new Date(iso) : iso);
}

export function fmtKyivTime(iso: string | Date): string {
  return new Intl.DateTimeFormat("uk-UA", { timeZone: TZ, hour: "2-digit", minute: "2-digit" })
    .format(typeof iso === "string" ? new Date(iso) : iso);
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
}
