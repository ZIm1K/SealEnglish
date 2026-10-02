// The only place that talks to Claude. Tracks spend per job so every item records its real cost.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { secret, type FarmSettings } from "./env.ts";

export class Budget {
  spent = 0;
  lines: { what: string; usd: number }[] = [];
  constructor(readonly limit: number) {}
  add(what: string, usd: number) {
    this.spent += usd;
    this.lines.push({ what, usd: Math.round(usd * 10000) / 10000 });
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

function charge(budget: Budget, s: FarmSettings, what: string, usage: Anthropic.Beta.BetaUsage, research = false) {
  const inRate = research ? s.prices.research_in_per_m : s.prices.llm_in_per_m;
  const outRate = research ? s.prices.research_out_per_m : s.prices.llm_out_per_m;
  const inTok = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) * 0.1;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  budget.add(
    what,
    (inTok * inRate + usage.output_tokens * outRate) / 1e6 + searches * s.prices.web_search,
  );
}

function assertNotRefused(msg: Anthropic.Beta.BetaMessage, what: string) {
  if (msg.stop_reason === "refusal") {
    throw new Error(`${what}: модель відмовилась (${msg.stop_details?.category ?? "без категорії"})`);
  }
}

/** Structured call: returns data validated against the zod schema. */
export async function structured<S extends z.ZodType>(opts: {
  s: FarmSettings;
  budget: Budget;
  what: string;
  system: string;
  prompt: string;
  schema: S;
  effort?: "low" | "medium" | "high";
  /** Use the cheaper editing model (settings.edit_model, billed at its own rates). */
  cheap?: boolean;
  /** Optional images (JPEG/PNG/WebP) sent before the prompt, e.g. to locate things on a frame. */
  images?: { media_type: "image/jpeg" | "image/png" | "image/webp"; data: string }[];
}): Promise<z.infer<S>> {
  const c = await claude();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...(opts.images ?? []).map((img) => ({ type: "image" as const, source: { type: "base64" as const, ...img } })),
    { type: "text", text: opts.prompt },
  ];
  const format = betaZodOutputFormat(opts.schema);
  for (let attempt = 1; ; attempt++) {
    // create + own validation (not .parse) so a schema miss is billed and retried, not thrown blind.
    const msg = await c.beta.messages.create({
      ...FALLBACK,
      model: opts.cheap ? opts.s.edit_model : opts.s.model,
      max_tokens: 16000,
      output_config: { effort: opts.effort ?? "medium", format },
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    });
    charge(opts.budget, opts.s, opts.what, msg.usage, opts.cheap);
    assertNotRefused(msg, opts.what);
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let problem: string;
    try {
      const parsed = opts.schema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data as z.infer<S>;
      problem = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch {
      problem = `невалідний JSON (stop_reason=${msg.stop_reason})`;
    }
    if (attempt >= 2) throw new Error(`${opts.what}: відповідь не пройшла схему — ${problem}`);
  }
}

/** Research call with Claude's web search; returns the final text report. */
export async function research(opts: {
  s: FarmSettings;
  budget: Budget;
  what: string;
  system: string;
  prompt: string;
  maxSearches: number;
}): Promise<string> {
  const c = await claude();
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.prompt }];
  // pause_turn: the server-side search loop hit its iteration cap — resend to let it continue.
  for (let turn = 0; turn < 4; turn++) {
    const msg = await c.beta.messages
      .stream({
        ...FALLBACK,
        model: opts.s.research_model,
        max_tokens: 32000,
        output_config: { effort: "low" },
        system: opts.system,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches }],
        messages,
      })
      .finalMessage();
    charge(opts.budget, opts.s, opts.what, msg.usage, true);
    assertNotRefused(msg, opts.what);
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    return msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
  throw new Error(`${opts.what}: пошук не завершився за 4 ходи`);
}
