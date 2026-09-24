import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
    storageKey: "seal-english-auth",
  },
});

const OFFLINE = "Немає з'єднання з сервером. Перевірте інтернет і спробуйте ще раз.";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** Calls a Supabase Edge Function with the current session (if any). */
export async function callFunction<T = unknown>(name: string, body?: unknown): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  }).catch(() => {
    throw new ApiError(OFFLINE, 0);
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? `Помилка ${res.status}`, res.status);
  return json as T;
}

/** Unwraps a supabase-js result, throwing a friendly error. */
export function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(humanizeError(res.error.message));
  return res.data as T;
}

export function humanizeError(msg: string) {
  if (/Invalid login credentials/i.test(msg)) return "Невірний email або пароль";
  if (/Email not confirmed/i.test(msg)) return "Email ще не підтверджено";
  if (/row-level security|permission denied/i.test(msg)) return "Недостатньо прав для цієї дії";
  if (/duplicate key/i.test(msg)) return "Такий запис уже існує";
  if (/network|fetch/i.test(msg)) return "Немає з'єднання. Перевірте інтернет";
  if (/Password should be/i.test(msg)) return "Пароль має містити щонайменше 8 символів";
  return msg;
}

export async function signedUrl(bucket: "materials" | "homework", path: string, expires = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expires);
  if (error) throw new Error(humanizeError(error.message));
  return data.signedUrl;
}

/** Calls an Edge Function that answers with Server-Sent Events (`data: {json}` lines). */
export async function streamFunction(
  name: string,
  body: unknown,
  onEvent: (event: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
    signal,
  }).catch((e) => {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(OFFLINE, 0);
  });
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => ({}));
    throw new ApiError(json.error ?? `Помилка ${res.status}`, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          onEvent(JSON.parse(line.slice(5).trim()));
        } catch {
          // ignore malformed lines
        }
      }
    }
  }
}
