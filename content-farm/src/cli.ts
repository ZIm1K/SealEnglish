// Entry point: `npm run farm -- <command> [--flags]`.
import path from "node:path";
import { DEMO_PROPS } from "../remotion/demo.ts";
import { ROOT, saveSetting, settings, supabase } from "./env.ts";
import { Budget } from "./llm.ts";
import { ideate, NO_SCAN, scanTrends } from "./plan.ts";
import { pickPackIdeas, produceApproved, rewriteRequested, writePack, writeScripts } from "./produce.ts";
import { makeBundle, preparePublic, renderVideo } from "./render.ts";
import { finishRun, freshIdeas, recentTitles, saveIdeas, startRun } from "./store.ts";

const [, , command = "help", ...rest] = process.argv;
const flags: Record<string, string> = {};
for (let i = 0; i < rest.length; i++) {
  if (!rest[i].startsWith("--")) continue;
  const next = rest[i + 1];
  flags[rest[i].slice(2)] = next && !next.startsWith("--") ? next : "true";
}
const num = (k: string, d: number) => (flags[k] !== undefined ? Number(flags[k]) : d);

const LF = "\n";
const STORY_SEP = "\n\n— — — Історії — — —\n\n";
const lines: string[] = [];
const log = (m: string) => {
  lines.push(m);
  console.log(m);
};

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
    case "pack":
    case "daily":
    case "custom": {
      // pack (alias daily): trends → ideas → one pack (TikTok story, Stories edu, Threads, Telegram, Instagram).
      // custom: one video script on --topic (--format story|edu). scan: ideas only.
      const runId = await startRun(command);
      const budget = new Budget(Infinity);
      try {
        const scan =
          command === "custom" && !flags.trends ? NO_SCAN : await scanTrends(s, budget, log);
        const count = command === "custom" ? num("count", 1) : num("ideas", 6);
        const stories = command === "custom" ? (flags.format === "edu" ? 0 : count) : 2;
        log(`Аналіз трендів і генерація ${count} ідей (історій: ${stories})…`);
        const ideas = await ideate({ s, budget, scan, recentTitles: await recentTitles(), count, stories, topic: flags.topic });
        const stored = await saveIdeas(runId, ideas);
        for (const [i, { idea }] of stored.entries()) log(`  ${i + 1}. [${idea.format}] ${idea.title} — ${idea.trend}`);
        log(`Аналіз коштував $${budget.spent.toFixed(3)}`);

        const warnings = [...scan.warnings];
        // A pack's two videos voice ≈ 2 500 characters; warn while there is still time to top up,
        // because without the voice the videos won't be produced at all.
        if (command !== "scan" && s.tts_provider === "eleven") {
          const { elevenCharactersLeft } = await import("./media/eleven.ts");
          const left = await elevenCharactersLeft();
          if (left !== null && left < 5000) warnings.push(`ElevenLabs: лишилось ${left} символів — цього не вистачить на два пакети, поповніть до затвердження відео`);
        }

        // Scripts only — media is produced after the owner approves them in the cabinet (`work`).
        let made = 0;
        if (command === "custom") made = await writeScripts(s, stored.slice(0, 1), log, warnings);
        else if (command !== "scan") made = await writePack(s, pickPackIdeas(stored), log, warnings);
        await finishRun(runId, { status: "done", cost_usd: budget.spent, log: lines.join(LF), signals: scan.signals, web_report: [scan.web_report, scan.story_report].filter(Boolean).join(STORY_SEP) });
        log(`Готово. На затвердження: ${made}`);
      } catch (e) {
        await finishRun(runId, { status: "failed", cost_usd: budget.spent, log: lines.join(LF), error: String(e) });
        throw e;
      }
      return;
    }

    case "drive-migrate": {
      // Copies videos that still live in the Supabase bucket to Google Drive and points their items
      // at the copies. Nothing is deleted here — see `storage-cleanup`.
      const { driveAvailable, driveViewUrl, uploadToDrive } = await import("./drive.ts");
      const sb = supabase();
      if (!sb || !(await driveAvailable())) throw new Error("Google ще не підключено з доступом до Диска: кабінет → Налаштування → Інтеграції → підключити Google ще раз");
      const fs = await import("node:fs");
      const os = await import("node:os");
      const { data: items, error } = await sb.from("content_items").select("id, title, video_path, created_at").not("video_path", "is", null).is("drive_file_id", null).order("created_at");
      if (error) throw error;
      for (const item of items ?? []) {
        const { data: blob, error: dl } = await sb.storage.from("content").download(item.video_path as string);
        if (dl || !blob) {
          log(`  ✖ ${item.title}: не вдалося завантажити із Supabase (${dl?.message ?? "порожньо"})`);
          continue;
        }
        const tmp = path.join(os.tmpdir(), path.basename(item.video_path as string));
        fs.writeFileSync(tmp, Buffer.from(await blob.arrayBuffer()));
        try {
          const id = await uploadToDrive(s, tmp, path.basename(tmp), "video/mp4", ["Відео", (item.created_at as string).slice(0, 7)]);
          await sb.from("content_items").update({ drive_file_id: id }).eq("id", item.id);
          log(`  ✔ ${item.title} → ${driveViewUrl(id)}`);
        } finally {
          fs.rmSync(tmp, { force: true });
        }
      }
      log(`Скопійовано: ${(items ?? []).length}. Файли в Supabase лишились на місці — прибрати: npm run farm -- storage-cleanup`);
      return;
    }

    case "storage-cleanup": {
      // Removes videos from the Supabase bucket that are safe to lose: superseded renders nothing
      // points at, and videos whose items already have a copy on Google Drive. Lists by default;
      // deletes only with --yes (irreversible, so it is the owner's command to run).
      const sb = supabase();
      if (!sb) throw new Error("Потрібен SUPABASE_SERVICE_ROLE_KEY");
      const { data: files, error } = await sb.storage.from("content").list("videos", { limit: 1000 });
      if (error) throw error;
      const { data: items } = await sb.from("content_items").select("id, video_path, drive_file_id").not("video_path", "is", null);
      const kept = new Set((items ?? []).filter((i) => !i.drive_file_id).map((i) => i.video_path as string));
      const moved = (items ?? []).filter((i) => i.drive_file_id);
      const doomed = (files ?? []).filter((f) => f.name.endsWith(".mp4") && !kept.has(`videos/${f.name}`));
      const mb = (list: typeof doomed) => (list.reduce((a, f) => a + Number((f.metadata as { size?: number } | null)?.size ?? 0), 0) / 1e6).toFixed(0);
      for (const f of doomed) log(`  ${f.name}  ${(Number((f.metadata as { size?: number } | null)?.size ?? 0) / 1e6).toFixed(0)} МБ`);
      log(`До видалення: ${doomed.length} відео, ${mb(doomed)} МБ (обкладинки й кеш не чіпаю). Лишаються в Supabase: ${kept.size}.`);
      if (flags.yes !== "true") return log("Це перелік. Видалити безповоротно: npm run farm -- storage-cleanup --yes");
      if (doomed.length) {
        const { error: rm } = await sb.storage.from("content").remove(doomed.map((f) => `videos/${f.name}`));
        if (rm) throw rm;
      }
      for (const i of moved) await sb.from("content_items").update({ video_path: null }).eq("id", i.id);
      log(`Видалено: ${doomed.length} відео.`);
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
      // A pack from ideas saved by earlier scans (no new trend scan).
      const ideas = await freshIdeas(8);
      if (!ideas.length) return log("Немає свіжих ідей — запустіть `scan` або `pack`.");
      log(`Готово. На затвердження: ${await writePack(s, pickPackIdeas(ideas), log)}`);
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
  npm run farm -- drive-migrate              скопіювати відео із Supabase на Google Drive
  npm run farm -- storage-cleanup [--yes]    перелік (з --yes — видалення) відео в Supabase, які вже не потрібні
  npm run farm -- demo                       тестовий рендер без API-ключів

  Загальні прапорці: --model claude-sonnet-5-5 (дешевша модель)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
