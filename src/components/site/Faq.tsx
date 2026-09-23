"use client";

import { Accordion } from "radix-ui";
import { Plus } from "lucide-react";
import { FAQ } from "@/content/site";
import { Reveal, SectionHead } from "./Reveal";

export function Faq() {
  return (
    <section id="faq" className="bg-white py-24 sm:py-32">
      <div className="container-page grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionHead eyebrow="Питання" title="Часті запитання" text="Не знайшли відповідь? Напишіть нам у Telegram або залиште заявку — менеджер передзвонить." />
        <Reveal>
          <Accordion.Root type="single" collapsible className="grid gap-3">
            {FAQ.map((f, i) => (
              <Accordion.Item key={i} value={`q${i}`} className="group overflow-hidden rounded-3xl border border-line bg-canvas transition-colors data-[state=open]:bg-white data-[state=open]:shadow-soft">
                <Accordion.Header>
                  <Accordion.Trigger className="flex w-full cursor-pointer items-center justify-between gap-4 px-6 py-5 text-left font-display font-semibold text-ocean-900">
                    {f.q}
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white shadow-soft transition-transform duration-300 group-data-[state=open]:rotate-45 group-data-[state=open]:bg-coral-500 group-data-[state=open]:text-white">
                      <Plus className="size-4" />
                    </span>
                  </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content className="overflow-hidden data-[state=closed]:animate-[fadeOut_.15s] data-[state=open]:animate-[fadeIn_.25s]">
                  <p className="px-6 pb-6 leading-relaxed text-ink-soft">{f.a}</p>
                </Accordion.Content>
              </Accordion.Item>
            ))}
          </Accordion.Root>
        </Reveal>
      </div>
    </section>
  );
}
