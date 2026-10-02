// Stage 3: idea → full video script + captions for every platform (and text-only posts).
import { BRAND_BIBLE, HANDLES, HUMAN_VOICE } from "./brand.ts";
import type { FarmSettings } from "./env.ts";
import { humanize } from "./humanize.ts";
import { structured, type Budget } from "./llm.ts";
import { ScriptSchema, StorySchema, TextPostSchema, type Idea, type Script, type Story, type TextPost } from "./schema.ts";

const SYSTEM = `Ти — сценарист вертикальних коротких відео (TikTok/Reels, 20–40 секунд) для бренду нижче.
Пишеш так, щоб утримання було максимальним: хук за 1 секунду, кожна сцена додає новизну, панчлайн/відповідь ближче до кінця, CTA коротко.

${BRAND_BIBLE}

${HUMAN_VOICE}

## Технічні правила сценарію
- Відео збирається автоматично з шаблонних сцен; маскот Сілі завжди в кадрі (обирай позу під емоцію сцени).
- Сцени: hook (питання/інтрига), say (пояснення, приклад), compare (wrong vs right), quiz (3 варіанти + таймер 3 с + reveal_voice з поясненням), list_item (пункт списку), cta (фінал).
- voice — природна жива розмовна мова, яку зачитає TTS: без емодзі, без хештегів, без дужок і скорочень. Англійські фрази пиши латиницею.
- headline — дуже коротко, читається за пів секунди. Не дублюй voice слово в слово.
- background=image — максимум 2 сцени на відео, лише якщо ілюстрація справді підсилює (місце, ситуація). Решта — brand.
- Загальна озвучка 55–95 слів.
- Остання сцена cta: заклик на ${HANDLES.bot} або підписку; headline на кшталт «Пробний урок — безкоштовно».`;

export async function writeScript(s: FarmSettings, budget: Budget, idea: Idea): Promise<Script> {
  const draft = await structured({
    s,
    budget,
    what: "script",
    schema: ScriptSchema,
    system: SYSTEM,
    prompt: `Напиши сценарій за ідеєю:\n${JSON.stringify(idea, null, 2)}`,
  });
  return humanize(s, budget, ScriptSchema, draft, "script");
}

export async function writeTextPost(s: FarmSettings, budget: Budget, idea: Idea): Promise<TextPost> {
  const draft = await structured({
    s,
    budget,
    what: "text_post",
    schema: TextPostSchema,
    effort: "low",
    system: `Ти — SMM-автор бренду нижче. Пишеш нативні пости: Threads — коротко, розмовно, з питанням до аудиторії; Telegram — структуровано, з прикладами.\n\n${BRAND_BIBLE}\n\n${HUMAN_VOICE}`,
    prompt: `Напиши пости за ідеєю:\n${JSON.stringify(idea, null, 2)}`,
  });
  return humanize(s, budget, TextPostSchema, draft, "text");
}

/** Soft checks the JSON schema can't express; fixes what's safe to fix. */
export function normalizeScript(script: Script): Script {
  let images = 0;
  const scenes = script.scenes.slice(0, 9).map((sc) => {
    const scene = { ...sc };
    if (scene.background === "image" && (!scene.image_prompt || ++images > 2)) scene.background = "brand";
    if (scene.kind === "quiz" && (scene.options.length < 2 || scene.answer < 0 || scene.answer >= scene.options.length)) {
      scene.kind = "say";
    }
    if (scene.kind === "compare" && (!scene.wrong || !scene.right)) scene.kind = "say";
    return scene;
  });
  if (scenes.at(-1)?.kind !== "cta") {
    scenes.push({
      kind: "cta",
      voice: "Хочеш говорити так само легко? Перший урок у Seal English безкоштовний.",
      headline: "Пробний урок — безкоштовно",
      sub: HANDLES.bot,
      english: "",
      wrong: "",
      right: "",
      options: [],
      answer: -1,
      reveal_voice: "",
      mascot: "wave-happy",
      background: "brand",
      image_prompt: "",
    });
  }
  const mood = ["upbeat", "chill", "funny", "suspense"].find((m) => script.music_mood.toLowerCase().includes(m)) ?? "upbeat";
  return { ...script, scenes, music_mood: mood, hashtags: script.hashtags.map((h) => h.replace(/^#/, "").replace(/\s+/g, "")) };
}

const STORY_SYSTEM = `Ти — сценарист вірусних «безликих» сторітелінг-відео для TikTok/Reels (як найпопулярніші канали фактів та історій).
Твоя мета — утримання до останньої секунди і повторні перегляди, охоплення широкої аудиторії (не лише учнів).

${BRAND_BIBLE}

${HUMAN_VOICE}

## Формат: анімована сценка з Сілі
Ролик — це мультсценка: згенерована ЛОКАЦІЯ (фон) + Сілі, вставлений у передній план, + віртуальна камера.
- Сілі — головний герой, що проживає історію: заходить у кав'ярню, потрапляє на урок, у музей, «мандрує в часі» до події.
  Він діє і говорить сам (seal), а не лише коментує збоку. Якщо в історії є людина-протагоніст — її роль грає Сілі.
- Другорядні персонажі (продавець, вчитель, турист) — частина ФОНУ локації: опиши їх у locations[].prompt разом із місцем,
  де вони стоять (left/center/right → npc_side). Вони говорять своїм голосом, камера тоді наїжджає на них (shot=npc).
- Діалог-сценка: 1–2 локації, камера чергує npc ↔ seal, wide — для оповідача. Історія-факт: 4–6 локацій-«слайдів»,
  Сілі з'являється в частині з них як свідок/учасник.
- seal_side — бік переднього плану, де стоїть Сілі; герой фону — з протилежного боку. Тримай seal_side стабільним у межах локації.
- seal_pose — емоція кадру: stand-surprised (шок), stand-sad, stand-wink (хитро), stand-joy/wave-happy (радість), read-* (думає/вчиться).

## Зрозумілість сюжету — найважливіше правило
Глядач бачить ролик уперше, без звуку половину часу, і гортає стрічку. Якщо він хоч раз не зрозумів «що відбувається» — він пішов.
- Одна історія = один конфлікт (одне непорозуміння / одна загадка). Ніяких побічних жартів, що потребують пояснення.
- Лінійно: завязка (хто, де, чого хоче — 1–2 репліки) → ускладнення → наростання (2–3 кроки, кожен логічно випливає з попереднього)
  → розв'язка (пояснення) → панчлайн / питання. Кожна репліка — відповідь на попередню або наслідок попередньої.
- Хук інтригує, але НЕ спойлерить і НЕ вигадує те, чого не буде в ролику.
- Англійська репліка героя має бути зрозуміла з контексту, а в translation — точний короткий переклад.
- Жодних «внутрішніх» жартів, гри слів, яку треба розшифровувати, абревіатур без пояснення, нових тем наприкінці.
- Перевір себе: перекажи сюжет в одному реченні. Якщо не виходить — сюжет переписати.
- Менше реплік — більше сенсу: 7–9 кадрів, 30–45 секунд. Кожна репліка або рухає сюжет, або дає емоцію/сміх. Жодних
  «прохідних» фраз і самоповторів. Краще 7 сильних реплік, ніж 12 середніх.
- Жарт має бути смішним людині, яка НЕ знає англійської: гумор — у ситуації, реакції, емоції Сілі. Гра англійських слів
  (silly/Sílі тощо) — заборонена, бо її не зрозуміють.
- Якщо суть у тому, ЯК щось звучить (скоромовка, акцент, злиті слова) — це треба почути: у spoken запиши злиту/спотворену
  вимову ('Forhereortogo?!'), speed 1.15–1.2, а оповідач або Сілі одразу проговорює, що саме він почув.
- Інтонація: delivery + розділові знаки в spoken (…, ?!, тире) — щоб репліка звучала зіграно, а не прочитано.
- Стать і вигляд героїв фону в locations[].prompt мають збігатися з текстом (бариста-жінка → «вона», speaker en_female).

## Голоси (кожен персонаж — свій голос)
- narrator — закадровий оповідач, веде історію (більшість кадрів).
- seal — репліки Сілі: 2–4 короткі живі коментарі/жарти/реакції (НЕ дублюють оповідача).
- Герої історії говорять прямою мовою своїм голосом: uk_male / uk_female / uk_old; англомовні — en_male / en_female /
  en_male_2 / en_female_2 / en_child, і їхні репліки АНГЛІЙСЬКОЮ (коротко, просто — це і є пасхалка).
  Одна роль = один персонаж у межах ролика; speaker_name — як підписати героя на екрані.
- delivery — як зіграти репліку: емоція, темп, гучність («пошепки, інтригуюче», «обурено», «сміючись»).

## Технічні правила
- 7–9 кадрів (beats), разом 30–45 секунд. Кожен кадр = одна репліка (до 14 слів).
- Перше речення — хук: найсильніший факт/інтрига. hook_overlay — ще один хук-текст у плашці (не повтор першого речення).
- narration зачитує TTS: без емодзі, без дужок, без скорочень, числа пиши словами, якщо їх важко прочитати. Англійські фрази латиницею.
- Остання репліка містить ending_question (питання до коментарів); її може сказати Сілі.
- visual_style — ЗАВЖДИ стилізована 3D-анімація під Сілі (напр. «stylized 3D animated film background, Pixar-like, warm
  cinematic lighting, rich colors»), щоб фони і Сілі виглядали з одного мультфільму. Реалістичне фото — заборонено.
- english заповнюй лише в 1–2 кадрах ОПОВІДАЧА (у репліках героїв англійська вже видна в бульбашці).
- keyword — одне найемоційніше/найважливіше слово з речення.
- shot: wide — загальний план; npc — наїзд на героя фону, коли він говорить; seal — на Сілі, коли він говорить/реагує;
  punch — різкий наїзд у шокових моментах (1–2 рази на ролик).
- locations[].prompt — англійською, конкретно (місце, деталі, світло, де стоїть персонаж фону, що він робить). Без тексту,
  логотипів, тюленів/тварин; не реальні знаменитості. Передній план з боку Сілі — порожня підлога.
- Не вигадуй факти. Використовуй лише facts з ідеї; якщо їх немає — це POV/вигадана історія, подавай саме так.
- Обов'язково заповни sources URL-ами з facts, якщо вони є.`;

export async function writeStory(s: FarmSettings, budget: Budget, idea: Idea): Promise<Story> {
  const draft = await structured({
    s,
    budget,
    what: "story",
    schema: StorySchema,
    effort: "medium",
    system: STORY_SYSTEM,
    prompt: `Напиши вірусну історію за ідеєю:\n${JSON.stringify(idea, null, 2)}`,
  });
  return humanize(s, budget, StorySchema, draft, "story");
}

export function normalizeStory(story: Story): Story {
  const mood = ["suspense", "chill", "upbeat", "funny"].find((m) => story.music_mood.toLowerCase().includes(m)) ?? "suspense";
  let englishShown = 0;
  const locations = story.locations.length ? story.locations.slice(0, 6) : [{ prompt: "cozy city street, stylized 3D", npc_side: "none" as const }];
  const beats = story.beats.slice(0, 11).map((b) => ({
    ...b,
    // The English pill belongs to narrator lines; character lines already show English in their bubble.
    english: b.speaker === "narrator" && b.english && ++englishShown <= 2 ? b.english : "",
    speed: Math.min(1.2, Math.max(0.8, b.speed || 1)),
    location: Math.min(Math.max(0, Math.round(b.location)), locations.length - 1),
  }));
  return { ...story, locations, beats, music_mood: mood, hashtags: story.hashtags.map((h) => h.replace(/^#/, "").replace(/\s+/g, "")) };
}

export type AnyScript = { kind: "story"; data: Story } | { kind: "edu"; data: Script } | { kind: "text"; data: TextPost };

/** Recognizes which script shape a stored item holds. */
export function detectScript(raw: Record<string, unknown>): AnyScript {
  if (Array.isArray(raw.beats)) return { kind: "story", data: raw as unknown as Story };
  if (Array.isArray(raw.scenes)) return { kind: "edu", data: raw as unknown as Script };
  return { kind: "text", data: raw as unknown as TextPost };
}

/** Owner asked for changes in the cabinet: rewrite the script following their note, keep the rest. */
export async function rewriteWithNote(s: FarmSettings, budget: Budget, script: AnyScript, note: string): Promise<AnyScript> {
  const system = `${script.kind === "story" ? STORY_SYSTEM : script.kind === "edu" ? SYSTEM : `Ти — SMM-автор бренду.\n\n${BRAND_BIBLE}\n\n${HUMAN_VOICE}`}

## Режим правки
Власник школи переглянув цей матеріал і залишив коментар. Виконай коментар точно і повністю. Усе, про що коментар
не каже, — збережи (структуру, вдалі репліки, службові поля), лише узгодь, якщо зміни цього вимагають.`;
  const prompt = `Коментар власника:\n«${note}»\n\nПоточна версія (JSON):\n${JSON.stringify(script.data, null, 2)}`;
  if (script.kind === "story") {
    const data = await structured({ s, budget, what: "rewrite_story", schema: StorySchema, effort: "medium", system, prompt });
    return { kind: "story", data: normalizeStory(data) };
  }
  if (script.kind === "edu") {
    const data = await structured({ s, budget, what: "rewrite_script", schema: ScriptSchema, effort: "medium", system, prompt });
    return { kind: "edu", data: normalizeScript(data) };
  }
  const data = await structured({ s, budget, what: "rewrite_text", schema: TextPostSchema, effort: "low", system, prompt });
  return { kind: "text", data };
}
