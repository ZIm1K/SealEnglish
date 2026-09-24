"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Seal } from "@/components/mascot/Seal";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form";
import { Skeleton } from "@/components/ui/misc";
import { callFunction } from "@/lib/supabase";
import { cn } from "@/lib/utils";

interface Question {
  id: string;
  level: string;
  q: string;
  options: string[];
}
interface Result {
  level: string;
  mc_score: number;
  mc_total: number;
  feedback: string;
}

/** FR-22: placement test for leads before the trial lesson (link comes after the trial request). */
function LevelTest() {
  const token = useSearchParams().get("t") ?? "";
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [writing, setWriting] = useState("");
  const [step, setStep] = useState<"quiz" | "writing">("quiz");
  const { data, isLoading, error } = useQuery({
    queryKey: ["level-test", token],
    enabled: !!token,
    retry: false,
    queryFn: () => callFunction<{ name: string; questions: Question[]; writing_task: string; done: Result | null }>("ai-level-test", { action: "questions", token }),
  });
  const submit = useMutation({
    mutationFn: () => callFunction<Result>("ai-level-test", { action: "submit", token, answers, writing }),
  });
  const result = submit.data ?? data?.done ?? null;
  const answered = Object.keys(answers).length;

  return (
    <>
      <SiteHeader solid />
      <main className="container-page max-w-3xl pt-[calc(var(--header-h)+2.5rem)] pb-24">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-mute hover:text-ink"><ArrowLeft className="size-4" /> На сайт</Link>
        <h1 className="mt-4 font-display text-3xl font-bold text-ocean-900 sm:text-4xl">Тест рівня англійської</h1>
        {!token || error ? (
          <div className="mt-6 rounded-3xl bg-coral-50 p-5 text-coral-700">
            <p className="font-semibold">{error instanceof Error ? error.message : "Посилання на тест недійсне"}</p>
            <p className="mt-1 text-sm">Якщо посилання застаріло, залиште заявку на <Link href="/#trial" className="font-semibold underline">пробний урок</Link> — і ми надішлемо нове.</p>
          </div>
        ) : isLoading || !data ? (
          <div className="mt-8 grid gap-3"><Skeleton className="h-24" /><Skeleton className="h-24" /></div>
        ) : result ? (
          <div className="mt-8 grid items-center gap-6 rounded-4xl bg-gradient-to-br from-seal-100 to-white p-8 sm:grid-cols-[1fr_10rem]">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 className="size-5" /> Готово, {data.name}!</div>
              <div className="mt-3 font-display text-5xl font-bold text-ocean-900">{result.level}</div>
              <div className="mt-1 text-sm text-mute">орієнтовний рівень · тест {result.mc_score}/{result.mc_total}</div>
              <p className="mt-4 leading-relaxed text-ink-soft">{result.feedback}</p>
              <p className="mt-4 text-sm text-mute">Результат уже бачить менеджер — на пробному уроці викладач уточнить рівень у розмові.</p>
            </div>
            <div className="mx-auto w-40"><Seal emotion="joy" crop="bust" wave /></div>
          </div>
        ) : step === "quiz" ? (
          <>
            <p className="mt-3 text-ink-soft">Привіт, {data.name}! 20 коротких питань від простих до складних. Якщо не знаєте відповіді — пропустіть, це нормально.</p>
            <ol className="mt-8 grid gap-4">
              {data.questions.map((q, i) => (
                <li key={q.id} className="card p-5">
                  <fieldset>
                    <legend className="font-medium text-ink"><span className="mr-2 text-mute">{i + 1}.</span>{q.q}</legend>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {q.options.map((o, j) => (
                        <label key={j} className={cn("flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition", answers[q.id] === j ? "border-seal-500 bg-seal-50 font-semibold" : "border-line hover:border-seal-300")}>
                          <input type="radio" name={q.id} className="accent-seal-600" checked={answers[q.id] === j} onChange={() => setAnswers((a) => ({ ...a, [q.id]: j }))} />
                          {o}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex items-center justify-between gap-3">
              <span className="text-sm text-mute">Відповіли на {answered} з {data.questions.length}</span>
              <Button size="lg" onClick={() => { setStep("writing"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Далі <ArrowRight /></Button>
            </div>
          </>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); submit.mutate(); }} className="mt-8 grid gap-5">
            <Field label="Коротке письмо" hint="англійською, 5–8 речень">
              <Textarea rows={8} value={writing} onChange={(e) => setWriting(e.target.value)} maxLength={1500} placeholder="Hi! My name is…" />
            </Field>
            <p className="-mt-2 text-sm text-ink-soft">{data.writing_task}</p>
            {submit.error && <p role="alert" className="rounded-2xl bg-coral-50 px-4 py-3 text-sm text-coral-700">{(submit.error as Error).message}</p>}
            <div className="flex flex-wrap justify-between gap-3">
              <Button type="button" variant="ghost" onClick={() => setStep("quiz")}><ArrowLeft /> Назад до питань</Button>
              <Button type="submit" size="lg" loading={submit.isPending}>{writing.trim().length < 40 ? "Завершити без письма" : "Завершити тест"}</Button>
            </div>
          </form>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

export default function LevelTestPage() {
  return (
    <Suspense>
      <LevelTest />
    </Suspense>
  );
}
