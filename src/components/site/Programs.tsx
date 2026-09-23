"use client";

import { useState } from "react";
import { Check, ArrowUpRight } from "lucide-react";
import { Seal, type SealEmotion } from "@/components/mascot/Seal";
import { PROGRAMS } from "@/content/site";
import { Reveal, SectionHead } from "./Reveal";
import { cn } from "@/lib/utils";

const MOOD: Record<string, SealEmotion> = { teens: "wink", kids: "joy", adults: "neutral" };

export function Programs() {
  return (
    <section id="programs" className="relative py-24 sm:py-32">
      <div className="container-page">
        <SectionHead
          eyebrow="Програми"
          title={<>Під кожен вік — свій формат і свій <span className="text-gradient-ink">вайб</span></>}
          text="Основний фокус школи — підлітки: сучасні теми, живе спілкування й результат на НМТ. Для дітей і дорослих — окремі програми з власною методикою."
        />
        <div className="mt-14 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
          {PROGRAMS.filter((p) => p.featured).map((p) => (
            <ProgramCard key={p.id} p={p} big />
          ))}
          <div className="grid gap-5">
            {PROGRAMS.filter((p) => !p.featured).map((p, i) => (
              <ProgramCard key={p.id} p={p} delay={0.1 * (i + 1)} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ProgramCard({ p, big, delay = 0 }: { p: (typeof PROGRAMS)[number]; big?: boolean; delay?: number }) {
  const [hover, setHover] = useState(false);
  return (
    <Reveal delay={delay} className="h-full">
      <article
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={cn(
          "group relative flex h-full flex-col overflow-hidden rounded-4xl border border-line bg-white p-7 shadow-soft transition-all duration-500 hover:-translate-y-1 hover:shadow-lift sm:p-9",
          big && "bg-gradient-to-br from-ocean-900 via-ocean-800 to-seal-700 text-white",
        )}
      >
        {big && <div aria-hidden className="absolute -top-24 -right-24 size-80 rounded-full bg-seal-400/25 blur-3xl" />}
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-bold", big ? "bg-coral-500 text-white" : "bg-seal-100 text-seal-800")}>
              {p.ages}
            </span>
            <h3 className={cn("mt-4 font-display font-bold", big ? "text-5xl sm:text-6xl" : "text-3xl text-ocean-900")}>{p.title}</h3>
          </div>
          <div className={cn("shrink-0 transition-transform duration-500 group-hover:-rotate-3 group-hover:scale-105", big ? "w-36 sm:w-44" : "w-24")}>
            <Seal crop="head" emotion={hover ? "joy" : MOOD[p.id]} idle={hover} />
          </div>
        </div>
        <p className={cn("relative mt-5 leading-relaxed", big ? "max-w-md text-lg text-seal-100/85" : "text-ink-soft")}>{p.tagline}</p>
        <ul className={cn("relative mt-6 grid gap-3", big && "sm:grid-cols-2")}>
          {p.points.map((pt) => (
            <li key={pt} className="flex gap-3 text-sm leading-snug">
              <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", big ? "bg-white/15 text-seal-200" : "bg-seal-100 text-seal-700")}>
                <Check className="size-3.5" strokeWidth={3} />
              </span>
              <span className={big ? "text-white/90" : "text-ink-soft"}>{pt}</span>
            </li>
          ))}
        </ul>
        <div className="relative mt-auto pt-8">
          <a
            href="#trial"
            className={cn(
              "inline-flex items-center gap-1.5 text-sm font-semibold transition-colors",
              big ? "text-coral-300 hover:text-coral-200" : "text-seal-700 hover:text-seal-900",
            )}
          >
            Записатися на пробний <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
        </div>
      </article>
    </Reveal>
  );
}
