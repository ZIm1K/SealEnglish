"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, PartyPopper, RotateCcw, Share2 } from "lucide-react";
import { Seal, type SealEmotion } from "@/components/mascot/Seal";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { callFunction } from "@/lib/supabase";
import { LEVEL_INFO, QUIZ, quizLevel } from "@/content/quiz";
import { cn } from "@/lib/utils";

type Stage = "intro" | "quiz" | "result";

export function LevelQuiz() {
  const [stage, setStage] = useState<Stage>("intro");
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<(number | undefined)[]>([]);
  const [emotion, setEmotion] = useState<SealEmotion>("happy");

  const score = QUIZ.reduce((s, q, k) => s + (answers[k] === q.answer ? 1 : 0), 0);
  const level = quizLevel(score);

  const choose = (opt: number) => {
    const next = [...answers];
    next[i] = opt;
    setAnswers(next);
    if (i < QUIZ.length - 1) window.setTimeout(() => setI(i + 1), 180);
    else {
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
          {stage === "intro" && (
            <motion.div key="intro" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
              <h2 className="font-display text-2xl font-bold text-ocean-900">Як це працює</h2>
              <ul className="mt-4 grid gap-2 text-ink-soft">
                <li>• {QUIZ.length} питань з граматики — від простих до складних (A1 → C1)</li>
                <li>• 5–7 хвилин, без реєстрації</li>
                <li>• Результат одразу: рівень за шкалою CEFR і що це означає для НМТ</li>
              </ul>
              <p className="mt-4 text-sm text-mute">Не знаєте відповіді — обирайте навмання, не підглядайте: так результат буде чесним.</p>
              <Button size="lg" className="mt-7" onClick={() => setStage("quiz")}>
                Почати тест <ArrowRight />
              </Button>
            </motion.div>
          )}

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
              <p lang="en" className="mt-8 font-display text-2xl leading-snug font-semibold text-ocean-900 sm:text-3xl">{QUIZ[i].q}</p>
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
              <p className="mt-3 text-xs text-mute">Тест перевіряє граматику. Розмовну мову, аудіювання й лексику точніше оцінить викладач на пробному уроці.</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={restart}><RotateCcw /> Пройти ще раз</Button>
                <ShareButton level={level} />
              </div>
              <TrialLead level={level} score={score} onDone={() => setEmotion("love")} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="mx-auto hidden w-56 lg:block">
        <Seal emotion={emotion} crop="bust" wave={stage !== "quiz"} idle />
      </div>
    </div>
  );
}

function ShareButton({ level }: { level: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${window.location.origin}/test/`;
    const text = `Мій рівень англійської — ${level}. А який у тебе? Безкоштовний тест за 5 хвилин:`;
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
    <Button variant="outline" size="sm" onClick={share}>
      <Share2 /> {copied ? "Посилання скопійовано" : "Поділитися з другом"}
    </Button>
  );
}

function TrialLead({ level, score, onDone }: { level: string; score: number; onDone: () => void }) {
  const [shownAt] = useState(() => Date.now());
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (name.trim().length < 2) return setError("Вкажіть ім'я");
    const digits = phone.replace(/\D/g, "").length;
    if (digits < 10 || digits > 15) return setError("Перевірте номер телефону");
    if (!consent) return setError("Потрібна ваша згода на обробку даних");
    setSending(true);
    try {
      const utm = { ...Object.fromEntries(new URLSearchParams(window.location.search)), ref: "level-quiz" };
      await callFunction("lead", {
        name,
        phone,
        age_group: "teens",
        level: `${level} · тест на сайті ${score}/${QUIZ.length}`,
        comment: "Заявка після безкоштовного тесту рівня на сайті",
        website,
        started_at: shownAt,
        utm,
      });
      setDone(true);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не вдалося надіслати заявку");
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="mt-8 rounded-3xl bg-gradient-to-br from-seal-100 to-white p-6">
        <PartyPopper className="size-8 text-coral-500" />
        <h3 className="mt-3 font-display text-xl font-bold text-ocean-900">Дякуємо! Заявку прийнято</h3>
        <p className="mt-1 text-ink-soft">Ми зв&apos;яжемося, щоб узгодити час пробного уроку. Результат тесту вже бачить викладач.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="mt-8 grid gap-4 rounded-3xl border border-seal-200 bg-seal-50/60 p-6">
      <div>
        <h3 className="font-display text-xl font-bold text-ocean-900">Безкоштовний пробний урок під ваш рівень</h3>
        <p className="mt-1 text-sm text-ink-soft">Урок у Google Meet: викладач уточнить рівень у розмові й підкаже, як рухатися далі. Без зобов&apos;язань.</p>
      </div>
      <input type="text" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden value={website} onChange={(e) => setWebsite(e.target.value)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Ім'я учня" htmlFor="q-name">
          <Input id="q-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Телефон" htmlFor="q-phone">
          <Input id="q-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+380 67 000 00 00" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </div>
      <label className="flex items-start gap-3 text-sm text-ink-soft">
        <input type="checkbox" className="mt-0.5 size-4.5 accent-seal-600" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>
          Погоджуюсь з <a href="/privacy/" className="font-semibold text-seal-700 underline-offset-2 hover:underline">політикою конфіденційності</a>. Якщо учню менше 18 — заявку залишає один із батьків.
        </span>
      </label>
      {error && <p role="alert" className="rounded-2xl bg-coral-50 px-4 py-3 text-sm font-medium text-coral-700">{error}</p>}
      <Button type="submit" size="lg" loading={sending} className="w-full sm:w-auto sm:justify-self-start">
        Записатися на пробний <ArrowRight />
      </Button>
    </form>
  );
}
