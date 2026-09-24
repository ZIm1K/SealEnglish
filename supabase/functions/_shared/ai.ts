// The single place that talks to the LLM provider (ADR-07): client, usage accounting (ai_usage),
// limits and moderation. Replacing the provider touches only this file.
import Anthropic from "npm:@anthropic-ai/sdk@0.128.0";
import { z } from "npm:zod@4.1.12";
import { admin, getSecret, getSetting, HttpError, TZ, zonedToUtc } from "./core.ts";

export { Anthropic, z };

export interface ModelPrice {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export interface AiSettings {
  enabled: boolean;
  tutor_enabled: boolean;
  review_enabled: boolean;
  lesson_enabled: boolean;
  model_main: string;
  model_fast: string;
  tutor_daily_messages: number;
  tutor_daily_usd: number;
  global_daily_usd: number;
  pilot_group_ids: string[];
  practice_retention_days: number;
  usd_rate: number;
  avg_check_uah: number;
  pricing: Record<string, ModelPrice>;
  risk_enabled: boolean;
  parent_reports_enabled: boolean;
  level_test_enabled: boolean;
  night_reply_enabled: boolean;
}

export const AI_DEFAULTS: AiSettings = {
  enabled: false,
  tutor_enabled: true,
  review_enabled: true,
  lesson_enabled: true,
  model_main: "claude-sonnet-5",
  model_fast: "claude-haiku-4-5",
  tutor_daily_messages: 30,
  tutor_daily_usd: 0.2,
  global_daily_usd: 10,
  pilot_group_ids: [],
  practice_retention_days: 90,
  usd_rate: 42,
  avg_check_uah: 2520,
  pricing: {
    "claude-sonnet-5": { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
    "claude-haiku-4-5": { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
  },
  risk_enabled: false,
  parent_reports_enabled: false,
  level_test_enabled: false,
  night_reply_enabled: false,
};

export async function aiSettings(): Promise<AiSettings> {
  const raw = (await getSetting<Partial<AiSettings>>("ai_settings")) ?? {};
  return { ...AI_DEFAULTS, ...raw, pricing: { ...AI_DEFAULTS.pricing, ...(raw.pricing ?? {}) } };
}

let cached: { key: string; client: Anthropic } | null = null;

/** Throws 409 when the school hasn't configured AI (key in Vault + master switch). */
export async function aiClient(settings: AiSettings, feature?: keyof AiSettings): Promise<Anthropic> {
  if (!settings.enabled) throw new HttpError(409, "ШІ-модуль вимкнено в налаштуваннях");
  if (feature && settings[feature] === false) throw new HttpError(409, "Цю ШІ-функцію вимкнено в налаштуваннях");
  const key = await getSecret("anthropic_api_key");
  if (!key) throw new HttpError(409, "Ключ ШІ-провайдера не налаштовано (Налаштування → Інтеграції)");
  if (!cached || cached.key !== key) cached = { key, client: new Anthropic({ apiKey: key, maxRetries: 2, timeout: 60_000 }) };
  return cached.client;
}

// ───────────── Usage & cost ─────────────
export function costUsd(settings: AiSettings, model: string, usage: Anthropic.Usage): number {
  const p = settings.pricing[model] ?? settings.pricing[settings.model_main] ?? AI_DEFAULTS.pricing["claude-sonnet-5"];
  const m = 1_000_000;
  return (
    (usage.input_tokens * p.input) / m +
    (usage.output_tokens * p.output) / m +
    ((usage.cache_read_input_tokens ?? 0) * p.cache_read) / m +
    ((usage.cache_creation_input_tokens ?? 0) * p.cache_write) / m
  );
}

export async function logUsage(
  settings: AiSettings,
  row: { userId: string | null; feature: string; model: string; usage: Anthropic.Usage; refId?: string | null },
): Promise<number> {
  const cost = costUsd(settings, row.model, row.usage);
  const { error } = await admin.from("ai_usage").insert({
    user_id: row.userId,
    feature: row.feature,
    model: row.model,
    input_tokens: row.usage.input_tokens,
    output_tokens: row.usage.output_tokens,
    cached_tokens: row.usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: row.usage.cache_creation_input_tokens ?? 0,
    cost_usd: Number(cost.toFixed(6)),
    ref_id: row.refId ?? null,
  });
  if (error) console.error("ai_usage insert failed", error.message);
  return cost;
}

export function kyivDayStart(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()); // YYYY-MM-DD
  return zonedToUtc(today, "00:00").toISOString();
}

async function spentToday(userId?: string): Promise<number> {
  let q = admin.from("ai_usage").select("cost_usd").gte("created_at", kyivDayStart());
  if (userId) q = q.eq("user_id", userId);
  const { data } = await q.limit(10_000);
  return (data ?? []).reduce((s, r) => s + Number(r.cost_usd), 0);
}

/** Global daily cap protects the budget if something goes wrong (runbook 11.3). */
export async function assertGlobalBudget(settings: AiSettings): Promise<void> {
  if ((await spentToday()) >= settings.global_daily_usd) {
    throw new HttpError(429, "Денний бюджет ШІ школи вичерпано. Спробуйте завтра.");
  }
}

export async function tutorQuota(settings: AiSettings, studentId: string): Promise<{ messagesLeft: number; usdLeft: number }> {
  const { count } = await admin
    .from("practice_turns")
    .select("id, practice_sessions!inner(student_id)", { count: "exact", head: true })
    .eq("practice_sessions.student_id", studentId)
    .eq("role", "user")
    .gte("created_at", kyivDayStart());
  const usd = await spentToday(studentId);
  return { messagesLeft: Math.max(0, settings.tutor_daily_messages - (count ?? 0)), usdLeft: settings.tutor_daily_usd - usd };
}

// ───────────── Structured output (9.3) ─────────────
export function textOf(message: Anthropic.Message): string {
  return message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

/**
 * One JSON-schema-constrained call; the result is validated with zod before anything touches the DB.
 * `schema` must follow structured-output rules: every object has additionalProperties:false and lists all keys as required.
 */
export async function structuredCall<T>(opts: {
  client: Anthropic;
  settings: AiSettings;
  model: string;
  system: string;
  content: Anthropic.MessageParam["content"];
  schema: Record<string, unknown>;
  validator: z.ZodType<T>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  feature: string;
  userId: string | null;
  refId?: string | null;
}): Promise<{ data: T; cost: number }> {
  const isHaiku = opts.model.includes("haiku");
  const message = await opts.client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 4000,
    system: opts.system,
    messages: [{ role: "user", content: opts.content }],
    output_config: {
      format: { type: "json_schema", schema: opts.schema },
      ...(isHaiku ? {} : { effort: opts.effort ?? "medium" }),
    },
  });
  const cost = await logUsage(opts.settings, {
    userId: opts.userId, feature: opts.feature, model: opts.model, usage: message.usage, refId: opts.refId,
  });
  if (message.stop_reason === "refusal") throw new HttpError(422, "ШІ відмовився обробити цей запит");
  if (message.stop_reason === "max_tokens") throw new Error("AI response truncated (max_tokens)");
  let parsed: unknown;
  try {
    parsed = JSON.parse(textOf(message));
  } catch {
    throw new Error("AI returned invalid JSON");
  }
  const result = opts.validator.safeParse(parsed);
  if (!result.success) throw new Error(`AI output failed validation: ${result.error.message.slice(0, 300)}`);
  return { data: result.data, cost };
}

export const MISTAKE_CATEGORIES = ["grammar", "vocabulary", "spelling", "word_order", "punctuation", "pronunciation", "style", "other"] as const;

export const mistakeJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["category", "example", "correction", "explanation"],
  properties: {
    category: { type: "string", enum: [...MISTAKE_CATEGORIES] },
    example: { type: "string", description: "The student's wrong phrase, quoted exactly" },
    correction: { type: "string", description: "The corrected phrase" },
    explanation: { type: "string", description: "One short sentence in Ukrainian" },
  },
};

export const mistakeValidator = z.object({
  category: z.enum(MISTAKE_CATEGORIES).catch("other"),
  example: z.string().trim().min(1).max(300),
  correction: z.string().trim().min(1).max(300),
  explanation: z.string().trim().max(500).catch(""),
});
export type Mistake = z.infer<typeof mistakeValidator>;

/** Drops malformed items instead of failing the whole draft. */
export const mistakesValidator = z.array(z.unknown()).transform((items) =>
  items.flatMap((x) => {
    const r = mistakeValidator.safeParse(x);
    return r.success ? [r.data] : [];
  }).slice(0, 20)
);

// ───────────── Moderation (FR-17, 9.4) ─────────────
export type ModerationFlag = "crisis" | "sexual" | "drugs" | "violence" | "bullying" | "contact" | "model";

const PATTERNS: [ModerationFlag, RegExp][] = [
  ["crisis", /(суїцид|самогубств|самоубийств|вбити себе|убить себя|покінчити з собою|покончить с собой|не хочу жити|не хочу жить|хочу померти|хочу умереть|ріжу себе|режу себя|порізати себе|kill myself|suicid|self[- ]?harm|cut myself|want to die|end my life)/i],
  ["sexual", /(\bsex\b|sexy|nude|nudes|porn|порно|секс|інтим|интим|оголен|голая фото|18\+)/i],
  ["drugs", /(наркот|закладк|cocaine|кокаїн|кокаин|heroin|героїн|mdma|амфетамін|weed|марихуан|вейп з|drugs\b)/i],
  ["violence", /(застрелити|пристрелить|вбити його|вбити її|убить его|убить ее|shoot (him|her|them|up)|school shooting|стрілянина в школі)/i],
  ["bullying", /(\bfuck|\bshit\b|\bbitch|сука|бля|хуй|пизд|їбан|ебан|дебіл|дебил|\bidiot\b|stupid bitch)/i],
];

const CONTACT = /(\+?\d[\d\s().-]{8,}\d|[\w.+-]+@[\w-]+\.[\w.]+|t\.me\/\w+|instagram\.com\/\w+)/gi;

export interface ModerationResult {
  flags: ModerationFlag[];
  crisis: boolean;
  /** Text with phone numbers / emails / social links masked (personal-data minimisation). */
  masked: string;
}

export function moderate(text: string): ModerationResult {
  const flags = PATTERNS.filter(([, re]) => re.test(text)).map(([f]) => f);
  const masked = text.replace(CONTACT, "[приховано]");
  if (masked !== text) flags.push("contact");
  return { flags, crisis: flags.includes("crisis"), masked };
}

export const CRISIS_REPLY =
  "Мені дуже шкода, що тобі зараз так важко 💙 Я лише тренер англійської і не можу допомогти з цим як слід, але ти не сам(а). " +
  "Будь ласка, розкажи дорослому, якому довіряєш (батькам, вчителю), або звернись по безкоштовну анонімну допомогу:\n" +
  "• Національна дитяча гаряча лінія: 116 111 або 0 800 500 225\n" +
  "• Lifeline Ukraine: 7333 (цілодобово)\n" +
  "Твій викладач теж отримає сповіщення, щоб підтримати тебе.";

export const FLAG_LABEL: Record<ModerationFlag, string> = {
  crisis: "можлива криза / самоушкодження",
  sexual: "сексуальний контент",
  drugs: "наркотики",
  violence: "насильство",
  bullying: "лайка / булінг",
  contact: "обмін контактами",
  model: "небезпечна тема (визначив ШІ)",
};
