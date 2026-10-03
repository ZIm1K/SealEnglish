// Asset cache in Supabase Storage (bucket "content", folder cache/): voice lines, generated
// images and head positions are keyed by what produced them, so re-generating a video after a
// small edit only pays for the pieces that actually changed.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { supabase } from "./env.ts";

export const cacheKey = (...parts: unknown[]) => createHash("sha1").update(JSON.stringify(parts)).digest("hex");
export const fileHash = (file: string) => createHash("sha1").update(fs.readFileSync(file)).digest("hex");

const pathOf = (key: string, ext: string) => `cache/${key.slice(0, 2)}/${key}.${ext}`;

/** Downloads a cached file to `dest`; false when it isn't cached (or there is no Supabase). */
export async function cacheGet(key: string, ext: string, dest: string): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;
  const { data, error } = await sb.storage.from("content").download(pathOf(key, ext));
  if (error || !data) return false;
  fs.writeFileSync(dest, Buffer.from(await data.arrayBuffer()));
  return true;
}

export async function cachePut(key: string, ext: string, file: string, contentType: string): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  // Best effort: a failed upload only means the asset is paid for again next time.
  await sb.storage.from("content").upload(pathOf(key, ext), fs.readFileSync(file), { contentType, upsert: true });
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data, error } = await sb.storage.from("content").download(pathOf(key, "json"));
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return null;
  }
}

export async function cachePutJson(key: string, value: unknown): Promise<void> {
  const sb = supabase();
  if (!sb) return;
  await sb.storage.from("content").upload(pathOf(key, "json"), Buffer.from(JSON.stringify(value)), { contentType: "application/json", upsert: true });
}
