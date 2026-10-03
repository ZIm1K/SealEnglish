// Offline sample: renders without any API keys (`npm run demo`) and powers Remotion Studio.
import { buildRenderProps, buildStoryProps } from "../src/layout.ts";
import type { Scene, Script, Story } from "../src/schema.ts";

const base: Omit<Scene, "kind" | "voice" | "headline" | "mascot"> = {
  sub: "",
  english: "",
  wrong: "",
  right: "",
  options: [],
  answer: -1,
  reveal_voice: "",
  background: "brand",
  image_prompt: "",
};

export const DEMO_SCRIPT: Script = {
  format: "wrong_right",
  series_label: "Не кажи так!",
  cover_title: "I am agree? Ні!",
  backdrop_prompt: "",
  music_mood: "upbeat",
  scenes: [
    { ...base, kind: "hook", voice: "Дев'ять з десяти українців кажуть це неправильно.", headline: "9 з 10 кажуть це неправильно", mascot: "stand-surprised" },
    {
      ...base,
      kind: "compare",
      voice: "Не кажи I am agree. Agree — це вже дієслово. Правильно: I agree.",
      headline: "Ти згоден?",
      wrong: "I am agree",
      right: "I agree",
      mascot: "stand-wink",
    },
    {
      ...base,
      kind: "quiz",
      voice: "А як сказати: я теж так думаю?",
      headline: "«Я теж так думаю»",
      options: ["I think so too", "I am think so", "Me think too"],
      answer: 0,
      reveal_voice: "I think so too. Або коротко: same!",
      mascot: "read-happy",
    },
    { ...base, kind: "say", voice: "А ще можна сказати: fair enough — тобто, справедливо, приймаю.", headline: "Бонус-фраза", english: "Fair enough", mascot: "stand-joy" },
    {
      ...base,
      kind: "cta",
      voice: "Хочеш так само легко? Перший урок у Seal English безкоштовний.",
      headline: "Пробний урок — безкоштовно",
      sub: "@SealEnglishBot",
      mascot: "wave-happy",
    },
  ],
  caption_tiktok: "",
  caption_instagram: "",
  hashtags: [],
  threads_post: "",
  telegram_post: "",
};

export const DEMO_PROPS = buildRenderProps(
  DEMO_SCRIPT,
  DEMO_SCRIPT.scenes.map(() => ({ voice_src: null, voice_seconds: null, reveal_src: null, reveal_seconds: null, image_src: null })),
  null,
);

type B = Story["beats"][number];
const beat = (speaker: B["speaker"], narration: string, o: Partial<B> = {}): B => ({
  speaker,
  speaker_name: speaker === "seal" ? "Сілі" : speaker === "en_male" ? "Бариста" : "",
  narration,
  delivery: "",
  translation: "",
  spoken: "",
  speed: 1,
  location: 0,
  shot: speaker === "seal" ? "seal" : speaker === "narrator" ? "wide" : "npc",
  seal_visible: true,
  seal_side: "right",
  seal_pose: "stand-happy",
  keyword: "",
  english: "",
  ...o,
});

export const DEMO_STORY: Story = {
  hook_overlay: "Найстрашніше питання в кав'ярні США",
  visual_style: "stylized 3D animated film background, Pixar-like, warm morning light",
  locations: [{ prompt: "cozy New York coffee shop interior, a friendly barista behind the counter on the left", npc_side: "left" }],
  beats: [
    beat("narrator", "Сілі вперше заходить у кав'ярню в Нью-Йорку.", { seal_pose: "stand-happy", keyword: "Нью-Йорку" }),
    beat("seal", "One latte, please!", { seal_pose: "stand-joy", keyword: "latte" }),
    beat("en_male", "For here or to go?", { seal_pose: "stand-neutral", keyword: "go", translation: "Тут чи з собою?" }),
    beat("seal", "Ферхіртугоу?.. Що це взагалі було?", { seal_pose: "stand-surprised", shot: "punch", keyword: "Ферхіртугоу" }),
    beat("narrator", "А бариста просто питає: тут чи з собою.", { seal_pose: "stand-neutral", english: "For here or to go?" }),
    beat("seal", "To go, please! А ти зрозумів би з першого разу?", { seal_pose: "wave-happy", keyword: "зрозумів" }),
  ],
  ending_question: "",
  cover_title: "",
  music_mood: "funny",
  caption_tiktok: "",
  caption_instagram: "",
  hashtags: [],
  threads_post: "",
  telegram_post: "",
  sources: "",
};

export const DEMO_STORY_PROPS = buildStoryProps(DEMO_STORY, [], [], null);
