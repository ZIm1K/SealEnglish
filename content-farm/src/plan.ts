// Stage 1–2: trend slice → AI analysis → ranked ideas that bridge a trend to English.
import { BRAND_BIBLE } from "./brand.ts";
import type { FarmSettings } from "./env.ts";
import { research, structured, type Budget, type StructuredCall } from "./llm.ts";
import { IdeasSchema, type Idea } from "./schema.ts";
import { loadStoryBank, saveStoryBank } from "./store.ts";
import { collectSignals, type TrendSignal } from "./trends/sources.ts";

export interface TrendScan {
  signals: TrendSignal[];
  web_report: string;
  /** Verified story material (facts + sources) for the viral story format. */
  story_report: string;
  /** What the owner should know about this scan (e.g. the web search returned nothing). */
  warnings: string[];
}

export const NO_SCAN: TrendScan = { signals: [], web_report: "", story_report: "", warnings: [] };

const today = () =>
  new Date().toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv", day: "numeric", month: "long", year: "numeric", weekday: "long" });

export async function scanTrends(s: FarmSettings, budget: Budget, log: (m: string) => void): Promise<TrendScan> {
  log("Збираю сигнали з відкритих джерел…");
  const signals = await collectSignals(log);

  const warnings: string[] = [];
  // A report written without a single successful search is the model's memory dressed up as
  // research: drop it so ideation doesn't treat it as verified, and tell the owner.
  const verified = async (call: Promise<{ text: string; searches: number }>, name: string) => {
    // An API error in one research step must not cost the whole pack: the saved story bank and the
    // raw Google Trends signals still make a usable (if less fresh) one.
    const r = await call.catch((e) => ({ text: "", searches: 0, error: (e as Error).message.slice(0, 160) }));
    if (r.searches) return r.text;
    const why = "error" in r ? `дослідження впало: ${r.error}` : "веб-пошук не дав результатів";
    warnings.push(`${why} (${name}) — ідеї без свіжих підтверджених джерел, факти перевірте вручну`);
    log(`  ⚠ ${warnings.at(-1)}`);
    return "";
  };

  log(`Claude шукає соцмережеві тренди (до ${s.web_searches} пошуків)…`);
  const trends = research({
    s,
    budget,
    what: "trend_scan",
    maxSearches: s.web_searches,
    system:
      "Ти — трендвотчер для SMM онлайн-школи англійської. Шукаєш свіжі тренди і пишеш стислий, фактичний звіт українською з посиланнями на джерела. Нічого не вигадуй: якщо не знайшов підтвердження — не включай.",
    prompt: `Сьогодні ${today()}.
Знайди, що зараз (останні 7–10 днів) у тренді серед українських підлітків 12–18 і молоді в TikTok, Instagram Reels і Threads:
1) мем-формати й шаблони відео, які масово повторюють;
2) трендові звуки/фрази/сленг (особливо англомовні слова, які підлітки вживають, не знаючи точного значення);
3) події та інфоприводи, що цікавлять підлітків: релізи ігор, фільмів, серіалів, музики, шкільний календар (НМТ, канікули, свята), сезонні теми;
4) формати навчального контенту про англійську, які зараз «залітають» в англомовному і українському TikTok.
Виключи політику, війну, трагедії й усе російське.
Формат відповіді: маркований список 15–25 пунктів. Кожен пункт: назва тренду — що це — чому актуально зараз — джерело.`,
  });
  const web_report = await verified(trends, "тренди");

  // One research finds 10–12 stories and a pack uses one or two, so the report is kept and reused
  // (already-made ideas are excluded by title) instead of paying for a new search every pack.
  const bank = s.story_research_days > 0 ? await loadStoryBank() : null;
  const bankAge = bank ? (Date.now() - new Date(bank.saved_at).getTime()) / 864e5 : Infinity;
  if (bank && bankAge < s.story_research_days) {
    log(`Сировина для історій: беру збережену (${bankAge.toFixed(1)} дн. тому; оновлюється раз на ${s.story_research_days} дн.)`);
    return { signals, web_report, story_report: bank.report, warnings };
  }
  log("Claude шукає сировину для вірусних історій (перевірені факти з джерелами)…");
  const stories = research({
    s,
    budget,
    what: "story_research",
    maxSearches: Math.max(4, Math.round(s.web_searches * 0.75)),
    system:
      "Ти — дослідник для каналу вірусних історій. Знаходиш маловідомі, але ПРАВДИВІ історії й факти, перевіряєш їх у надійних джерелах і пишеш стисло українською з посиланнями. Нічого не вигадуй і не прикрашай.",
    prompt: `Сьогодні ${today()}.
Знайди 10–12 історій/фактів, які зачеплять будь-кого (від школяра до бабусі) і мають природний зв'язок з англійською мовою, словами чи культурою англомовних країн. Напрями:
- помилки перекладу та слоганів, що коштували компаніям грошей чи репутації;
- справжнє походження відомих англійських слів, виразів, імен, назв (OK, hello, sandwich, jeans тощо — шукай менш заїжджені);
- кумедні/шокуючі непорозуміння туристів, культурний шок, дивні закони й звичаї США/Британії/Австралії;
- історії людей, у яких знання (чи незнання) англійської змінило життя;
- свіжі вірусні інфоприводи цього тижня з англомовного інтернету, що можна безпечно розповісти.
Виключи політику, війну, трагедії, смерті, все російське.
Для кожної: заголовок-хук — 3–6 ключових фактів (хто, де, коли, цифри) — англійська пасхалка — 1–2 URL джерел.`,
  });
  const story_report = await verified(stories, "історії");
  if (story_report) await saveStoryBank(story_report);
  // Research failed this time: an older verified report still beats ideas from memory.
  return { signals, web_report, story_report: story_report || bank?.report || "", warnings };
}

export interface IdeateInput {
  scan: TrendScan;
  recentTitles: string[];
  count: number;
  /** How many of `count` must be viral stories. */
  stories: number;
  topic?: string;
}

export async function ideate(opts: IdeateInput & { s: FarmSettings; budget: Budget }): Promise<Idea[]> {
  const { ideas } = await structured({ s: opts.s, budget: opts.budget, ...ideateCall(opts, opts.s.ideate_effort) });
  return rankIdeas(ideas);
}

/** Drops malformed ideas (truncated titles, empty fields) the model occasionally appends; best first. */
export const rankIdeas = (ideas: Idea[]) =>
  ideas.filter((i) => i.title.trim().length >= 10 && i.trend.trim().length >= 5 && i.bridge.trim().length >= 5).sort((a, b) => ideaScore(b) - ideaScore(a));

export function ideateCall(opts: IdeateInput, effort: FarmSettings["ideate_effort"] = "high"): StructuredCall<typeof IdeasSchema> {
  const signals = opts.scan.signals
    .map((t) => `- [${t.source}] ${t.title}${t.traffic ? ` (${t.traffic})` : ""}${t.detail ? ` — ${t.detail}` : ""}`)
    .join("\n");
  return {
    what: "ideate",
    schema: IdeasSchema,
    effort,
    system: `Ти — креативний продюсер коротких відео для бренду нижче. Твоє завдання — знаходити виходи на ЦА через тренди, не порушуючи концепцію бренду.\n\n${BRAND_BIBLE}`,
    prompt: `Сьогодні ${today()}.

## Звіт трендвотчера (соцмережі)
${opts.scan.web_report || "(немає)"}

## Сировина для історій (перевірені факти з джерелами)
${opts.scan.story_report || "(немає)"}

## Сирі сигнали (пошукові/відео-тренди; більшість не підходить — фільтруй жорстко)
${signals || "(немає)"}

## Нещодавно вже зроблені ідеї — не повторюй їх
${opts.recentTitles.map((t) => `- ${t}`).join("\n") || "(поки нічого)"}
${opts.topic ? `\n## Побажання власника на цей запуск\n${opts.topic}\n` : ""}
Запропонуй ${opts.count} ідей коротких відео: рівно ${opts.stories} у форматі story (вірусні історії для всіх), решта — навчальні рубрики (quiz, wrong_right, decode, list, різні).
Правила:
- story: головне — вірусність для широкої аудиторії. Беремо історію з «сировини» (і переносимо її факти + URL у поле facts) або трендовий POV. Зв'язок з англійською — пасхалкою.
- Навчальні рубрики спираються на тренд зі звіту/сигналів або сезонну подію і мають чіткий міст до англійської.
- Оцінки чесні: score_any_audience високий лише якщо ролик розважить навіть людину без інтересу до англійської.
- Відкидай усе, що порушує заборони бренду, навіть якщо це дуже вірусно.
- Ідея має бути смішною/цікавою людині без знання англійської: гумор із ситуації та реакції. Гра англійських слів — лише якщо її миттєво пояснено українською в самому ролику.`,
  };
}

export const ideaScore = (i: Idea) =>
  i.score_virality * 0.35 + i.score_brand_fit * 0.3 + i.score_any_audience * 0.35 - (i.risk_notes ? 1 : 0);
