// Persistence: Supabase when the service key is present, otherwise local files only (dry runs).
import fs from "node:fs";
import path from "node:path";
import { supabase } from "./env.ts";
import { ideaScore } from "./plan.ts";
import type { Idea } from "./schema.ts";

export interface StoredIdea {
  id: string | null;
  idea: Idea;
}

export async function startRun(kind: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data, error } = await sb.from("content_runs").insert({ kind }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

export async function finishRun(id: string | null, patch: { status: string; cost_usd: number; log: string; error?: string; signals?: unknown; web_report?: string }) {
  const sb = supabase();
  if (!sb || !id) return;
  await sb.from("content_runs").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", id);
}

export async function recentTitles(limit = 60): Promise<string[]> {
  const sb = supabase();
  if (!sb) return [];
  const { data } = await sb.from("content_ideas").select("title").neq("status", "new").order("created_at", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => r.title as string);
}

export async function saveIdeas(runId: string | null, ideas: Idea[]): Promise<StoredIdea[]> {
  const sb = supabase();
  if (!sb) return ideas.map((idea) => ({ id: null, idea }));
  const { data, error } = await sb
    .from("content_ideas")
    .insert(ideas.map((idea) => ({ run_id: runId, title: idea.title, format: idea.format, score: ideaScore(idea), data: idea })))
    .select("id, data");
  if (error) throw error;
  return data.map((r) => ({ id: r.id as string, idea: r.data as Idea }));
}

/** Fresh unused ideas (≤3 days old — trends go stale), best first. */
export async function freshIdeas(limit: number): Promise<StoredIdea[]> {
  const sb = supabase();
  if (!sb) return [];
  const since = new Date(Date.now() - 3 * 864e5).toISOString();
  const { data } = await sb
    .from("content_ideas")
    .select("id, data")
    .eq("status", "new")
    .gte("created_at", since)
    .order("score", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => ({ id: r.id as string, idea: r.data as Idea }));
}

export async function markIdea(id: string | null, status: "used" | "rejected") {
  const sb = supabase();
  if (sb && id) await sb.from("content_ideas").update({ status }).eq("id", id);
}

export async function upload(localFile: string, storagePath: string, contentType: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { error } = await sb.storage.from("content").upload(storagePath, fs.readFileSync(localFile), { contentType, upsert: true });
  if (error) throw error;
  return storagePath;
}

export function publicUrl(storagePath: string | null): string | null {
  const sb = supabase();
  if (!sb || !storagePath) return null;
  return sb.storage.from("content").getPublicUrl(storagePath).data.publicUrl;
}

export async function saveItem(row: Record<string, unknown>): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const { data, error } = await sb.from("content_items").insert(row).select("id").single();
  if (error) throw error;
  return data.id as string;
}

/** Local mirror of every item — handy for manual review even without Supabase. */
export function writeLocal(dir: string, name: string, payload: unknown) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(payload, null, 2));
}

export interface ItemRow {
  id: string;
  kind: "video" | "text";
  status: string;
  title: string;
  script: Record<string, unknown>;
  review_note: string | null;
  cost_usd: number;
  cost_breakdown: { what: string; usd: number }[] | null;
}

export async function itemsWithStatus(statuses: string[], limit = 10): Promise<ItemRow[]> {
  const sb = supabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("content_items")
    .select("id, kind, status, title, script, review_note, cost_usd, cost_breakdown")
    .in("status", statuses)
    .order("updated_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ItemRow[];
}

export async function updateItem(id: string, patch: Record<string, unknown>) {
  const sb = supabase();
  if (!sb) return;
  const { error } = await sb.from("content_items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

/** Atomically claims an item for processing (status from → to); false if someone else got it. */
export async function claimItem(id: string, from: string, to: string): Promise<boolean> {
  const sb = supabase();
  if (!sb) return false;
  const { data } = await sb.from("content_items").update({ status: to, updated_at: new Date().toISOString() }).eq("id", id).eq("status", from).select("id");
  return !!data?.length;
}

export async function siteUrl(): Promise<string> {
  const sb = supabase();
  const { data } = sb ? await sb.from("app_settings").select("value").eq("key", "site_url").maybeSingle() : { data: null };
  return ((data?.value as string | undefined) ?? "https://sealenglish.school").replace(/\/$/, "");
}
