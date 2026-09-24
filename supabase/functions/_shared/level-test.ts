// Placement test for leads (FR-22): 20 multiple-choice items A1→C1 + a short writing task assessed by AI.
export interface Question {
  id: string;
  level: "A1" | "A2" | "B1" | "B2" | "C1";
  q: string;
  options: string[];
  answer: number;
}

export const QUESTIONS: Question[] = [
  { id: "a1-1", level: "A1", q: "My sister ___ twelve years old.", options: ["am", "is", "are", "be"], answer: 1 },
  { id: "a1-2", level: "A1", q: "___ you like pizza?", options: ["Do", "Does", "Are", "Is"], answer: 0 },
  { id: "a1-3", level: "A1", q: "There ___ two cats in the garden.", options: ["is", "am", "are", "be"], answer: 2 },
  { id: "a1-4", level: "A1", q: "I usually get up ___ 7 o'clock.", options: ["in", "on", "at", "to"], answer: 2 },
  { id: "a2-1", level: "A2", q: "Yesterday we ___ to the cinema.", options: ["go", "goes", "went", "gone"], answer: 2 },
  { id: "a2-2", level: "A2", q: "This book is ___ than that one.", options: ["interesting", "more interesting", "most interesting", "interestinger"], answer: 1 },
  { id: "a2-3", level: "A2", q: "Look! It ___ outside.", options: ["rains", "is raining", "rained", "rain"], answer: 1 },
  { id: "a2-4", level: "A2", q: "I'm going ___ my grandparents next weekend.", options: ["visit", "visiting", "to visit", "visited"], answer: 2 },
  { id: "b1-1", level: "B1", q: "I ___ in Kyiv since 2020.", options: ["live", "am living", "have lived", "lived"], answer: 2 },
  { id: "b1-2", level: "B1", q: "If it rains tomorrow, we ___ at home.", options: ["stay", "will stay", "would stay", "stayed"], answer: 1 },
  { id: "b1-3", level: "B1", q: "The film ___ by millions of people last year.", options: ["watched", "was watched", "has watched", "is watching"], answer: 1 },
  { id: "b1-4", level: "B1", q: "She asked me where ___.", options: ["do I live", "I lived", "did I live", "I do live"], answer: 1 },
  { id: "b2-1", level: "B2", q: "If I ___ about the test, I would have studied.", options: ["knew", "had known", "would know", "have known"], answer: 1 },
  { id: "b2-2", level: "B2", q: "By the time we arrived, the concert ___.", options: ["already started", "has already started", "had already started", "was already starting"], answer: 2 },
  { id: "b2-3", level: "B2", q: "I'm not used to ___ up so early.", options: ["get", "getting", "got", "have got"], answer: 1 },
  { id: "b2-4", level: "B2", q: "He suggested ___ a break.", options: ["to take", "taking", "take", "that taking"], answer: 1 },
  { id: "c1-1", level: "C1", q: "___ had I left the house than it started to pour.", options: ["No sooner", "Hardly", "As soon as", "Barely"], answer: 0 },
  { id: "c1-2", level: "C1", q: "The proposal was met with widespread ___.", options: ["scepticism", "sceptic", "sceptically", "sceptical"], answer: 0 },
  { id: "c1-3", level: "C1", q: "It's high time you ___ your own decisions.", options: ["make", "made", "will make", "have made"], answer: 1 },
  { id: "c1-4", level: "C1", q: "She is widely ___ to be the best candidate.", options: ["considering", "considered", "consider", "to consider"], answer: 1 },
];

export const WRITING_TASK =
  "Write 5–8 sentences in English about yourself: your hobbies, your plans for the future and why you want to learn English.";

export const LEVELS = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type Level = (typeof LEVELS)[number];

export function mcLevel(score: number): Level {
  if (score <= 3) return "A0";
  if (score <= 7) return "A1";
  if (score <= 11) return "A2";
  if (score <= 14) return "B1";
  if (score <= 17) return "B2";
  return "C1";
}

/** Final estimate: the lower of the two when they disagree by more than one step, otherwise the average (rounded down). */
export function combineLevels(mc: Level, writing: Level | null): Level {
  if (!writing) return mc;
  const a = LEVELS.indexOf(mc);
  const b = LEVELS.indexOf(writing);
  if (Math.abs(a - b) > 1) return LEVELS[Math.min(a, b)];
  return LEVELS[Math.floor((a + b) / 2)];
}
