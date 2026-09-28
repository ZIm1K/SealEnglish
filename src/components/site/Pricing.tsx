"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { discount, PLANS, PROMO, promoOff } from "@/content/site";
import { formatLeft, promoEndLabel, usePromo } from "@/lib/promo";
import { Reveal, SectionHead } from "./Reveal";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/form";
import { cn } from "@/lib/utils";

const uah = (n: number) => `${n.toLocaleString("uk-UA")} ₴`;

export function Pricing() {
  const [mode, setMode] = useState<"monthly" | "package">("package");
  const promo = usePromo();
  return (
    <section id="pricing" className="py-24 sm:py-32">
      <div className="container-page">
        <SectionHead
          center
          eyebrow="Ціни"
          title="Чесна ціна за урок — без прихованих платежів"
          text="Заняття двічі на тиждень. Платіть помісячно або пакетом зі знижкою. Пробний урок — безкоштовно."
        />
        <div className={cn("mt-10 flex justify-center", promo.active && "hidden")}>
          <Segmented
            value={mode}
            onChange={setMode}
            label="Спосіб оплати"
            options={[
              { value: "monthly", label: "Помісячно" },
              { value: "package", label: "Пакетом (до −10%)" },
            ]}
          />
        </div>
        {promo.active && (
          <div className="mx-auto mt-8 flex max-w-2xl flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl bg-coral-500 px-5 py-3 text-center text-sm font-semibold text-white shadow-coral">
            <span>🔥 Акція 24 години: ціна на {PROMO.term} для всіх, хто залишить заявку до {promoEndLabel}</span>
            <span className="rounded-lg bg-white/20 px-2 py-0.5 font-mono tabular-nums">{formatLeft(promo.left)}</span>
          </div>
        )}
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {PLANS.map((p, i) => {
            const regular = mode === "package" && !promo.active ? p.package : p.monthly;
            const perLesson = promo.active ? PROMO.prices[p.id] : regular;
            return (
              <Reveal key={p.id} delay={i * 0.08}>
                <div
                  className={cn(
                    "relative flex h-full flex-col rounded-4xl border p-8 transition-all duration-500 hover:-translate-y-1",
                    p.highlight
                      ? "border-transparent bg-gradient-to-b from-ocean-900 to-ocean-800 text-white shadow-lift"
                      : "border-line bg-white shadow-soft hover:shadow-lift",
                  )}
                >
                  {p.highlight && (
                    <span className="absolute -top-3 left-8 rounded-full bg-coral-500 px-3 py-1 text-xs font-bold text-white shadow-coral">
                      Найпопулярніше
                    </span>
                  )}
                  <h3 className={cn("font-display text-xl font-semibold", !p.highlight && "text-ocean-900")}>{p.title}</h3>
                  <p className={cn("mt-1 text-sm", p.highlight ? "text-seal-200/80" : "text-mute")}>{p.format}</p>
                  <div className="mt-7 flex flex-wrap items-baseline gap-x-2">
                    {promo.active && <s className={cn("text-lg", p.highlight ? "text-seal-200/60" : "text-mute")}>{uah(regular)}</s>}
                    <span className={cn("font-display text-4xl font-bold", promo.active && (p.highlight ? "text-coral-300" : "text-coral-600"))}>{uah(perLesson)}</span>
                    <span className={cn("text-sm", p.highlight ? "text-seal-200/80" : "text-mute")}>за урок</span>
                  </div>
                  <div className={cn("mt-1 text-sm", p.highlight ? "text-seal-200/80" : "text-mute")}>
                    {uah(perLesson * p.perMonth)} на місяць
                    {promo.active ? (
                      <> · {PROMO.term}, <span className={p.highlight ? "text-coral-300" : "text-coral-600"}>−{promoOff(p)}%</span></>
                    ) : mode === "package" ? (
                      <> · {p.packageLabel}, <span className={p.highlight ? "text-coral-300" : "text-coral-600"}>−{discount(p)}%</span></>
                    ) : (
                      <> · у пакеті {uah(p.package)}</>
                    )}
                  </div>
                  <ul className="mt-7 grid gap-3">
                    {p.features.map((f) => (
                      <li key={f} className="flex gap-3 text-sm">
                        <Check className={cn("mt-0.5 size-4 shrink-0", p.highlight ? "text-coral-300" : "text-seal-600")} strokeWidth={3} aria-hidden />
                        <span className={p.highlight ? "text-white/90" : "text-ink-soft"}>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-9">
                    <Button asChild variant={p.highlight ? "primary" : "outline"} size="lg" className="w-full">
                      <a href="#trial">{p.cta}</a>
                    </Button>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-mute">
          Пакетна знижка: −10% для міні-груп і НМТ, −7% для індивідуальних занять. Разових платних уроків немає. Оплата на рахунок ФОП після пробного уроку.
        </p>
      </div>
    </section>
  );
}
