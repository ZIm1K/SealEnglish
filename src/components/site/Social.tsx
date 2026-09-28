"use client";

import { ArrowUpRight } from "lucide-react";
import { Seal3D } from "@/components/mascot/Seal3D";
import { Reveal } from "./Reveal";
import { SOCIALS } from "./SocialIcons";

export function Social() {
  return (
    <section id="social" className="bg-white py-20 sm:py-28">
      <div className="container-page">
        <div className="relative overflow-hidden rounded-[2.5rem] bg-ocean-950 px-6 py-12 sm:px-12 sm:py-16">
          <div aria-hidden className="absolute -top-32 -right-24 size-[28rem] rounded-full bg-seal-500/25 blur-[110px]" />
          <div aria-hidden className="absolute -bottom-40 -left-24 size-[26rem] rounded-full bg-coral-500/15 blur-[110px]" />

          <div className="relative grid items-center gap-10 lg:grid-cols-[1fr_1.35fr]">
            <Reveal className="flex flex-col items-center text-center lg:items-start lg:text-left">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-seal-200 uppercase">
                Ми в соцмережах
              </span>
              <h2 className="mt-5 text-3xl leading-[1.1] font-bold text-balance text-white sm:text-5xl">
                Сілі тепер і у вашій стрічці
              </h2>
              <p className="mt-5 max-w-md text-lg leading-relaxed text-pretty text-seal-100/75">
                Корисна англійська щодня: помилки, живі фрази, підготовка до НМТ і новини школи. Підписуйтесь там, де вам зручно.
              </p>
              <div className="mt-6 w-32 sm:w-48">
                <Seal3D wave emotion="joy" hop track />
              </div>
            </Reveal>

            <div className="grid gap-4 sm:grid-cols-2">
              {SOCIALS.map((s, i) => (
                <Reveal key={s.id} delay={0.08 * i}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group grid h-full grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4 transition duration-300 hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.08] sm:grid-cols-[1fr_auto] sm:content-start sm:p-5"
                  >
                    <span className={`flex size-12 items-center justify-center rounded-2xl text-white shadow-lg ${s.tile}`}>
                      <s.Icon className="size-6" />
                    </span>
                    <div className="sm:order-3 sm:col-span-2">
                      <div className="font-display text-lg font-semibold text-white">{s.name}</div>
                      <div className="text-sm text-seal-300">{s.handle}</div>
                    </div>
                    <ArrowUpRight className="size-5 justify-self-end text-seal-100/40 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-white sm:order-2" />
                    <p className="hidden text-sm leading-relaxed text-seal-100/70 sm:order-4 sm:col-span-2 sm:block">{s.text}</p>
                    <span className="hidden w-fit items-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-ocean-900 transition group-hover:bg-seal-300 sm:order-5 sm:col-span-2 sm:inline-flex">
                      Підписатися
                    </span>
                  </a>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
