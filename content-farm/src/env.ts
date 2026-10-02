// Runtime config. Secrets come from env vars first, then from the school's Supabase Vault
// (the same keys the admin enters in «Інтеграції»), so CI only needs the service-role key.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO_ROOT = path.resolve(ROOT, "..");
export const WORK = path.join(ROOT, ".work");

// Minimal .env loader (content-farm/.env) — no extra dependency.
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export const SUPABASE_URL = process.env.SUPABASE_URL ?? "https://nivxzpsstjphxkodhjzu.supabase.co";

let db: SupabaseClient | null = null;
export function supabase(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  db ??= createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  return db;
}

/** Env var name ↔ Vault secret name. */
const SECRETS = {
  anthropic: ["ANTHROPIC_API_KEY", "anthropic_api_key"],
  openai: ["OPENAI_API_KEY", "openai_api_key"],
  telegram: ["TELEGRAM_BOT_TOKEN", "telegram_bot_token"],
  youtube: ["YOUTUBE_API_KEY", "youtube_api_key"],
  gemini: ["GEMINI_API_KEY", "gemini_api_key"],
  eleven: ["ELEVENLABS_API_KEY", "elevenlabs_api_key"],
  /** Groq key (same one the lesson transcripts use) — Whisper word timestamps for captions. */
  stt: ["STT_API_KEY", "stt_api_key"],
} as const;

const cache = new Map<string, string | null>();
export async function secret(name: keyof typeof SECRETS): Promise<string | null> {
  const [envName, vaultName] = SECRETS[name];
  if (process.env[envName]) return process.env[envName]!;
  if (cache.has(name)) return cache.get(name)!;
  const sb = supabase();
  let value: string | null = null;
  if (sb) {
    const { data, error } = await sb.rpc("get_app_secret", { p_name: vaultName });
    if (error) throw new Error(`Vault read failed for ${vaultName}: ${error.message}`);
    value = (data as string | null) || null;
  }
  cache.set(name, value);
  return value;
}

export interface FarmSettings {
  /** Main LLM for ideas and scripts. */
  model: string;
  /** Model for the humanizer/editor pass (billed at research_* rates — same Sonnet tier). */
  edit_model: string;
  /** Second "editor" pass that strips AI clichés from all user-facing text. */
  humanize: boolean;
  /** Model for the web-search research steps (search results are token-heavy, so a cheaper model). */
  research_model: string;
  /** Hard ceiling per video, USD. Production aborts optional spend (images) before crossing it. */
  max_usd_per_video: number;
  /** Ceiling for a text-only post, USD. */
  max_usd_per_text: number;
  videos_per_run: number;
  texts_per_run: number;
  ideas_per_scan: number;
  /** Web searches Claude may run during a trend scan ($0.01 each). */
  web_searches: number;
  ai_images_per_video: number;
  /** "eleven" (ElevenLabs — chosen by the owner) · "gemini" · "edge" (free fallback) · "openai". */
  tts_provider: "eleven" | "gemini" | "edge" | "openai";
  eleven_model: string;
  eleven_speed: number;
  /** ElevenLabs voice_id per role; override any of them in app_settings.content_farm.eleven_voices. */
  eleven_voices: Record<string, string>;
  gemini_tts_model: string;
  /** Reference-capable model for frames where Sílі acts; the lite one for scene-only frames. */
  gemini_image_model: string;
  gemini_image_model_lite: string;
  /** "gemini" or "openai" for illustrations. */
  image_provider: "gemini" | "openai";
  /** Max frames with Sílі per story (each ≈ $0.067); other frames use the lite model or reuse. */
  seal_frames_per_story: number;
  edge_voice: string;
  edge_rate: string;
  tts_model: string;
  tts_voice: string;
  /** Share of daily videos made as viral stories (the rest are edu formats: quiz, wrong/right…). */
  story_share: number;
  images_per_story: number;
  image_model: string;
  image_quality: "low" | "medium" | "high";
  /** Cost table (USD) for non-LLM providers; LLM cost is computed from usage. */
  prices: {
    research_in_per_m: number;
    research_out_per_m: number;
    llm_in_per_m: number;
    llm_out_per_m: number;
    web_search: number;
    tts_per_min: number;
    gemini_tts_per_10s: number;
    eleven_per_1k_chars: number;
    gemini_image: number;
    gemini_image_lite: number;
    image: number;
  };
}

export const DEFAULT_SETTINGS: FarmSettings = {
  model: "claude-opus-5-5",
  research_model: "claude-sonnet-5-5",
  humanize: true,
  edit_model: "claude-sonnet-5-5",
  max_usd_per_video: 1,
  max_usd_per_text: 0.08,
  videos_per_run: 2,
  texts_per_run: 3,
  ideas_per_scan: 10,
  web_searches: 5,
  ai_images_per_video: 2,
  tts_provider: "eleven",
  eleven_model: "eleven_v4",
  eleven_speed: 0.98,
  // Premade ElevenLabs voices (multilingual). Replace with Voice Library picks via `npm run farm -- voices`.
  eleven_voices: {
    narrator: "nPczCjzI2devNBz1zQrb", // Brian — deep, storytelling
    seal: "cgSgspJ2msm6clMCkdW9", // Jessica — playful, bright
    uk_male: "TX3LPaxmHKxFdv7VOQHJ", // Liam
    uk_female: "FGY2WhTYpPnrIDTdsKH5", // Laura
    uk_old: "pqHfZKP75CvOlQylNhV4", // Bill — older
    en_male: "iP95p4xoKVk53GoZ742B", // Chris — casual American
    en_female: "EXAVITQu4vr4xnSDxMaL", // Sarah
    en_male_2: "cjVigY5qzO86Huf0OWal", // Eric
    en_female_2: "XrExE9yKIg1WjnnlVkGX", // Matilda
    en_child: "pFZP5JQG7iQjIQuC4Bku", // Lily
  },
  gemini_tts_model: "gemini-3.8-flash-tts",
  gemini_image_model: "gemini-3.1-flash-image",
  gemini_image_model_lite: "gemini-3.1-flash-lite-image",
  image_provider: "gemini",
  seal_frames_per_story: 4,
  edge_voice: "uk-UA-OstapNeural",
  edge_rate: "+14%",
  story_share: 0.7,
  images_per_story: 8,
  tts_model: "gpt-4o-mini-tts",
  tts_voice: "coral",
  image_model: "gpt-image-1-mini",
  image_quality: "medium",
  prices: { research_in_per_m: 2, research_out_per_m: 10, llm_in_per_m: 4, llm_out_per_m: 20, web_search: 0.01, tts_per_min: 0.015, image: 0.015, gemini_tts_per_10s: 0.00225, eleven_per_1k_chars: 0.08, gemini_image: 0.067, gemini_image_lite: 0.034 },
};

/** Settings live in app_settings.content_farm so they can be tuned without a deploy. */
export async function settings(): Promise<FarmSettings> {
  const sb = supabase();
  if (!sb) return DEFAULT_SETTINGS;
  const { data } = await sb.from("app_settings").select("value").eq("key", "content_farm").maybeSingle();
  const raw = (data?.value ?? {}) as Partial<FarmSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    prices: { ...DEFAULT_SETTINGS.prices, ...(raw.prices ?? {}) },
    eleven_voices: { ...DEFAULT_SETTINGS.eleven_voices, ...(raw.eleven_voices ?? {}) },
  };
}

/** Merges a patch into app_settings.content_farm (no-op without Supabase). */
export async function saveSetting(patch: Partial<FarmSettings>) {
  const sb = supabase();
  if (!sb) throw new Error("Потрібен SUPABASE_SERVICE_ROLE_KEY, щоб зберегти налаштування");
  const { data } = await sb.from("app_settings").select("value").eq("key", "content_farm").maybeSingle();
  const value = { ...((data?.value ?? {}) as object), ...patch };
  const { error } = await sb.from("app_settings").upsert({ key: "content_farm", value, updated_at: new Date().toISOString() });
  if (error) throw error;
}
