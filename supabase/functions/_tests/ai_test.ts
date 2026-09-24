// Unit tests for the pure parts of the AI module (section 12: Deno tests for validation and rules).
// Run: SUPABASE_URL=http://localhost SUPABASE_SERVICE_ROLE_KEY=test deno test --allow-env supabase/functions/_tests/
import { assert, assertEquals } from "jsr:@std/assert@1";
import { AI_DEFAULTS, costUsd, mistakesValidator, moderate } from "../_shared/ai.ts";
import { combineLevels, mcLevel, QUESTIONS } from "../_shared/level-test.ts";
import { TUTOR_SAFETY_MARKER, TUTOR_SYSTEM, tutorContext, tutorGreeting } from "../_shared/prompts.ts";

Deno.test("moderation: crisis messages are detected in Ukrainian, Russian and English", () => {
  for (const text of ["я не хочу жити", "хочу умереть", "I want to die", "sometimes I cut myself"]) {
    const r = moderate(text);
    assert(r.crisis, text);
  }
});

Deno.test("moderation: ordinary lesson talk is not flagged", () => {
  for (const text of ["I killed time playing games", "My favourite film is about space", "Можна пояснити Present Perfect?", "I went to the cinema yesterday"]) {
    assertEquals(moderate(text).flags, [], text);
  }
});

Deno.test("moderation: contact details are masked and flagged", () => {
  const r = moderate("my number is +380 67 123 45 67, write me at kid@mail.com");
  assert(r.flags.includes("contact"));
  assert(!r.masked.includes("123 45"));
  assert(!r.masked.includes("kid@mail.com"));
});

Deno.test("cost: cache reads are billed at the cache rate", () => {
  const usage = {
    input_tokens: 1_000_000, output_tokens: 100_000, cache_read_input_tokens: 2_000_000, cache_creation_input_tokens: 0,
  } as Parameters<typeof costUsd>[2];
  // 1M × $2 + 0.1M × $10 + 2M × $0.2 = 2 + 1 + 0.4
  assertEquals(Number(costUsd(AI_DEFAULTS, "claude-sonnet-5", usage).toFixed(4)), 3.4);
});

Deno.test("cost: unknown models fall back to the main model price", () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } as Parameters<typeof costUsd>[2];
  assertEquals(costUsd(AI_DEFAULTS, "claude-unknown", usage), 2);
});

Deno.test("structured output: malformed mistakes are dropped, valid ones kept", () => {
  const parsed = mistakesValidator.parse([
    { category: "grammar", example: "I goed", correction: "I went", explanation: "past of go" },
    { category: "nonsense", example: "a", correction: "b", explanation: "" },
    { category: "grammar", example: "", correction: "x" },
    "not an object",
  ]);
  assertEquals(parsed.length, 2);
  assertEquals(parsed[1].category, "other");
});

Deno.test("level test: answer key is in range and levels combine conservatively", () => {
  for (const q of QUESTIONS) assert(q.answer >= 0 && q.answer < q.options.length, q.id);
  assertEquals(QUESTIONS.length, 20);
  assertEquals(mcLevel(0), "A0");
  assertEquals(mcLevel(12), "B1");
  assertEquals(mcLevel(20), "C1");
  assertEquals(combineLevels("B2", null), "B2");
  assertEquals(combineLevels("B1", "B2"), "B1");
  assertEquals(combineLevels("C1", "A2"), "A2");
});

Deno.test("prompts: the stable system prompt carries the safety marker and no per-student data", () => {
  assert(TUTOR_SYSTEM.includes(TUTOR_SAFETY_MARKER));
  assert(!/\d{4}-\d{2}-\d{2}/.test(TUTOR_SYSTEM), "no dates in the cached prefix");
  const ctx = {
    firstName: "Софія", level: "B1", ageGroup: "teens", mode: "lesson" as const,
    lesson: { title: "Teens B1", topic: "Travel", date: "2026-09-20", vocabulary: [{ term: "luggage" }], grammar: [] },
    mistakes: [{ category: "grammar", example: "I goed", correction: "I went", occurrences: 3 }],
  };
  const text = tutorContext(ctx);
  assert(text.includes("luggage") && text.includes("I went") && text.includes("B1"));
  assert(tutorGreeting(ctx).includes("Travel"));
});
