import { Check } from "lucide-react";
import { PLANS } from "@/content/site";
import { Reveal, SectionHead } from "./Reveal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Pricing() {
  return (
    <section id="pricing" className="py-24 sm:py-32">
      <div className="container-page">
        <SectionHead
          center
          eyebrow="Ціни"
          title="Прозорі пакети без прихованих платежів"
          text="Оплата пакетами уроків. Точну вартість і розклад підберемо після безкоштовного пробного уроку."
        />
        <div className="mt-16 grid gap-5 lg:grid-cols-3">
          {PLANS.map((p, i) => (
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
                <p className={cn("mt-1 text-sm", p.highlight ? "text-seal-200/80" : "text-mute")}>{p.note}</p>
                <div className="mt-7 flex items-baseline gap-2">
                  <span className="font-display text-4xl font-bold">{p.price}</span>
                </div>
                <div className={cn("text-sm", p.highlight ? "text-seal-200/80" : "text-mute")}>{p.unit}</div>
                <ul className="mt-7 grid gap-3">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-3 text-sm">
                      <Check className={cn("mt-0.5 size-4 shrink-0", p.highlight ? "text-coral-300" : "text-seal-600")} strokeWidth={3} />
                      <span className={p.highlight ? "text-white/90" : "text-ink-soft"}>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button asChild variant={p.highlight ? "primary" : "outline"} size="lg" className="mt-9 w-full">
                  <a href="#trial">{p.cta}</a>
                </Button>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
