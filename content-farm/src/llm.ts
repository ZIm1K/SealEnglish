// The only place that talks to Claude. Tracks spend per job so every item records its real cost.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { secret, type FarmSettings } from "./env.ts";

/** Token counts of one Claude call, kept next to its cost so cache hits and output size can be read back later. */
export interface TokenUse {
  in: number;
  cache_write: number;
  cache_read: number;
  out: number;
  /** Answered through the Message Batches API (billed at half price). */
  batch?: boolean;
}

export class Budget {
  spent = 0;
  lines: { what: string; usd: number; tokens?: TokenUse }[] = [];
  /** Things the owner should hear about this item (e.g. the editor pass was skipped). */
  notes: string[] = [];
  constructor(readonly limit: number) {}
  add(what: string, usd: number, tokens?: TokenUse) {
    this.spent += usd;
    this.lines.push({ what, usd: Math.round(usd * 10000) / 10000, ...(tokens ? { tokens } : {}) });
  }
  left() {
    return this.limit - this.spent;
  }
  canAfford(usd: number) {
    return this.spent + usd <= this.limit;
  }
}

let client: Anthropic | null = null;
async function claude(): Promise<Anthropic> {
  if (client) return client;
  const apiKey = await secret("anthropic");
  if (!apiKey) throw new Error("Немає ключа Anthropic (ANTHROPIC_API_KEY або Vault anthropic_api_key)");
  client = new Anthropic({ apiKey, maxRetries: 3 });
  return client;
}

// Server-side fallback re-runs a safety-declined request on another model inside the same call.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

/**
 * USD per 1M tokens: [input, output, cache read]; 5-minute cache writes bill 1.25× input.
 * platform.claude.com/docs/en/about-claude/pricing, checked 2026-10-04. Models missing here fall
 * back to the settings' llm_* / research_* rates.
 */
const MODEL_RATES: Record<string, [number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2],
  "claude-sonnet-5-5": [2, 10, 0.2],
  "claude-haiku-4-5": [1, 5, 0.1],
};

function charge(budget: Budget, s: FarmSettings, what: string, model: string, usage: Anthropic.Beta.BetaUsage, research = false, batch = false) {
  const fallbackIn = research ? s.prices.research_in_per_m : s.prices.llm_in_per_m;
  const [inRate, outRate, readRate] = MODEL_RATES[model] ?? [fallbackIn, research ? s.prices.research_out_per_m : s.prices.llm_out_per_m, fallbackIn * 0.1];
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  const tokens: TokenUse = {
    in: usage.input_tokens,
    cache_write: usage.cache_creation_input_tokens ?? 0,
    cache_read: usage.cache_read_input_tokens ?? 0,
    out: usage.output_tokens,
    ...(batch ? { batch } : {}),
  };
  budget.add(
    what,
    ((tokens.in * inRate + tokens.cache_write * inRate * 1.25 + tokens.cache_read * readRate + tokens.out * outRate) / 1e6) * (batch ? 0.5 : 1) +
      searches * s.prices.web_search,
    tokens,
  );
}

function assertNotRefused(msg: Anthropic.Beta.BetaMessage, what: string) {
  if (msg.stop_reason === "refusal") {
    throw new Error(`${what}: модель відмовилась (${msg.stop_details?.category ?? "без категорії"})`);
  }
}

/** One structured request, described apart from how it is sent: live (`structured`) or in a batch. */
export interface StructuredCall<S extends z.ZodType = z.ZodType> {
  what: string;
  system: string;
  prompt: string;
  schema: S;
  effort?: "low" | "medium" | "high";
  /** Use the cheaper editing model (settings.edit_model, billed at its own rates). */
  cheap?: boolean;
  /** Optional images (JPEG/PNG/WebP) sent before the prompt, e.g. to locate things on a frame. */
  images?: { media_type: "image/jpeg" | "image/png" | "image/webp"; data: string }[];
}

const modelOf = (s: FarmSettings, call: StructuredCall) => (call.cheap ? s.edit_model : s.model);

function messageParams(s: FarmSettings, call: StructuredCall) {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(call.images ?? []).map((img) => ({ type: "image" as const, source: { type: "base64" as const, ...img } })),
    { type: "text", text: call.prompt },
  ];
  return {
    model: modelOf(s, call),
    max_tokens: 16000,
    output_config: { effort: call.effort ?? ("medium" as const), format: betaZodOutputFormat(call.schema) },
    // No cache_control: every call here has its own output schema and effort, which are part of
    // the cached prefix, so nothing is ever read back and a breakpoint only adds the 25% write
    // surcharge (measured 2026-10-04: cache_read stayed 0 across ideate → story → humanize).
    system: call.system,
    messages: [{ role: "user" as const, content }],
  };
}

/** The answer parsed against the call's schema, or what was wrong with it. */
function readAnswer<S extends z.ZodType>(call: StructuredCall<S>, msg: Anthropic.Beta.BetaMessage): { data: z.infer<S> } | { problem: string } {
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    const parsed = call.schema.safeParse(JSON.parse(text));
    if (parsed.success) return { data: parsed.data as z.infer<S> };
    return { problem: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  } catch {
    return { problem: `невалідний JSON (stop_reason=${msg.stop_reason})` };
  }
}

/** Structured call: returns data validated against the zod schema. */
export async function structured<S extends z.ZodType>(opts: StructuredCall<S> & { s: FarmSettings; budget: Budget }): Promise<z.infer<S>> {
  const c = await claude();
  const params = messageParams(opts.s, opts);
  for (let attempt = 1; ; attempt++) {
    // create + own validation (not .parse) so a schema miss is billed and retried, not thrown blind.
    const msg = await c.beta.messages.create({ ...FALLBACK, ...params });
    charge(opts.budget, opts.s, opts.what, params.model, msg.usage, opts.cheap);
    assertNotRefused(msg, opts.what);
    const answer = readAnswer(opts, msg);
    if ("data" in answer) return answer.data;
    if (attempt >= 2) throw new Error(`${opts.what}: відповідь не пройшла схему — ${answer.problem}`);
  }
}

// ───────────── Message Batches: the same calls at half price, answered asynchronously ─────────────

/** Submits the calls as one batch and returns its id. Keys become custom_ids ([A-Za-z0-9_-], ≤ 64). */
export async function submitBatch(s: FarmSettings, calls: Record<string, StructuredCall>): Promise<string> {
  const c = await claude();
  // No server-side refusal fallback here: the Batches API rejects that parameter. A refused or
  // failed request is simply answered live by the caller.
  const batch = await c.beta.messages.batches.create({
    requests: Object.entries(calls).map(([custom_id, call]) => ({ custom_id, params: messageParams(s, call) })),
  });
  return batch.id;
}

/**
 * The batch's answers once it has ended — parsed data per key, or an Error for a request that
 * failed, was refused or didn't match its schema — or null while it is still processing (polls for
 * up to `waitMs`). Successful answers are charged to `budgets[key]` at the batch rate.
 */
export async function collectBatch(
  s: FarmSettings,
  id: string,
  calls: Record<string, StructuredCall>,
  budgets: Record<string, Budget>,
  waitMs: number,
): Promise<Record<string, unknown> | null> {
  const c = await claude();
  for (const deadline = Date.now() + waitMs; ; ) {
    const batch = await c.beta.messages.batches.retrieve(id);
    if (batch.processing_status === "ended") break;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 15_000));
  }
  const answers: Record<string, unknown> = {};
  for await (const row of await c.beta.messages.batches.results(id)) {
    const call = calls[row.custom_id];
    if (!call) continue;
    if (row.result.type !== "succeeded") {
      answers[row.custom_id] = new Error(`${call.what}: запит у batch ${row.result.type}`);
      continue;
    }
    const msg = row.result.message;
    charge(budgets[row.custom_id], s, call.what, modelOf(s, call), msg.usage, call.cheap, true);
    const answer = msg.stop_reason === "refusal" ? { problem: "модель відмовилась" } : readAnswer(call, msg);
    answers[row.custom_id] = "data" in answer ? answer.data : new Error(`${call.what}: ${answer.problem}`);
  }
  return answers;
}

export async function cancelBatch(id: string): Promise<void> {
  const c = await claude();
  await c.beta.messages.batches.cancel(id).catch(() => undefined);
}

export interface Research {
  /** The final report (the text after the last search). */
  text: string;
  /** Searches that actually returned results; 0 means the report is the model's memory, not research. */
  searches: number;
}

/** Research call with Claude's web search. */
export async function research(opts: {
  s: FarmSettings;
  budget: Budget;
  what: string;
  system: string;
  prompt: string;
  maxSearches: number;
}): Promise<Research> {
  const c = await claude();
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.prompt }];
  let searches = 0;
  // pause_turn: the server-side search loop hit its iteration cap — resend to let it continue.
  for (let turn = 0; turn < 4; turn++) {
    const msg = await c.beta.messages
      .stream({
        ...FALLBACK,
        model: opts.s.research_model,
        max_tokens: 32000,
        output_config: { effort: "low" },
        system: opts.system,
        // The plain search tool on purpose: the 20260209 version routes searches through generated
        // code, which here burned the whole max_uses on parsing errors and returned no results.
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: Math.max(1, opts.maxSearches - searches) }],
        messages,
      })
      .finalMessage();
    charge(opts.budget, opts.s, opts.what, opts.s.research_model, msg.usage, true);
    assertNotRefused(msg, opts.what);
    // A failed search comes back as an error object instead of a result list (HTTP 200 either way).
    const results = msg.content.flatMap((b, i) => (b.type === "web_search_tool_result" ? [{ i, ok: Array.isArray(b.content) }] : []));
    searches += results.filter((r) => r.ok).length;
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    // Citations split the answer into many text blocks — they are one running text, not lines.
    const text = msg.content
      .slice((results.at(-1)?.i ?? -1) + 1)
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
    return { text, searches };
  }
  throw new Error(`${opts.what}: пошук не завершився за 4 ходи`);
}
