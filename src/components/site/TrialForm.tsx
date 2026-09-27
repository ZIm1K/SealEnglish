"use client";

import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, ChevronDown, Send, ShieldCheck, PartyPopper, FlaskConical } from "lucide-react";
import type { SealEmotion } from "@/components/mascot/Seal";
import { Seal3D } from "@/components/mascot/Seal3D";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented, Select, Textarea } from "@/components/ui/form";
import { callFunction, supabase } from "@/lib/supabase";
import { track } from "@/lib/analytics";
import { CONTACT_ERROR, formatContact, parseContact } from "@/lib/contact";
import { SITE } from "@/content/site";
import { BotTrialButton } from "./BotTrialButton";
import { Reveal } from "./Reveal";

const schema = z.object({
  name: z.string().trim().min(2, "Вкажіть ім'я"),
  contact: z.string().trim().refine((v) => parseContact(v) !== null, CONTACT_ERROR),
  age_group: z.enum(["kids", "teens", "adults"]),
  student_age: z.string().optional(),
  preferred_time: z.string().optional(),
  goal: z.string().optional(),
  level: z.string().optional(),
  comment: z.string().max(1000).optional(),
  website: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const GOALS = ["Розмовна англійська", "Школа / оцінки", "Підготовка до НМТ", "Міжнародний іспит (Cambridge, IELTS)", "Подорожі / переїзд", "Робота / кар'єра"];
const TIMES = ["Ранок (9–12)", "День (12–16)", "Вечір (16–21)", "Вихідні", "Будь-коли"];
const LEVELS = ["Не знаю", "Початківець (A0–A1)", "Базовий (A2)", "Середній (B1)", "Вище середнього (B2)", "Просунутий (C1+)"];

export function TrialSection() {
  const [emotion, setEmotion] = useState<SealEmotion>("happy");
  const [look, setLook] = useState<{ x: number; y: number } | null>(null);
  const [jump, setJump] = useState<number | undefined>();
  const [done, setDone] = useState<{ no?: number; test?: string | null } | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [bot, setBot] = useState<string>(SITE.telegramBot);
  const [started, setStarted] = useState(false);
  const [startedAt] = useState(() => Date.now());

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { age_group: "teens", contact: "", name: "" },
  });
  const { register, handleSubmit, formState, setValue, control } = form;
  const ageGroup = useWatch({ control, name: "age_group" });

  useEffect(() => {
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "telegram_bot_username")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value && typeof data.value === "string") setBot(data.value);
      });
  }, []);

  const onFieldFocus = () => {
    if (started) return;
    setStarted(true);
    track("lead_form_start", { form: "trial_form" });
  };

  const react = (e: SealEmotion, ms = 1400) => {
    setEmotion(e);
    window.setTimeout(() => setEmotion((cur) => (cur === e ? "happy" : cur)), ms);
  };

  const onSubmit = async (v: FormValues) => {
    setServerError(null);
    setEmotion("neutral");
    try {
      const utm = Object.fromEntries(new URLSearchParams(window.location.search));
      const { contact, ...rest } = v;
      const parsed = parseContact(contact)!;
      const res = await callFunction<{ ok: boolean; no?: number; level_test_token?: string | null }>("lead", {
        ...rest,
        ...parsed,
        student_age: v.student_age ? Number(v.student_age) : undefined,
        started_at: startedAt,
        utm,
      });
      track("generate_lead", { form: "trial_form", contact: "phone" in parsed ? "phone" : "telegram", age_group: v.age_group });
      setDone({ no: res.no, test: res.level_test_token });
      setEmotion("joy");
      setLook(null);
      setJump((j) => (j ?? 0) + 1);
      const confetti = (await import("canvas-confetti")).default;
      confetti({ particleCount: 140, spread: 80, origin: { y: 0.6 }, colors: ["#8cc1f2", "#fb7b63", "#ffffff", "#16447a", "#ffd166"] });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Не вдалося надіслати заявку";
      track("lead_form_error", { form: "trial_form", reason: message });
      setServerError(message);
      setEmotion("sad");
    }
  };

  const onInvalid = (errors: Record<string, unknown>) => {
    track("lead_form_error", { form: "trial_form", reason: Object.keys(errors).join(",") });
    react("surprised", 1600);
  };

  return (
    <section id="trial" className="relative overflow-hidden py-24 sm:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute top-20 -left-40 size-[34rem] rounded-full bg-seal-200/60 blur-[110px]" />
        <div className="absolute -right-32 bottom-0 size-[28rem] rounded-full bg-coral-100 blur-[100px]" />
      </div>
      <div className="container-page relative">
        <Reveal className="overflow-hidden rounded-[2.5rem] border border-white bg-white/70 shadow-lift backdrop-blur-xl">
          <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
            <div className="p-6 sm:p-10 lg:p-12">
              <span className="eyebrow">🎁 Безкоштовно</span>
              <h2 className="mt-5 text-3xl leading-tight font-bold text-ocean-900 sm:text-4xl">Запишіться на пробний урок</h2>
              <p className="mt-3 max-w-lg text-ink-soft">
                Урок у Google Meet у міні-групі до 4 учасників (60 хв) або індивідуально (30 хв): знайомство, визначення рівня та план навчання. Залиште ім&apos;я й контакт — решту уточнимо самі.
              </p>

              <AnimatePresence mode="wait">
                {done ? (
                  <motion.div
                    key="done"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-10 rounded-3xl bg-gradient-to-br from-seal-100 to-white p-8"
                  >
                    <PartyPopper className="size-10 text-coral-500" />
                    <h3 className="mt-4 font-display text-2xl font-bold text-ocean-900">
                      Дякуємо! Заявку {done.no ? `№${done.no} ` : ""}прийнято
                    </h3>
                    <p className="mt-2 text-ink-soft">
                      Ми вже отримали сповіщення і скоро зв&apos;яжемося, щоб узгодити час. Посилання на урок надішлемо в месенджер.
                    </p>
                    {done.test && (
                      <div className="mt-5 rounded-2xl bg-white p-4 ring-1 ring-seal-200">
                        <div className="flex items-center gap-2 font-semibold text-ocean-900"><FlaskConical className="size-5 text-violet-500" /> Поки чекаєте — пройдіть тест рівня</div>
                        <p className="mt-1 text-sm text-ink-soft">10 хвилин: 20 коротких питань і кілька речень про себе. Викладач підготує пробний урок під ваш рівень.</p>
                        <Button asChild className="mt-3" size="md">
                          <a href={`/level-test/?t=${done.test}`}>Пройти тест рівня <ArrowRight /></a>
                        </Button>
                      </div>
                    )}
                    <div className="mt-6 flex flex-wrap gap-3">
                      {bot && (
                        <Button asChild variant="ocean">
                          <a href={`https://t.me/${bot}?start=trial`} target="_blank" rel="noreferrer">
                            <Send /> Відкрити Telegram-бот
                          </a>
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        onClick={() => {
                          setDone(null);
                          form.reset({ age_group: "teens", name: "", contact: "" });
                          setEmotion("happy");
                          setLook(null);
                        }}
                      >
                        Ще одна заявка
                      </Button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.form
                    key="form"
                    exit={{ opacity: 0, y: -10 }}
                    onSubmit={(e) => handleSubmit(onSubmit, onInvalid)(e)}
                    onBlur={() => setLook(null)}
                    className="mt-8 grid gap-5"
                    noValidate
                  >
                    <input type="text" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden {...register("website")} />
                    <Field label="Для кого навчання?">
                      <Segmented
                        value={ageGroup}
                        onChange={(v) => {
                          setValue("age_group", v);
                          react(v === "kids" ? "joy" : v === "teens" ? "wink" : "neutral");
                        }}
                        options={[
                          { value: "teens", label: "Підліток 12–18" },
                          { value: "kids", label: "Дитина 6–11" },
                          { value: "adults", label: "Дорослий" },
                        ]}
                        className="flex w-full flex-wrap [&>button]:flex-1"
                      />
                    </Field>
                    <div className="grid gap-5 sm:grid-cols-2">
                      <Field label="Ім'я учня" error={formState.errors.name?.message} htmlFor="t-name">
                        <Input
                          id="t-name"
                          placeholder="Наприклад, Софія"
                          autoComplete="given-name"
                          aria-invalid={!!formState.errors.name}
                          {...register("name")}
                          onFocus={() => {
                            onFieldFocus();
                            setLook({ x: -0.9, y: -0.1 });
                          }}
                        />
                      </Field>
                      <Field label="Телефон або Telegram" error={formState.errors.contact?.message} htmlFor="t-contact">
                        <Input
                          id="t-contact"
                          type="text"
                          placeholder="+380 67 123 45 67 або @нік"
                          autoComplete="tel"
                          aria-invalid={!!formState.errors.contact}
                          {...register("contact", {
                            onChange: (e) => {
                              const f = formatContact(e.target.value);
                              setValue("contact", f);
                              if (f.replace(/\D/g, "").length === 12) react("wink", 1100);
                            },
                          })}
                          onFocus={() => {
                            onFieldFocus();
                            setLook({ x: -0.9, y: 0.25 });
                          }}
                        />
                      </Field>
                    </div>

                    <details className="group rounded-2xl border border-line bg-white/60 px-4 py-3">
                      <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-semibold text-ink-soft [&::-webkit-details-marker]:hidden">
                        Додати деталі для викладача <span className="flex items-center gap-1 font-normal text-mute">необов&apos;язково <ChevronDown className="size-4 transition group-open:rotate-180" /></span>
                      </summary>
                      <div className="mt-4 grid gap-5">
                        <div className="grid gap-5 sm:grid-cols-[7rem_1fr_1fr]">
                          <Field label="Вік" htmlFor="t-age">
                            <Input id="t-age" type="number" min={4} max={99} placeholder="14" inputMode="numeric" {...register("student_age")} />
                          </Field>
                          <Field label="Мета" htmlFor="t-goal">
                            <Select id="t-goal" {...register("goal")} defaultValue="">
                              <option value="">Оберіть</option>
                              {GOALS.map((g) => <option key={g}>{g}</option>)}
                            </Select>
                          </Field>
                          <Field label="Рівень" htmlFor="t-level">
                            <Select id="t-level" {...register("level")} defaultValue="">
                              <option value="">Оберіть</option>
                              {LEVELS.map((g) => <option key={g}>{g}</option>)}
                            </Select>
                          </Field>
                        </div>
                        <div className="grid gap-5 sm:grid-cols-[1fr_2fr]">
                          <Field label="Зручний час" htmlFor="t-time">
                            <Select id="t-time" {...register("preferred_time")} defaultValue="">
                              <option value="">Будь-коли</option>
                              {TIMES.map((g) => <option key={g}>{g}</option>)}
                            </Select>
                          </Field>
                          <Field label="Коментар" htmlFor="t-comment">
                            <Textarea id="t-comment" rows={1} placeholder="Що важливо знати викладачу?" {...register("comment")} onFocus={() => setLook({ x: -0.8, y: 0.5 })} />
                          </Field>
                        </div>
                      </div>
                    </details>

                    {serverError && <p role="alert" className="rounded-2xl bg-coral-50 px-4 py-3 text-sm font-medium text-coral-700">{serverError}</p>}

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <Button type="submit" size="xl" loading={formState.isSubmitting} className="w-full sm:w-auto">
                        Записатися безкоштовно <ArrowRight />
                      </Button>
                      <BotTrialButton placement="trial_form" bot={bot} className="w-full sm:w-auto" />
                    </div>
                    <p className="flex items-start gap-2 text-xs text-mute">
                      <ShieldCheck className="size-4 shrink-0 text-emerald-500" />
                      <span>
                        Без спаму, дані бачить лише менеджер школи. Надсилаючи заявку, ви погоджуєтесь з{" "}
                        <a href="/privacy/" className="font-semibold text-seal-700 underline-offset-2 hover:underline">політикою конфіденційності</a>.
                      </span>
                    </p>
                  </motion.form>
                )}
              </AnimatePresence>
            </div>

            <div className="relative hidden overflow-hidden bg-gradient-to-b from-seal-200 via-seal-100 to-white lg:block">
              <div aria-hidden className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-seal-300/40 to-transparent" />
              <div className="absolute inset-x-10 top-16">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={done ? "d" : serverError ? "e" : "n"}
                    initial={{ opacity: 0, y: 10, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0 }}
                    className="mx-auto w-fit rounded-2xl rounded-br-md bg-white px-4 py-2.5 font-display text-sm font-semibold text-ocean-900 shadow-lift"
                  >
                    {done ? "Yay! See you soon! 🎉" : serverError ? "Oops… try again? 🥺" : "I'll be waiting for you! 💙"}
                  </motion.div>
                </AnimatePresence>
              </div>
              <div className="absolute inset-x-8 bottom-6">
                <Seal3D emotion={emotion} look={look} track={!look} reading={formState.isSubmitting} jumpKey={jump} wave={!!done} preload />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
