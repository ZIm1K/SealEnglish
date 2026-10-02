// Stage 1–2: trend slice → AI analysis → ranked ideas that bridge a trend to English.
import { BRAND_BIBLE } from "./brand.ts";
import type { FarmSettings } from "./env.ts";
import { research, structured, type Budget } from "./llm.ts";
import { IdeasSchema, type Idea } from "./schema.ts";
import { collectSignals, type TrendSignal } from "./trends/sources.ts";

export interface TrendScan {
  signals: TrendSignal[];
  web_report: string;
  /** Verified story material (facts + sources) for the viral story format. */
  story_report: string;
}

const today = () =>
  new Date().toLocaleDateString("uk-UA", { timeZone: "Europe/Kyiv", day: "numeric", month: "long", year: "numeric", weekday: "long" });

export async function scanTrends(s: FarmSettings, budget: Budget, log: (m: string) => void): Promise<TrendScan> {
  log("Збираю сигнали з відкритих джерел…");
  const signals = await collectSignals(log);

  log(`Claude шукає соцмережеві тренди (до ${s.web_searches} пошуків)…`);
  const web_report = await research({
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
  log("Claude шукає сировину для вірусних історій (перевірені факти з джерелами)…");
  const story_report = await research({
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
  return { signals, web_report, story_report };
}

export async function ideate(opts: {
  s: FarmSettings;
  budget: Budget;
  scan: TrendScan;
  recentTitles: string[];
  count: number;
  /** How many of `count` must be viral stories. */
  stories: number;
  topic?: string;
}): Promise<Idea[]> {
  const signals = opts.scan.signals
    .map((t) => `- [${t.source}] ${t.title}${t.traffic ? ` (${t.traffic})` : ""}${t.detail ? ` — ${t.detail}` : ""}`)
    .join("\n");
  const { ideas } = await structured({
    s: opts.s,
    budget: opts.budget,
    what: "ideate",
    schema: IdeasSchema,
    effort: "high",
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
  });
  return ideas.sort((a, b) => ideaScore(b) - ideaScore(a));
}

export const ideaScore = (i: Idea) =>
  i.score_virality * 0.35 + i.score_brand_fit * 0.3 + i.score_any_audience * 0.35 - (i.risk_notes ? 1 : 0);
