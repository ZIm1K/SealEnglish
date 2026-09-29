"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, PartyPopper, RotateCcw, Share2 } from "lucide-react";
import type { SealEmotion } from "@/components/mascot/Seal";
import { Seal3D } from "@/components/mascot/Seal3D";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { callFunction } from "@/lib/supabase";
import { track } from "@/lib/analytics";
import { markLeadSent, promoEndLabel, promoNote, usePromo } from "@/lib/promo";
import { PROMO } from "@/content/site";
import { CONTACT_ERROR, formatContact, parseContact } from "@/lib/contact";
import { BotTrialButton } from "./BotTrialButton";
import { LEVEL_INFO, QUIZ, quizLevel } from "@/content/quiz";
import { cn, plural } from "@/lib/utils";

type Stage = "quiz" | "result";

export function LevelQuiz() {
  const [stage, setStage] = useState<Stage>("quiz");
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<(number | undefined)[]>([]);
  const [emotion, setEmotion] = useState<SealEmotion>("happy");

  const score = QUIZ.reduce((s, q, k) => s + (answers[k] === q.answer ? 1 : 0), 0);
  const level = quizLevel(score);

  const choose = (opt: number) => {
    const next = [...answers];
    const firstTime = next[i] === undefined;
    next[i] = opt;
    setAnswers(next);
    if (firstTime && i === 0) track("quiz_start");
    if (firstTime && (i + 1) % 5 === 0 && i < QUIZ.length - 1) track("quiz_progress", { answered: i + 1 });
    if (i < QUIZ.length - 1) window.setTimeout(() => setI(i + 1), 180);
    else {
      const final = QUIZ.reduce((sum, q, k) => sum + (next[k] === q.answer ? 1 : 0), 0);
      track("quiz_complete", { level: quizLevel(final), score: final });
      setStage("result");
      setEmotion("joy");
    }
  };

  const restart = () => {
    setAnswers([]);
    setI(0);
    setStage("quiz");
    setEmotion("happy");
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_16rem] lg:items-start">
      <div className="rounded-4xl border border-line bg-white p-6 shadow-soft sm:p-10">
        <AnimatePresence mode="wait">
          {stage === "quiz" && (
            <motion.div key="quiz" exit={{ opacity: 0 }}>
              <div className="flex items-center justify-between text-sm font-semibold text-mute">
                <span>Питання {i + 1} з {QUIZ.length}</span>
                {i > 0 && (
                  <button type="button" onClick={() => setI(i - 1)} className="inline-flex items-center gap-1 hover:text-ink">
                    <ArrowLeft className="size-4" /> Назад
                  </button>
                )}
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-seal-100">
                <div className="h-full rounded-full bg-gradient-to-r from-seal-400 to-coral-400 transition-all" style={{ width: `${(i / QUIZ.length) * 100}%` }} />
              </div>
              {/* Keyed by question: remounts with an enter animation, never waits for an exit one. */}
              <motion.div key={i} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }}>
              {i === 0 && <p className="mt-4 text-sm text-mute">Оберіть варіант, який пасує. Не знаєте — обирайте навмання, так результат буде чесним.</p>}
              <p lang="en" className="mt-6 font-display text-2xl leading-snug font-semibold text-ocean-900 sm:text-3xl">{QUIZ[i].q}</p>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {QUIZ[i].options.map((o, k) => (
                  <button
                    key={o}
                    type="button"
                    lang="en"
                    onClick={() => choose(k)}
                    className={cn(
                      "rounded-2xl border px-5 py-4 text-left text-lg font-medium transition hover:border-seal-400 hover:bg-seal-50",
                      answers[i] === k ? "border-seal-500 bg-seal-100 text-ocean-900" : "border-line text-ink",
                    )}
                  >
                    {o}
                  </button>
                ))}
              </div>
              </motion.div>
            </motion.div>
          )}

          {stage === "result" && (
            <motion.div key="result" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <p className="text-sm font-semibold tracking-wide text-seal-700 uppercase">Ваш орієнтовний рівень</p>
              <div className="mt-2 flex items-baseline gap-3">
                <span className="font-display text-6xl font-bold text-ocean-900">{level}</span>
                <span className="text-lg font-semibold text-ink-soft">{LEVEL_INFO[level].title}</span>
              </div>
              <p className="mt-1 text-sm text-mute">Правильних відповідей: {score} з {QUIZ.length}</p>
              <p className="mt-5 leading-relaxed text-ink-soft">{LEVEL_INFO[level].text}</p>
              <p className="mt-3 rounded-2xl bg-seal-50 p-4 leading-relaxed text-ink-soft"><b className="text-ocean-900">НМТ:</b> {LEVEL_INFO[level].nmt}</p>
              <TrialLead level={level} score={score} answers={answers as number[]} onDone={() => setEmotion("love")} />
              <p className="mt-6 text-xs text-mute">Тест перевіряє граматику. Розмовну мову, аудіювання й лексику точніше оцінить викладач на пробному уроці.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="ghost" size="sm" onClick={restart}><RotateCcw /> Пройти ще раз</Button>
                <ShareButton level={level} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="mx-auto hidden w-56 lg:block">
        <Seal3D emotion={emotion} crop="bust" wave={stage !== "quiz"} idle />
      </div>
    </div>
  );
}

function ShareButton({ level }: { level: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${window.location.origin}/test/`;
    const text = `Мій рівень англійської — ${level}. А який у тебе? Безкоштовний тест за 5 хвилин:`;
    track("share", { method: "share" in navigator ? "native" : "clipboard", content_type: "level_quiz" });
    try {
      if (navigator.share) await navigator.share({ text, url });
      else {
        await navigator.clipboard.writeText(`${text} ${url}`);
        setCopied(true);
      }
    } catch {
      // share sheet closed by the user
    }
  };
  return (
    <Button variant="ghost" size="sm" onClick={share}>
      <Share2 /> {copied ? "Посилання скопійовано" : "Поділитися з другом"}
    </Button>
  );
}

function TrialLead({ level, score, answers, onDone }: { level: string; score: number; answers: number[]; onDone: () => void }) {
  const [shownAt] = useState(() => Date.now());
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(false);
  const promo = usePromo();
  const mistakes = QUIZ.length - score;

  const onFocus = () => {
    if (started) return;
    setStarted(true);
    track("lead_form_start", { form: "level_quiz" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = parseContact(contact);
    const problem = name.trim().length < 2 ? "Вкажіть ім'я" : !parsed ? CONTACT_ERROR : null;
    if (problem || !parsed) {
      track("lead_form_error", { form: "level_quiz", reason: problem ?? "" });
      return setError(problem);
    }
    setSending(true);
    try {
      const utm = { ...Object.fromEntries(new URLSearchParams(window.location.search)), ref: "level-quiz" };
      await callFunction("lead", {
        name,
        ...parsed,
        age_group: "teens",
        level: `${level} · тест на сайті ${score}/${QUIZ.length}`,
        comment: ["Заявка після безкоштовного тесту рівня на сайті", promoNote()].filter(Boolean).join("\n"),
        website,
        started_at: shownAt,
        utm,
      });
      track("generate_lead", { form: "level_quiz", contact: "phone" in parsed ? "phone" : "telegram", level });
      setDone(true);
      markLeadSent();
      onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не вдалося надіслати заявку";
      track("lead_form_error", { form: "level_quiz", reason: message });
      setError(message);
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="mt-8 rounded-3xl bg-gradient-to-br from-seal-100 to-white p-6">
        <PartyPopper className="size-8 text-coral-500" />
        <h3 className="mt-3 font-display text-xl font-bold text-ocean-900">Дякуємо! Заявку прийнято</h3>
        <p className="mt-1 text-ink-soft">Напишемо або зателефонуємо протягом дня, щоб узгодити час пробного уроку. Результат тесту вже бачить викладач.</p>
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-4 rounded-3xl border border-seal-200 bg-seal-50/60 p-6">
      <div>
        <h3 className="font-display text-xl font-bold text-ocean-900">Безкоштовний розбір і пробний урок під рівень {level}</h3>
        <p className="mt-1 text-sm text-ink-soft">Живе заняття в Google Meet: викладач перевірить рівень у розмові й покаже, що підтягнути до НМТ. Без зобов&apos;язань.</p>
        {promo.active && (
          <p className="mt-3 rounded-2xl bg-coral-500 px-4 py-2.5 text-sm font-semibold text-white">
            🔥 Запишись до {promoEndLabel} — {PROMO.term} за акційною ціною: група {PROMO.prices.group} ₴, індивідуально {PROMO.prices.solo} ₴ за урок
          </p>
        )}
      </div>

      {/* Teens from Telegram ads skip a phone form but will tap into a bot. The reason to tap is the mistake
          breakdown: the site shows only the score, the bot sends each mistake with its rule, then offers the trial. */}
      <div>
        {mistakes > 0 && (
          <p className="mb-3 text-sm text-ink-soft">
            У тебе <b className="text-ocean-900">{mistakes} {plural(mistakes, "помилка", "помилки", "помилок")}</b>. Які саме, правило до кожної і що з цього буде на НМТ — надішлемо в Telegram.
          </p>
        )}
        <BotTrialButton placement="level_quiz_primary" quizAnswers={answers} primary className="w-full">
          {mistakes > 0 ? "Отримати розбір помилок" : "Отримати план до НМТ"}
        </BotTrialButton>
        <p className="mt-2 text-center text-xs text-mute">Одразу в Telegram-боті · без реєстрації й дзвінків</p>
      </div>

      <div className="flex items-center gap-3 text-xs font-semibold tracking-wide text-mute uppercase">
        <span className="h-px flex-1 bg-seal-200" /> або залиш контакт — напишемо самі <span className="h-px flex-1 bg-seal-200" />
      </div>

      <form onSubmit={submit} noValidate className="grid gap-4">
        <input type="text" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden value={website} onChange={(e) => setWebsite(e.target.value)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ім'я" htmlFor="q-name">
            <Input id="q-name" autoComplete="given-name" value={name} onFocus={onFocus} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Телефон або Telegram-нік" htmlFor="q-contact">
            <Input id="q-contact" type="text" autoComplete="tel" placeholder="@нік або +380…" value={contact} onFocus={onFocus} onChange={(e) => setContact(formatContact(e.target.value))} />
          </Field>
        </div>
        {error && <p role="alert" className="rounded-2xl bg-coral-50 px-4 py-3 text-sm font-medium text-coral-700">{error}</p>}
        <Button type="submit" variant="outline" size="lg" loading={sending} className="w-full sm:w-auto">
          Записатися безкоштовно <ArrowRight />
        </Button>
        <p className="text-xs text-mute">
          Надсилаючи заявку, ви погоджуєтесь з <a href="/privacy/" className="font-semibold text-seal-700 underline-offset-2 hover:underline">політикою конфіденційності</a>. Можна вказати номер когось із батьків.
        </p>
      </form>
    </div>
  );
}
