// Public level quiz on /test/ (lead magnet). Scored in the browser, so it deliberately
// uses different items from the token-gated placement test in level-test.ts.
// Shared by the site (src/content/quiz.ts re-exports it) and the Telegram bot, which sends
// the per-question breakdown: keep this file free of imports so both runtimes can load it.

export interface QuizQuestion {
  level: "A1" | "A2" | "B1" | "B2" | "C1";
  q: string;
  options: string[];
  answer: number;
  /** Grammar topic, listed for the manager in the lead comment. */
  topic: string;
  /** One-line rule the bot shows next to a wrong answer. */
  rule: string;
}

export const QUIZ: QuizQuestion[] = [
  { level: "A1", q: "___ your brother like football?", options: ["Do", "Does", "Is", "Are"], answer: 1,
    topic: "Present Simple: питання", rule: "У питаннях Present Simple з he/she/it — does: «Does your brother like…?»" },
  { level: "A1", q: "We ___ at school now.", options: ["is", "am", "are", "be"], answer: 2,
    topic: "to be", rule: "We/you/they + are: «We are at school»." },
  { level: "A1", q: "My birthday is ___ May.", options: ["on", "at", "in", "to"], answer: 2,
    topic: "Прийменники часу", rule: "Місяці, роки, пори року — in: in May, in 2027, in winter." },
  { level: "A1", q: "I have got ___ new phone.", options: ["a", "an", "the", "—"], answer: 0,
    topic: "Артиклі a/an", rule: "Один предмет уперше — a; an лише перед голосним звуком: a new phone, an old phone." },
  { level: "A2", q: "Last summer I ___ to the sea with my friends.", options: ["go", "went", "gone", "going"], answer: 1,
    topic: "Past Simple", rule: "Минула подія з маркером last summer — Past Simple: go → went." },
  { level: "A2", q: "Mount Everest is the ___ mountain in the world.", options: ["high", "higher", "highest", "most high"], answer: 2,
    topic: "Ступені порівняння", rule: "Найвищий ступінь — the + -est: high → the highest." },
  { level: "A2", q: "Shh! The baby ___.", options: ["sleeps", "is sleeping", "slept", "sleep"], answer: 1,
    topic: "Present Continuous", rule: "Дія просто зараз (Shh!) — am/is/are + -ing: is sleeping." },
  { level: "A2", q: "You ___ wear a uniform at our school. It's a rule.", options: ["must", "can", "may", "would"], answer: 0,
    topic: "Модальні: must", rule: "Правило чи обов'язок — must: «You must wear a uniform»." },
  { level: "B1", q: "Have you ever ___ sushi?", options: ["eat", "ate", "eaten", "eating"], answer: 2,
    topic: "Present Perfect", rule: "Досвід (ever/never) — have + 3-я форма: have you ever eaten." },
  { level: "B1", q: "I was playing a game when my mum ___ into the room.", options: ["comes", "came", "was coming", "has come"], answer: 1,
    topic: "Past Continuous vs Past Simple", rule: "Тривала дія (was playing) перервана короткою — Past Simple: came." },
  { level: "B1", q: "This song ___ by millions of people every day.", options: ["streams", "is streamed", "streamed", "has streamed"], answer: 1,
    topic: "Пасивний стан", rule: "Пісню слухають (не вона сама) — пасив: is + 3-я форма: is streamed." },
  { level: "B1", q: "If you ___ harder, you will pass the exam.", options: ["study", "will study", "studied", "would study"], answer: 0,
    topic: "Умовні речення, 1-й тип", rule: "If + Present Simple, will + дієслово: if you study, you will pass." },
  { level: "B2", q: "I wish I ___ more free time.", options: ["have", "had", "will have", "would have had"], answer: 1,
    topic: "I wish", rule: "Бажання про теперішнє — wish + Past Simple: I wish I had." },
  { level: "B2", q: "She ___ for two hours when the bus finally arrived.", options: ["waited", "has waited", "had been waiting", "was waited"], answer: 2,
    topic: "Past Perfect Continuous", rule: "Дія тривала до моменту в минулому — had been + -ing: had been waiting." },
  { level: "B2", q: "My parents made me ___ my room.", options: ["to clean", "cleaning", "clean", "cleaned"], answer: 2,
    topic: "make somebody do", rule: "Після make + об'єкт — дієслово без to: made me clean." },
  { level: "B2", q: "The teacher asked us ___ our phones.", options: ["to turn off", "turn off", "turning off", "that we turn off"], answer: 0,
    topic: "Непряма мова: прохання", rule: "ask somebody to do: asked us to turn off." },
  { level: "C1", q: "Not only ___ late, but he also forgot his homework.", options: ["he was", "was he", "he has been", "did he"], answer: 1,
    topic: "Інверсія", rule: "Після Not only на початку — інверсія, як у питанні: not only was he." },
  { level: "C1", q: "Had I known about the party, I ___.", options: ["would come", "would have come", "will come", "came"], answer: 1,
    topic: "Умовні речення, 3-й тип", rule: "Минуле, якого не було — would have + 3-я форма: I would have come." },
  { level: "C1", q: "The new rules will come into ___ next month.", options: ["effect", "affect", "action", "force of"], answer: 0,
    topic: "Сталі вирази", rule: "come into effect — «набувати чинності»; affect — це дієслово." },
  { level: "C1", q: "He is said ___ a fortune on his first app.", options: ["to make", "making", "to have made", "having made"], answer: 2,
    topic: "Складний підмет", rule: "He is said + to have + 3-я форма, коли дія вже в минулому: to have made." },
];

export type QuizLevel = "A1" | "A2" | "B1" | "B2" | "C1";

export function quizLevel(score: number): QuizLevel {
  if (score <= 5) return "A1";
  if (score <= 9) return "A2";
  if (score <= 13) return "B1";
  if (score <= 17) return "B2";
  return "C1";
}

export const LEVEL_INFO: Record<QuizLevel, { title: string; text: string; nmt: string }> = {
  A1: {
    title: "Початковий",
    text: "Ви знаєте базові слова й прості фрази. Головне зараз — системна граматика і перші розмови без страху помилитися.",
    nmt: "До НМТ ще далеко, але з регулярними заняттями рівень A2–B1 реально набрати за рік.",
  },
  A2: {
    title: "Базовий",
    text: "Ви розумієте прості тексти й можете розповісти про себе. Час розширювати словник і починати говорити довшими реченнями.",
    nmt: "Для впевненого НМТ потрібен B1: зазвичай це 6–9 місяців занять двічі на тиждень.",
  },
  B1: {
    title: "Середній",
    text: "Ви можете спілкуватися на знайомі теми й розумієте основне в текстах і відео. Далі — впевненість у мовленні та складніша граматика.",
    nmt: "Це рівень НМТ. Щоб отримати високий бал, варто відпрацювати формат завдань і підтягнути лексику до B1+/B2.",
  },
  B2: {
    title: "Вище середнього",
    text: "Ви вільно спілкуєтеся на більшість тем і розумієте складні тексти. Далі — точність, стиль і природне мовлення.",
    nmt: "Ви вже готові до НМТ — залишається тренувати формат і час, щоб бал був максимальним.",
  },
  C1: {
    title: "Просунутий",
    text: "Ви впевнено володієте мовою і справляєтеся зі складною граматикою. Далі — нюанси, академічне письмо, міжнародні іспити.",
    nmt: "НМТ для вас не проблема. Варто подумати про Cambridge C1 Advanced або IELTS.",
  },
};
