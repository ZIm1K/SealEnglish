// A pack written through the Message Batches API. The texts are the same calls `writePack` makes
// live, but nobody is waiting at 6 a.m., so they go in three batches at half price:
//   ideas → drafts (story, edu script, posts) → edits (the humanizer pass) → save + notify.
// A batch is answered asynchronously, so the pack is a small state machine kept in
// content_runs.state: a run polls for a few minutes and, if the batch isn't done, leaves the rest to
// the next `work` run. A request the batch didn't answer (error, refusal, schema miss) is made live.
import { randomUUID } from "node:crypto";
import type { FarmSettings } from "./env.ts";
import { humanizeCall } from "./humanize.ts";
import { Budget, cancelBatch, collectBatch, structured, submitBatch, type StructuredCall } from "./llm.ts";
import { notifyAdmins } from "./notify.ts";
import { ideateCall, rankIdeas, type IdeateInput } from "./plan.ts";
import { CHANNEL_LABEL, pickPackIdeas, saveScriptItem, warningLines } from "./produce.ts";
import { PostsBundleSchema, type Idea, type PostsBundle, type Script, type Story } from "./schema.ts";
import { normalizeScript, normalizeStory, postsCall, scriptCall, scriptSchema, storyCall, storySchema, withCrossPosts } from "./script.ts";
import { claimRun, finishRun, markIdea, releaseRun, runningPack, saveIdeas, saveRunState, siteUrl, type StoredIdea } from "./store.ts";

type Log = (m: string) => void;
type Lines = Budget["lines"];

export interface PackState {
  pack_id: string;
  stage: "ideas" | "drafts" | "edits";
  batch_id: string;
  stage_started_at: string;
  input: IdeateInput;
  warnings: string[];
  notes: string[];
  log: string[];
  /** Cost of the trend scan that ran before the first batch. */
  scan_cost: number;
  /** Cost lines per call key (ideate, story, humanize_story, …), gathered as the batches come back. */
  lines: Record<string, Lines>;
  picks?: { story: StoredIdea | null; edu: StoredIdea | null; posts: StoredIdea[] };
  drafts?: { story?: unknown; script?: unknown; posts?: unknown };
}

/** The calls of the current stage, rebuilt from the saved inputs (so their schemas can parse the answers). */
function stageCalls(s: FarmSettings, st: PackState): Record<string, StructuredCall> {
  if (st.stage === "ideas") return { ideate: ideateCall(st.input) };
  const calls: Record<string, StructuredCall> = {};
  if (st.stage === "drafts") {
    if (st.picks?.story) calls.story = storyCall(s, st.picks.story.idea);
    if (st.picks?.edu) calls.script = scriptCall(s, st.picks.edu.idea);
    if (st.picks?.posts.length) calls.posts = postsCall(st.picks.posts.map((p) => p.idea));
    return calls;
  }
  if (st.drafts?.story) calls.humanize_story = humanizeCall(storySchema(s), st.drafts.story as never, "story");
  if (st.drafts?.script) calls.humanize_script = humanizeCall(scriptSchema(s), st.drafts.script as never, "script");
  if (st.drafts?.posts) calls.humanize_posts = humanizeCall(PostsBundleSchema, st.drafts.posts as never, "posts");
  return calls;
}

const budgetOf = (limit: number, ...lines: (Lines | undefined)[]) => {
  const b = new Budget(limit);
  for (const l of lines.flat()) if (l) b.add(l.what, l.usd, l.tokens);
  return b;
};

/** Saves the pack's five items and tells the owner — the same result `writePack` produces live. */
async function finish(s: FarmSettings, runId: string, st: PackState, final: { story?: unknown; script?: unknown; posts?: unknown }, say: Log) {
  const made: string[] = [];
  if (final.story && st.picks?.story) {
    const data = normalizeStory(withCrossPosts(final.story as object) as Story);
    await saveScriptItem(s, st.pack_id, "tiktok", st.picks.story.idea.title, st.picks.story, data as unknown as Record<string, unknown>, budgetOf(s.max_usd_per_video, st.lines.story, st.lines.humanize_story), "video");
    made.push(CHANNEL_LABEL.tiktok);
  }
  if (final.script && st.picks?.edu) {
    const data = normalizeScript(withCrossPosts(final.script as object) as Script);
    await saveScriptItem(s, st.pack_id, "stories", st.picks.edu.idea.title, st.picks.edu, data as unknown as Record<string, unknown>, budgetOf(s.max_usd_per_video, st.lines.script, st.lines.humanize_script), "video");
    made.push(CHANNEL_LABEL.stories);
  }
  if (final.posts && st.picks?.posts.length) {
    const bundle = final.posts as PostsBundle;
    const share = new Budget(Infinity);
    share.add("posts_share", budgetOf(Infinity, st.lines.posts, st.lines.humanize_posts).spent / 3);
    const titleOf = (text: string) => text.split("\n")[0].replace(/[*_#]/g, "").slice(0, 80) || "Пост";
    await saveScriptItem(s, st.pack_id, "threads", titleOf(bundle.threads.text), null, { channel: "threads", ...bundle.threads }, share, "text");
    await saveScriptItem(s, st.pack_id, "telegram", titleOf(bundle.telegram.text), null, { channel: "telegram", ...bundle.telegram }, share, "text");
    await saveScriptItem(s, st.pack_id, "instagram", bundle.instagram.image_headline, null, { channel: "instagram", ...bundle.instagram }, share, "text");
    for (const p of st.picks.posts) await markIdea(p.id, "used");
    made.push(CHANNEL_LABEL.threads, CHANNEL_LABEL.telegram, CHANNEL_LABEL.instagram);
  }
  const total = st.scan_cost + Object.values(st.lines).flat().reduce((a, l) => a + l.usd, 0);
  if (made.length) {
    await notifyAdmins({
      title: "Новий контент-пакет",
      summary: `📦 Пакет на затвердження: ${made.length} матеріалів · $${total.toFixed(2)}\nВідкрити: ${await siteUrl()}/app/content/${warningLines([...st.warnings, ...st.notes])}`,
      details: made.map((m) => `• ${m}`).join("\n"),
    });
  }
  say(`Пакет ${st.pack_id}: ${made.length} матеріалів · $${total.toFixed(3)}`);
  // Keep the final state (every stage's cost lines) with the finished run for later diagnostics.
  await saveRunState(runId, st);
  await finishRun(runId, {
    status: "done",
    cost_usd: total,
    log: st.log.join("\n"),
    signals: st.input.scan.signals,
    web_report: [st.input.scan.web_report, st.input.scan.story_report].filter(Boolean).join("\n\n— — — Історії — — —\n\n"),
  });
}

/** Moves the pack as far as its batches allow. Returns true when the pack is finished. */
async function advance(s: FarmSettings, runId: string, st: PackState, log: Log): Promise<boolean> {
  const say: Log = (m) => {
    st.log.push(m);
    log(m);
  };
  for (;;) {
    const calls = stageCalls(s, st);
    const budgets = Object.fromEntries(Object.keys(calls).map((k) => [k, new Budget(Infinity)]));
    let answers = await collectBatch(s, st.batch_id, calls, budgets, s.batch_wait_seconds * 1000);
    if (!answers) {
      const waited = (Date.now() - new Date(st.stage_started_at).getTime()) / 36e5;
      if (waited < s.batch_max_hours) {
        log(`  batch «${st.stage}» ще обробляється (${(waited * 60).toFixed(0)} хв) — продовжу на наступному запуску`);
        await saveRunState(runId, st);
        return false;
      }
      // The morning matters more than the discount: stop waiting and make the calls live.
      say(`  batch «${st.stage}» не відповів за ${s.batch_max_hours} год — скасовую й роблю виклики напряму`);
      await cancelBatch(st.batch_id);
      answers = {};
    }
    // Anything the batch didn't answer properly is asked again live (full price, but the pack goes on).
    const got: Record<string, unknown> = {};
    for (const [key, call] of Object.entries(calls)) {
      const a = answers[key];
      if (a !== undefined && !(a instanceof Error)) got[key] = a;
      else {
        if (a instanceof Error) say(`  ↻ ${a.message} — повторюю напряму`);
        got[key] = await structured({ s, budget: budgets[key], ...call }).catch((e: Error) => e);
      }
      st.lines[key] = budgets[key].lines;
    }

    if (st.stage === "ideas") {
      if (got.ideate instanceof Error) throw got.ideate;
      const stored = await saveIdeas(runId, rankIdeas((got.ideate as { ideas: Idea[] }).ideas));
      for (const [i, { idea }] of stored.entries()) say(`  ${i + 1}. [${idea.format}] ${idea.title} — ${idea.trend}`);
      const picks = pickPackIdeas(stored);
      // The Stories slot is for the edu rubrics; a story idea is reformatted if that's all we have.
      st.picks = { story: picks.story, edu: picks.edu ?? (picks.story && { ...picks.story, idea: { ...picks.story.idea, format: "quiz" } }), posts: picks.posts };
      st.stage = "drafts";
    } else if (st.stage === "drafts") {
      st.drafts = {};
      for (const key of ["story", "script", "posts"] as const) {
        if (got[key] instanceof Error) say(`  ✖ ${(got[key] as Error).message}`);
        else if (got[key]) st.drafts[key] = got[key];
      }
      if (!s.humanize) {
        await finish(s, runId, st, st.drafts, say);
        return true;
      }
      st.stage = "edits";
    } else {
      const edited = (key: "story" | "script" | "posts") => {
        const e = got[`humanize_${key}`];
        if (e === undefined || !(e instanceof Error)) return e ?? st.drafts?.[key];
        // Same rule as the live path: the draft is usable, but the owner hears it skipped the editor.
        st.notes.push(`${key === "story" ? CHANNEL_LABEL.tiktok : key === "script" ? CHANNEL_LABEL.stories : "пости"}: без редакторського проходу (${e.message.slice(0, 120)})`);
        return st.drafts?.[key];
      };
      await finish(s, runId, st, { story: edited("story"), script: edited("script"), posts: edited("posts") }, say);
      return true;
    }

    const next = stageCalls(s, st);
    if (!Object.keys(next).length) {
      await finish(s, runId, st, st.drafts ?? {}, say);
      return true;
    }
    st.batch_id = await submitBatch(s, next);
    st.stage_started_at = new Date().toISOString();
    say(`  batch «${st.stage}»: ${Object.keys(next).join(", ")}`);
    await saveRunState(runId, st);
  }
}

async function run(s: FarmSettings, runId: string, st: PackState, log: Log) {
  try {
    await advance(s, runId, st, log);
  } catch (e) {
    const reason = (e as Error).message.slice(0, 400);
    await finishRun(runId, { status: "failed", cost_usd: st.scan_cost, log: st.log.join("\n"), error: reason });
    await notifyAdmins({ title: "Контент-пакет", summary: `❌ Пакет не зібрано: ${reason}`, details: "" }).catch(() => undefined);
    throw e;
  } finally {
    await releaseRun(runId);
  }
}

/** Starts a pack after the trend scan: submits the ideas batch and goes as far as it can in this run. */
export async function startBatchPack(s: FarmSettings, runId: string, input: IdeateInput, warnings: string[], scanCost: number, logLines: string[], log: Log) {
  const st: PackState = {
    pack_id: randomUUID(),
    stage: "ideas",
    batch_id: "",
    stage_started_at: new Date().toISOString(),
    input,
    warnings,
    notes: [],
    log: [...logLines],
    scan_cost: scanCost,
    lines: {},
  };
  if (!(await claimRun(runId))) return;
  st.batch_id = await submitBatch(s, stageCalls(s, st)).catch(async (e) => {
    await finishRun(runId, { status: "failed", cost_usd: scanCost, log: st.log.join("\n"), error: String(e) });
    await releaseRun(runId);
    throw e;
  });
  log(`Пакет іде через Batch API (−50% на тексти): ідеї → сценарії → редактор. batch «ideas» відправлено.`);
  await saveRunState(runId, st);
  await run(s, runId, st, log);
}

/** Called by every `work` run: picks up a pack that is waiting on a batch. */
export async function advancePack(s: FarmSettings, log: Log): Promise<void> {
  const pending = await runningPack();
  if (!pending || !(await claimRun(pending.id))) return;
  log(`Пакет ${pending.state.pack_id}: продовжую з етапу «${pending.state.stage}»`);
  await run(s, pending.id, pending.state, log);
}
