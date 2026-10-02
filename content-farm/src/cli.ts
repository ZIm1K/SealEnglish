// Entry point: `npm run farm -- <command> [--flags]`.
import path from "node:path";
import { DEMO_PROPS } from "../remotion/demo.ts";
import { ROOT, saveSetting, settings, supabase } from "./env.ts";
import { Budget } from "./llm.ts";
import { ideate, scanTrends } from "./plan.ts";
import { produceApproved, rewriteRequested, writeScripts } from "./produce.ts";
import { makeBundle, preparePublic, renderVideo } from "./render.ts";
import { finishRun, freshIdeas, recentTitles, saveIdeas, startRun, type StoredIdea } from "./store.ts";

const [, , command = "help", ...rest] = process.argv;
const flags: Record<string, string> = {};
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith("--")) continue;
  const next = rest[i + 1];
  flags[rest[i].slice(2)] = next && !next.startsWith("--") ? next : "true";
}
const num = (k: string, d: number) => (flags[k] !== undefined ? Number(flags[k]) : d);

const STORY_SEP = "\n\n— — — Історії — — —\n\n";
const lines: string[] = [];
const log = (m: string) => {
  lines.push(m);
  console.log(m);
};

/** Split ranked ideas: best stories + best edu ideas go to video (by story share), text-friendly leftovers to posts. */
function split(ideas: StoredIdea[], videos: number, texts: number, storyShare: number) {
  const wantStories = Math.round(videos * storyShare);
  const stories = ideas.filter((i) => i.idea.format === "story").slice(0, wantStories);
  const edu = ideas.filter((i) => i.idea.format !== "story").slice(0, videos - stories.length);
  const v = [...stories, ...edu];
  if (v.length < videos) v.push(...ideas.filter((i) => !v.includes(i)).slice(0, videos - v.length));
  const t = ideas.filter((i) => !v.includes(i) && i.idea.text_post_ok).slice(0, texts);
  return { v, t };
}

async function main() {
  const s = await settings();
  if (flags.model) s.model = flags.model;
  if (!supabase()) log("ℹ SUPABASE_SERVICE_ROLE_KEY не задано — працюю локально (результати лише в content-farm/out)");

  switch (command) {
    case "demo": {
      preparePublic();
      const out = await renderVideo(await makeBundle(), DEMO_PROPS, path.join(ROOT, "out"), "demo");
      log(`Готово: ${out.video} (${out.seconds.toFixed(1)} с)`);
      return;
    }

    case "scan":
    case "daily":
    case "custom": {
      const runId = await startRun(command);
      const budget = new Budget(Infinity);
      try {
        const scan =
          command === "custom" && !flags.trends ? { signals: [], web_report: "", story_report: "" } : await scanTrends(s, budget, log);
        const count = command === "custom" ? num("count", 1) : num("ideas", s.ideas_per_scan);
        // custom: --format story (default) | edu
        const stories = command === "custom" ? (flags.format === "edu" ? 0 : count) : Math.max(Math.ceil(count * s.story_share), 1);
        log(`Аналіз трендів і генерація ${count} ідей (історій: ${stories})…`);
        const ideas = await ideate({ s, budget, scan, recentTitles: await recentTitles(), count, stories, topic: flags.topic });
        const stored = await saveIdeas(runId, ideas);
        for (const [i, { idea }] of stored.entries()) log(`  ${i + 1}. [${idea.format}] ${idea.title} — ${idea.trend}`);
        log(`Аналіз коштував $${budget.spent.toFixed(3)}`);

        let made = 0;
        if (command !== "scan") {
          const share = command === "custom" ? (flags.format === "edu" ? 0 : 1) : s.story_share;
          const { v, t } = split(stored, num("videos", command === "custom" ? 1 : s.videos_per_run), num("texts", command === "custom" ? 0 : s.texts_per_run), share);
          // Scripts only — media is produced after the owner approves them in the cabinet (`work`).
          made += await writeScripts(s, v, t, log);
        }
        await finishRun(runId, { status: "done", cost_usd: budget.spent, log: lines.join("\n"), signals: scan.signals, web_report: [scan.web_report, scan.story_report].filter(Boolean).join(STORY_SEP) });
        log(`Готово. Сценаріїв на затвердження: ${made}`);
      } catch (e) {
        await finishRun(runId, { status: "failed", cost_usd: budget.spent, log: lines.join("\n"), error: String(e) });
        throw e;
      }
      return;
    }

    case "voice-design": {
      // 1) `voice-design` → previews into out/voice-previews; 2) `voice-design --pick N` → saves voice N for Sílі.
      const eleven = await import("./media/eleven.ts");
      const fs = await import("node:fs");
      const dir = path.join(ROOT, "out", "voice-previews");
      const stateFile = path.join(dir, "previews.json");
      if (flags.pick) {
        const ids = JSON.parse(fs.readFileSync(stateFile, "utf8")) as string[];
        const gen = ids[Number(flags.pick) - 1];
        if (!gen) throw new Error(`Немає варіанта ${flags.pick}`);
        const voiceId = await eleven.saveDesignedVoice("Sílі (Seal English)", eleven.SEAL_VOICE_DESCRIPTION, gen);
        await saveSetting({ eleven_voices: { ...s.eleven_voices, seal: voiceId } });
        log(`Голос Сілі збережено: ${voiceId} (app_settings.content_farm.eleven_voices.seal)`);
        return;
      }
      fs.mkdirSync(dir, { recursive: true });
      const ids: string[] = [];
      for (let round = 0; round < Number(flags.rounds ?? 1); round++) {
        for (const p of await eleven.designVoice(flags.description ?? eleven.SEAL_VOICE_DESCRIPTION, eleven.SEAL_VOICE_SAMPLE)) {
          ids.push(p.id);
          fs.writeFileSync(path.join(dir, `sili-${ids.length}.mp3`), p.audio);
        }
      }
      fs.writeFileSync(stateFile, JSON.stringify(ids));
      log(`Варіантів: ${ids.length} → ${dir}. Обрати: npm run farm -- voice-design --pick N`);
      return;
    }

    case "voices": {
      // ElevenLabs voices on the account → put chosen ids into app_settings.content_farm.eleven_voices.
      const { listElevenVoices } = await import("./media/eleven.ts");
      for (const v of await listElevenVoices()) log(`${v.voice_id}  ${v.name}  ${Object.values(v.labels ?? {}).join(", ")}`);
      log(`
Поточні ролі: ${JSON.stringify(s.eleven_voices, null, 2)}`);
      return;
    }

    case "produce": {
      // Scripts from ideas saved by earlier scans (no new trend scan).
      const videos = num("videos", s.videos_per_run);
      const texts = num("texts", s.texts_per_run);
      const ideas = await freshIdeas(videos + texts * 2);
      if (!ideas.length) return log("Немає свіжих ідей — запустіть `scan` або `daily`.");
      const { v, t } = split(ideas, videos, texts, s.story_share);
      log(`Готово. Сценаріїв на затвердження: ${await writeScripts(s, v, t, log)}`);
      return;
    }

    case "work": {
      // Frequent, cheap when idle: rewrite scripts the owner commented on, produce approved ones.
      const rewritten = await rewriteRequested(s, log);
      const produced = await produceApproved(s, log);
      if (rewritten || produced) log(`Переписано: ${rewritten} · вироблено: ${produced}`);
      return;
    }

    default:
      console.log(`Seal English — контент-ферма

  npm run farm -- daily [--videos 2] [--texts 3] [--topic "…"]
      зріз трендів → аналіз ШІ → ідеї → сценарії на затвердження (кабінет → «Контент-ферма»)
  npm run farm -- scan [--ideas 10]          лише тренди та ідеї (збережуться в базі)
  npm run farm -- produce [--videos 1]       сценарії зі свіжих збережених ідей
  npm run farm -- work                       переписати сценарії за коментарями + виробити затверджені (кожні 15 хв)
  npm run farm -- custom --topic "…" [--format story|edu] [--trends]
      відео на задану тему: story — вірусна історія (за замовчуванням), edu — навчальний ролик
  npm run farm -- voices                     список голосів ElevenLabs (для вибору голосу кожної ролі)
  npm run farm -- demo                       тестовий рендер без API-ключів

  Загальні прапорці: --model claude-sonnet-5-5 (дешевша модель)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
