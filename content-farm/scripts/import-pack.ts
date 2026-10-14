// Saves a pack written by hand (or by Claude in chat) for approval in the cabinet — no LLM calls.
// Usage: npx tsx scripts/import-pack.ts packs/2026-10-14.json
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { settings } from "../src/env.ts";
import { Budget } from "../src/llm.ts";
import { savePostItems, saveScriptItem } from "../src/produce.ts";
import { PostsBundleSchema, ScriptSchema, StorySchema } from "../src/schema.ts";
import { normalizeScript, normalizeStory, withCrossPosts } from "../src/script.ts";

const file = process.argv[2];
if (!file) throw new Error("Вкажи файл пакета");
const pack = JSON.parse(fs.readFileSync(file, "utf8"));
const s = await settings();
const packId = randomUUID();
const made: string[] = [];

if (pack.tiktok) {
  const data = normalizeStory(StorySchema.parse(withCrossPosts(pack.tiktok.data)));
  await saveScriptItem(s, packId, "tiktok", pack.tiktok.title, null, data as unknown as Record<string, unknown>, new Budget(Infinity), "video");
  made.push("TikTok");
}
if (pack.stories) {
  const data = normalizeScript(ScriptSchema.parse(withCrossPosts(pack.stories.data)));
  await saveScriptItem(s, packId, "stories", pack.stories.title, null, data as unknown as Record<string, unknown>, new Budget(Infinity), "video");
  made.push("Stories");
}
if (pack.posts) made.push(...(await savePostItems(s, packId, PostsBundleSchema.partial().parse(pack.posts), 0)));

console.log(`Пакет ${packId}: ${made.join(", ")}`);
