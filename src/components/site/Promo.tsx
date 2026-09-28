"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Flame, PartyPopper, X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { Seal3D } from "@/components/mascot/Seal3D";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { callFunction } from "@/lib/supabase";
import { track } from "@/lib/analytics";
import { CONTACT_ERROR, formatContact, parseContact } from "@/lib/contact";
import { formatLeft, LEAD_EVENT, leadSent, markLeadSent, promoEndLabel, promoMaxOff, promoNote, usePromo } from "@/lib/promo";
import { PLANS, PROMO } from "@/content/site";
import { BotTrialButton } from "./BotTrialButton";

const SEEN_KEY = "promo_popup_seen";
const BAR_KEY = "promo_bar_closed";

const storage = {
  get: (s: Storage, k: string) => {
    try {
      return s.getItem(k);
    } catch {
      return null;
    }
  },
  set: (s: Storage, k: string, v: string) => {
    try {
      s.setItem(k, v);
    } catch {
      // private mode: the popup may show again, nothing else breaks
    }
  },
};

/**
 * 24-hour promo: a floating bar with a countdown and a popup with a one-step request form.
 * The popup opens by itself once per visitor: after `autoOpenAfter` seconds, or when the cursor leaves for the tab bar.
 * Pass `autoOpenAfter={null}` where a timer would interrupt (the level quiz): only exit intent opens it there.
 */
export function Promo({ autoOpenAfter = 12 }: { autoOpenAfter?: number | null }) {
  const { active, left } = usePromo();
  const [open, setOpen] = useState(false);
  // read on the client only: nothing promo-related renders before mount (usePromo starts inactive)
  const [barClosed, setBarClosed] = useState(() => typeof window === "undefined" || storage.get(sessionStorage, BAR_KEY) === "1");
  const [signedUp, setSignedUp] = useState(() => typeof window !== "undefined" && leadSent());
  const opened = useRef(false);

  useEffect(() => {
    const onLead = () => setSignedUp(true);
    window.addEventListener(LEAD_EVENT, onLead);
    return () => window.removeEventListener(LEAD_EVENT, onLead);
  }, []);

  const show = (placement: string) => {
    opened.current = true;
    storage.set(localStorage, SEEN_KEY, "1");
    setOpen(true);
    track("promo_open", { placement });
  };

  useEffect(() => {
    if (!active || signedUp || opened.current || storage.get(localStorage, SEEN_KEY)) return;
    // never pop over someone who is typing into a form or has just signed up there
    const busy = () => opened.current || leadSent() || !!document.activeElement?.closest("form");
    const timer = autoOpenAfter === null ? undefined : window.setTimeout(() => !busy() && show("timer"), autoOpenAfter * 1000);
    const onLeave = (e: MouseEvent) => {
      if (e.clientY <= 0 && !e.relatedTarget && !busy()) show("exit_intent");
    };
    document.addEventListener("mouseout", onLeave);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mouseout", onLeave);
    };
  }, [active, signedUp, autoOpenAfter]);

  if (!active) return null;
  const solo = PLANS.find((p) => p.id === "solo")!;

  return (
    <>
      <AnimatePresence>
        {!barClosed && !open && !signedUp && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ delay: 1.2, type: "spring", stiffness: 260, damping: 26 }}
            className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-2xl"
          >
            <div className="flex items-center gap-3 rounded-2xl bg-ocean-950/95 p-2 pl-4 text-white shadow-lift ring-1 ring-white/10 backdrop-blur">
              <Flame className="size-5 shrink-0 text-coral-400" aria-hidden />
              <button type="button" onClick={() => show("bar")} className="min-w-0 flex-1 cursor-pointer text-left">
                <span className="block truncate text-sm font-semibold">
                  −{promoMaxOff}% на навчання · індивідуально {PROMO.prices.solo} ₴ <s className="font-normal text-seal-100/50">{solo.monthly} ₴</s>
                </span>
                <span className="block text-xs text-seal-100/70">
                  Залишилось <span className="font-mono font-semibold text-coral-300 tabular-nums">{formatLeft(left)}</span>
                </span>
              </button>
              <Button size="sm" onClick={() => show("bar")} className="shrink-0">
                Забрати
              </Button>
              <button
                type="button"
                aria-label="Сховати"
                onClick={() => {
                  setBarClosed(true);
                  storage.set(sessionStorage, BAR_KEY, "1");
                }}
                className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-xl text-seal-100/60 transition hover:bg-white/10 hover:text-white"
              >
                <X className="size-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <D.Root open={open} onOpenChange={setOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-50 bg-ocean-950/50 backdrop-blur-sm data-[state=open]:animate-[fadeIn_.2s]" />
          <D.Content className="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[94dvh] w-full max-w-lg overflow-y-auto rounded-t-[2rem] bg-white shadow-lift outline-none data-[state=open]:animate-[dialogIn_.3s_cubic-bezier(.2,.9,.3,1.2)] sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:rounded-[2rem]">
            <div className="relative overflow-hidden bg-gradient-to-br from-ocean-950 via-ocean-900 to-seal-700 px-6 pt-6 pb-5 text-white">
              <div aria-hidden className="absolute -top-16 -right-10 size-56 rounded-full bg-coral-500/30 blur-3xl" />
              <div className="relative flex items-end gap-3">
                <div className="min-w-0 flex-1 pb-1">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-coral-500 px-3 py-1 text-xs font-bold">
                    <Flame className="size-3.5" /> Тільки 24 години
                  </span>
                  <D.Title className="mt-3 font-display text-2xl leading-tight font-bold sm:text-3xl">
                    −{promoMaxOff}% на {PROMO.term}
                  </D.Title>
                  <D.Description className="mt-2 text-sm text-seal-100/80">
                    Залиш заявку до {promoEndLabel} — ціна зафіксується, навіть якщо почнеш пізніше. Пробний урок безкоштовний.
                  </D.Description>
                </div>
                <div className="-mb-5 w-28 shrink-0 sm:w-32">
                  <Seal3D wave emotion="joy" crop="bust" />
                </div>
              </div>
              <div className="relative mt-4 flex items-center gap-2 text-sm text-seal-100/80">
                До кінця акції
                <span className="rounded-lg bg-white/10 px-2 py-0.5 font-mono text-base font-bold text-white tabular-nums">{formatLeft(left)}</span>
              </div>
            </div>

            <div className="px-6 pt-5 pb-6">
              <ul className="grid gap-2">
                {PLANS.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 rounded-2xl bg-seal-50 px-4 py-2.5">
                    <span className="text-sm font-semibold text-ocean-900">{p.title}</span>
                    <span className="flex items-baseline gap-2 whitespace-nowrap">
                      <s className="text-sm text-mute">{p.monthly} ₴</s>
                      <span className="font-display text-lg font-bold text-coral-600">{PROMO.prices[p.id]} ₴</span>
                      <span className="text-xs text-mute">/урок</span>
                    </span>
                  </li>
                ))}
              </ul>
              <PromoForm />
            </div>

            <D.Close className="absolute top-4 right-4 flex size-9 cursor-pointer items-center justify-center rounded-xl bg-white/10 text-white transition hover:bg-white/20">
              <X className="size-5" />
              <span className="sr-only">Закрити</span>
            </D.Close>
          </D.Content>
        </D.Portal>
      </D.Root>
    </>
  );
}

function PromoForm() {
  const [shownAt] = useState(() => Date.now());
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [started, setStarted] = useState(false);

  const onFocus = () => {
    if (started) return;
    setStarted(true);
    track("lead_form_start", { form: "promo_popup" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = parseContact(contact);
    const problem = name.trim().length < 2 ? "Вкажіть ім'я" : !parsed ? CONTACT_ERROR : null;
    if (problem || !parsed) {
      track("lead_form_error", { form: "promo_popup", reason: problem ?? "" });
      return setError(problem);
    }
    setSending(true);
    try {
      const utm = { ...Object.fromEntries(new URLSearchParams(window.location.search)), ref: "promo-popup" };
      await callFunction("lead", { name, ...parsed, age_group: "teens", comment: promoNote(), website, started_at: shownAt, utm });
      track("generate_lead", { form: "promo_popup", contact: "phone" in parsed ? "phone" : "telegram" });
      setDone(true);
      markLeadSent();
      const confetti = (await import("canvas-confetti")).default;
      confetti({ particleCount: 120, spread: 75, origin: { y: 0.7 }, zIndex: 60, colors: ["#8cc1f2", "#fb7b63", "#ffffff", "#16447a", "#ffd166"] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не вдалося надіслати заявку";
      track("lead_form_error", { form: "promo_popup", reason: message });
      setError(message);
    } finally {
      setSending(false);
    }
  };

  if (done) {
    return (
      <div className="mt-5 rounded-3xl bg-gradient-to-br from-seal-100 to-white p-5">
        <PartyPopper className="size-8 text-coral-500" />
        <h3 className="mt-3 font-display text-xl font-bold text-ocean-900">Ціну зафіксовано!</h3>
        <p className="mt-1 text-sm text-ink-soft">Напишемо або зателефонуємо протягом дня, щоб узгодити безкоштовний пробний урок.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="mt-5 grid gap-3">
      <input type="text" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden value={website} onChange={(e) => setWebsite(e.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ім'я" htmlFor="p-name">
          <Input id="p-name" autoComplete="given-name" value={name} onFocus={onFocus} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Телефон або Telegram" htmlFor="p-contact">
          <Input id="p-contact" type="text" autoComplete="tel" placeholder="+380… або @нік" value={contact} onFocus={onFocus} onChange={(e) => setContact(formatContact(e.target.value))} />
        </Field>
      </div>
      {error && <p role="alert" className="rounded-2xl bg-coral-50 px-4 py-3 text-sm font-medium text-coral-700">{error}</p>}
      <Button type="submit" size="lg" loading={sending} className="w-full">
        Зафіксувати ціну <ArrowRight />
      </Button>
      <BotTrialButton placement="promo_popup" className="w-full" />
      <p className="text-center text-xs text-mute">
        Без передоплати. Можна вказати номер когось із батьків. <a href="/privacy/" className="underline-offset-2 hover:underline">Конфіденційність</a>
      </p>
    </form>
  );
}
