/* eslint-disable @next/next/no-location-assign-relative-destination -- switching accounts needs a full reload so no cached query of the previous account survives */
/**
 * Admin "view as": the browser signs in as another account with a one-time token from the admin
 * function and keeps the admin's own session aside, so "back" restores it without a password.
 */
import { useMemo, useSyncExternalStore } from "react";
import { callFunction, SUPABASE_KEY, SUPABASE_URL, supabase } from "./supabase";
import type { Role } from "./types";

const KEY = "seal-impersonator";

export interface Impersonator {
  id: string;
  name: string;
  access_token: string;
  refresh_token: string;
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function parse(raw: string | null): Impersonator | null {
  try {
    return raw ? (JSON.parse(raw) as Impersonator) : null;
  } catch {
    return null;
  }
}

export const getImpersonator = () => parse(readRaw());

const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

/** The admin whose session is kept aside, or null when nobody is being viewed as. */
export function useImpersonator(): Impersonator | null {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  return useMemo(() => parse(raw), [raw]);
}

export function clearImpersonator() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage unavailable — nothing to clear
  }
}

export async function startImpersonation(userId: string, adminName: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Сесію не знайдено — увійдіть знову");
  const { token_hash } = await callFunction<{ token_hash: string; full_name: string; role: Role }>("admin", { action: "impersonate", user_id: userId });
  // while already viewing as someone, keep the original admin session, not the current one
  const had = getImpersonator();
  if (!had) {
    const keep: Impersonator = { id: session.user.id, name: adminName, access_token: session.access_token, refresh_token: session.refresh_token };
    try {
      localStorage.setItem(KEY, JSON.stringify(keep));
    } catch {
      throw new Error("Браузер не дозволяє зберегти сесію адміністратора (приватний режим?)");
    }
  }
  const { error } = await supabase.auth.verifyOtp({ type: "magiclink", token_hash });
  if (error) {
    if (!had) clearImpersonator();
    throw new Error(error.message);
  }
  window.location.href = "/app/";
}

export async function stopImpersonation() {
  const keep = getImpersonator();
  const {
    data: { session: current },
  } = await supabase.auth.getSession();
  if (!keep) return;
  const { error } = await supabase.auth.setSession({ access_token: keep.access_token, refresh_token: keep.refresh_token });
  clearImpersonator();
  // end the borrowed session on the server; the admin's own one is untouched
  if (current && current.user.id !== keep.id) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${current.access_token}` },
    }).catch(() => undefined);
  }
  if (error) {
    await supabase.auth.signOut({ scope: "local" });
    window.location.href = "/login/";
    return;
  }
  window.location.href = "/app/people/";
}
