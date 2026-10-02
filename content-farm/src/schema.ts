// Shared shapes: LLM structured outputs (zod) and the render props consumed by Remotion.
// Structured outputs require every field, so "optional" text fields use "" instead of null.
import { z } from "zod";
import { MASCOT_POSES } from "./brand.ts";

export const FORMATS = ["quiz", "wrong_right", "decode", "list", "story"] as const;
export const PLATFORMS = ["tiktok", "instagram", "threads", "telegram"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const IdeaSchema = z.object({
  title: z.string().describe("Робоча назва ідеї, до 70 символів"),
  trend: z.string().describe("Який саме тренд/мем/звук/тема використано (конкретно)"),
  trend_source: z.string().describe("Звідки тренд: TikTok, Google Trends UA, YouTube, Threads, новина тощо"),
  bridge: z.string().describe("Як тренд веде до англійської: яка фраза/слово/помилка/культурний факт"),
  format: z.enum(FORMATS),
  hook: z.string().describe("Перші 1–2 секунди: текст на екрані, що зупиняє скрол"),
  english_payload: z.string().describe("Що конкретно з англійської глядач забере"),
  audience_teen: z.string().describe("Чим зачепить підлітка 12–18"),
  audience_parent: z.string().describe("Чим цінне для батьків"),
  audience_adult: z.string().describe("Чим цінне дорослому"),
  text_post_ok: z.boolean().describe("Чи підходить також для текстового поста в Threads/Telegram"),
  risk_notes: z.string().describe("Ризики для бренду/правил платформ; '' якщо немає"),
  score_virality: z.number().describe("1–10"),
  score_brand_fit: z.number().describe("1–10"),
  score_any_audience: z.number().describe("1–10: наскільки цікаво людині без інтересу до англійської"),
  freshness_days: z.number().describe("Скільки днів тренд ще буде актуальний (оцінка)"),
  facts: z
    .string()
    .describe("Для story: перевірені факти з дослідження (хто/що/де/коли/цифри) + URL джерел. Для інших форматів — ''"),
});
export type Idea = z.infer<typeof IdeaSchema>;
export const IdeasSchema = z.object({ ideas: z.array(IdeaSchema) });

export const SCENE_KINDS = ["hook", "say", "compare", "quiz", "list_item", "cta"] as const;

export const SceneSchema = z.object({
  kind: z.enum(SCENE_KINDS),
  voice: z.string().describe("Що каже диктор (укр. з англ. вставками), 1–2 речення, до 160 символів. Для quiz — лише питання"),
  headline: z.string().describe("Великий текст на екрані, до 42 символів"),
  sub: z.string().describe("Дрібний підпис під заголовком, до 60 символів, або ''"),
  english: z.string().describe("Англійська фраза для підсвітки, або ''"),
  wrong: z.string().describe("Для compare: неправильний варіант, інакше ''"),
  right: z.string().describe("Для compare: правильний варіант, інакше ''"),
  options: z.array(z.string()).describe("Для quiz: рівно 3 варіанти, інакше []"),
  answer: z.number().describe("Для quiz: індекс правильного варіанта 0–2, інакше -1"),
  reveal_voice: z.string().describe("Для quiz: що каже диктор після таймера (пояснення відповіді), інакше ''"),
  mascot: z.enum(MASCOT_POSES),
  background: z.enum(["brand", "image"]),
  image_prompt: z
    .string()
    .describe("Якщо background=image: англ. промпт для фону-ілюстрації БЕЗ тексту і БЕЗ персонажів-тварин, інакше ''"),
});
export type Scene = z.infer<typeof SceneSchema>;

export const ScriptSchema = z.object({
  format: z.enum(FORMATS),
  series_label: z.string().describe("Плашка рубрики зверху, до 28 символів, напр. «Як сказати англійською?»"),
  scenes: z.array(SceneSchema).describe("4–8 сцен; перша — hook, остання — cta"),
  cover_title: z.string().describe("Текст обкладинки, до 40 символів"),
  music_mood: z.string().describe("Настрій музики: upbeat | chill | funny | suspense"),
  caption_tiktok: z.string().describe("Підпис TikTok: 1–2 рядки + питання до коментарів"),
  caption_instagram: z.string().describe("Підпис Reels: хук, користь, CTA (бот/безкоштовний урок), до 600 символів"),
  hashtags: z.array(z.string()).describe("5–8 хештегів без #, мікс укр/англ, нішеві + широкі"),
  threads_post: z.string().describe("Окремий текстовий пост для Threads за цією ж ідеєю, до 450 символів, розмовний, із запитанням"),
  telegram_post: z.string().describe("Пост для Telegram-каналу до відео: заголовок, користь, приклад, CTA, до 700 символів, можна емодзі"),
});
export type Script = z.infer<typeof ScriptSchema>;

export const TextPostSchema = z.object({
  threads_post: z.string().describe("Текстовий пост Threads до 450 символів, з питанням/залученням"),
  telegram_post: z.string().describe("Пост Telegram до 900 символів з прикладами і м'яким CTA"),
  image_prompt: z.string().describe("Англ. промпт для квадратної ілюстрації без тексту, або '' якщо картинка не потрібна"),
});
export type TextPost = z.infer<typeof TextPostSchema>;

// ---- Render props (what Remotion receives) ----
export interface RenderWord {
  text: string;
  start: number; // seconds from scene start
  end: number;
}
export interface RenderScene extends Scene {
  /** Seconds. */
  duration: number;
  /** Seconds before the countdown/reveal for quiz scenes. */
  question_duration: number;
  voice_src: string | null;
  reveal_src: string | null;
  reveal_start: number;
  image_src: string | null;
  words: RenderWord[];
  reveal_words: RenderWord[];
}
export interface RenderProps {
  [key: string]: unknown;
  series_label: string;
  handle: string;
  scenes: RenderScene[];
  music_src: string | null;
  fps: number;
}

// ---- Viral story format: animated scene (generated location + Sílі composited in) ----
/** Voice roles; each maps to a distinct TTS voice (settings.eleven_voices / src/media/tts.ts VOICES). */
export const SPEAKERS = ["narrator", "seal", "uk_male", "uk_female", "uk_old", "en_male", "en_female", "en_male_2", "en_female_2", "en_child"] as const;
export type Speaker = (typeof SPEAKERS)[number];
export const SIDES = ["left", "center", "right"] as const;
export type Side = (typeof SIDES)[number];
/** wide — whole scene; npc — push in on the background character; seal — on Sílі; punch — fast shock zoom. */
export const SHOTS = ["wide", "npc", "seal", "punch"] as const;

export const LocationSchema = z.object({
  prompt: z
    .string()
    .describe(
      "Англ. опис ФОНУ-локації для генератора: місце, деталі, світло + другорядні персонажі (напр. 'a friendly barista behind the counter on the left'). Передній план з боку seal_side має бути ВІЛЬНИМ (там стоятиме Сілі). Без тексту, логотипів, тюленів",
    ),
  npc_side: z.enum([...SIDES, "none"]).describe("Де на фоні стоїть персонаж, що говорить (для наїзду камери), або none"),
});
export type Location = z.infer<typeof LocationSchema>;

export const BeatSchema = z.object({
  speaker: z
    .enum(SPEAKERS)
    .describe(
      "Хто говорить: narrator — закадровий оповідач; seal — Сілі; uk_male/uk_female/uk_old — українськомовні герої; en_* — англомовні герої (репліка АНГЛІЙСЬКОЮ)",
    ),
  speaker_name: z.string().describe("Підпис героя на екрані («Бариста», «Сілі»), для narrator — ''"),
  narration: z
    .string()
    .describe("Репліка, яку озвучать (до 110 символів): одне коротке речення. Для en_* — англійською, для решти — українською"),
  delivery: z.string().describe("Як зіграти репліку (емоція/темп), напр. «розгублено», «пошепки», «сміючись»; або ''"),
  spoken: z
    .string()
    .describe(
      "Як репліку РЕАЛЬНО вимовляє голос, якщо це відрізняється від тексту на екрані: злита скоромовка ('Forhereortogo?!'), розтягування ('Щ-що?..'), паузи через '…'. Інтонацію передавай розділовими знаками. '' — якщо так само, як narration",
    ),
  speed: z.number().describe("Темп голосу 0.8–1.2: 1 — звичайно, 1.2 — скоромовка, 0.85 — повільно/розгублено"),
  translation: z.string().describe("Якщо репліка англійською — короткий переклад українською для підпису; інакше ''"),
  location: z.number().describe("Індекс локації з locations (0, 1, …)"),
  shot: z.enum(SHOTS).describe("Кут камери: wide | npc (на героя фону, коли він говорить) | seal (на Сілі) | punch (шок)"),
  seal_visible: z.boolean().describe("Чи Сілі стоїть у сцені в цьому кадрі"),
  seal_side: z.enum(["left", "right"]).describe("З якого боку переднього плану стоїть Сілі"),
  seal_pose: z.enum(MASCOT_POSES).describe("Поза/емоція Сілі в цьому кадрі"),
  keyword: z.string().describe("Одне слово з narration для підсвітки в субтитрах, або ''"),
  english: z.string().describe("Англійська фраза-пасхалка для великої плашки, або '' (лише в 1–2 кадрах)"),
});
export type Beat = z.infer<typeof BeatSchema>;

export const StorySchema = z.object({
  hook_overlay: z.string().describe("Текст-хук у білій плашці на перших 2.5 с, до 45 символів (не дублює першу фразу дослівно)"),
  visual_style: z
    .string()
    .describe("Англ. єдиний стиль фонів: стилізована 3D-анімація під Сілі (напр. 'stylized 3D animated film background, Pixar-like, warm light')"),
  locations: z.array(LocationSchema).describe("1–6 локацій: діалог-сценка — 1–2; історія-факт — 4–6 різних сцен"),
  beats: z.array(BeatSchema).describe("7–9 кадрів, 30–45 секунд загалом"),
  ending_question: z.string().describe("Питання до коментарів, що звучить останнім кадром (входить в останню narration)"),
  cover_title: z.string().describe("Текст обкладинки до 40 символів — найсильніший хук"),
  music_mood: z.string().describe("Настрій музики: suspense | chill | upbeat | funny"),
  caption_tiktok: z.string().describe("Підпис TikTok: інтрига + питання до коментарів, 1–2 рядки"),
  caption_instagram: z.string().describe("Підпис Reels: хук, коротко суть, англ. пасхалка, м'який CTA підписатися, до 600 символів"),
  hashtags: z.array(z.string()).describe("5–8 хештегів без #: широкі вірусні + 1–2 про англійську"),
  threads_post: z.string().describe("Ця ж історія як текстовий пост Threads до 450 символів, з інтригою"),
  telegram_post: z.string().describe("Пост для Telegram-каналу до 700 символів: історія коротко + англ. фраза + CTA"),
  sources: z.string().describe("URL джерел фактів через кому, або '' якщо історія вигадана/POV"),
});
export type Story = z.infer<typeof StorySchema>;

export interface RenderBeat extends Beat {
  duration: number;
  voice_src: string | null;
  words: RenderWord[];
}
export interface RenderLocation extends Location {
  image_src: string | null;
  /** Detected head of the talking background character (fractions of the frame), if any. */
  npc_head: { x: number; y: number; top: number; size: number } | null;
}
export interface StoryProps {
  [key: string]: unknown;
  hook_overlay: string;
  handle: string;
  locations: RenderLocation[];
  beats: RenderBeat[];
  music_src: string | null;
  fps: number;
}
