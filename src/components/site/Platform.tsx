"use client";

import { motion } from "motion/react";
import { CalendarDays, CheckCircle2, FileText, Video, Bell, BookOpen, Send } from "lucide-react";
import { Reveal, SectionHead } from "./Reveal";
import { SealMark } from "@/components/mascot/SealMark";

export function Platform() {
  return (
    <section id="platform" className="relative overflow-hidden bg-ocean-950 py-24 text-white sm:py-32">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute top-0 left-1/4 size-[36rem] rounded-full bg-seal-600/20 blur-[130px]" />
        <div className="absolute right-0 bottom-0 size-[30rem] rounded-full bg-violet-500/15 blur-[120px]" />
      </div>
      <div className="container-page relative">
        <SectionHead
          dark
          eyebrow="Платформа"
          title={<>Усе навчання — <span className="text-gradient">в одному місці</span></>}
          text="Особистий кабінет для учнів і викладачів: розклад з кнопкою «Приєднатися», домашні завдання з перевіркою, матеріали уроків і практика з ШІ-тренером. А Telegram-бот нагадає про все вчасно."
        />

        <div className="mt-16 grid items-start gap-6 lg:grid-cols-[1.45fr_1fr]">
          {/* cabinet mock */}
          <Reveal className="glass-dark overflow-hidden rounded-4xl p-2 shadow-glow">
            <div className="rounded-[1.6rem] bg-canvas text-ink">
              <div className="flex items-center gap-2 border-b border-line px-5 py-3">
                <span className="size-3 rounded-full bg-coral-400" />
                <span className="size-3 rounded-full bg-amber-300" />
                <span className="size-3 rounded-full bg-emerald-400" />
                <span className="ml-3 rounded-lg bg-white px-3 py-1 text-xs text-mute shadow-soft">sealenglish · кабінет учня</span>
              </div>
              <div className="grid gap-4 p-5 sm:grid-cols-[1.2fr_1fr]">
                <div className="rounded-3xl bg-gradient-to-br from-ocean-800 to-seal-600 p-5 text-white">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">Наступний урок · через 25 хв</span>
                    <Video className="size-5 text-seal-200" />
                  </div>
                  <div className="mt-4 font-display text-xl font-semibold">Teens B1 · Speaking</div>
                  <div className="mt-1 text-sm text-seal-100/80">Тема: Social media & you</div>
                  <motion.div
                    className="mt-5 inline-flex items-center gap-2 rounded-xl bg-coral-500 px-4 py-2 text-sm font-semibold shadow-coral"
                    animate={{ scale: [1, 1.04, 1] }}
                    transition={{ duration: 1.8, repeat: Infinity }}
                  >
                    <Video className="size-4" /> Приєднатися до Meet
                  </motion.div>
                </div>
                <div className="rounded-3xl bg-white p-4 shadow-soft">
                  <div className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4 text-seal-600" /> Цей тиждень</div>
                  <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] text-mute">
                    {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"].map((d, i) => (
                      <div key={d}>
                        {d}
                        <div className={`mt-1 h-10 rounded-lg ${[0, 2].includes(i) ? "bg-seal-500" : i === 4 ? "bg-coral-400" : "bg-seal-50"}`} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-3xl bg-white p-4 shadow-soft sm:col-span-2">
                  <div className="flex items-center justify-between text-sm font-semibold">
                    <span className="flex items-center gap-2"><BookOpen className="size-4 text-seal-600" /> Домашні завдання</span>
                    <span className="text-xs text-mute">3 активні</span>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {[
                      { t: "Essay: My dream job", s: "Здати до пт, 20:00", c: "bg-amber-50 text-amber-700", l: "Активне" },
                      { t: "Vocabulary quiz · Unit 4", s: "Оцінка 11/12", c: "bg-emerald-50 text-emerald-700", l: "Перевірено" },
                      { t: "Listening: podcast notes", s: "Коментар від викладача", c: "bg-seal-100 text-seal-800", l: "На перевірці" },
                    ].map((h) => (
                      <div key={h.t} className="flex items-center justify-between gap-3 rounded-2xl border border-line px-3 py-2.5">
                        <div className="flex min-w-0 items-center gap-3">
                          <FileText className="size-4 shrink-0 text-seal-500" />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{h.t}</div>
                            <div className="text-xs text-mute">{h.s}</div>
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${h.c}`}>{h.l}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Reveal>

          {/* telegram mock */}
          <Reveal delay={0.15} className="grid gap-6">
            <div className="glass-dark rounded-4xl p-5 shadow-glow">
              <div className="flex items-center gap-3 border-b border-white/10 pb-4">
                <span className="flex size-11 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-ocean-900 via-ocean-800 to-seal-700 ring-1 ring-white/15">
                  <SealMark className="mt-2 w-12" />
                </span>
                <div>
                  <div className="font-semibold">Seal English Bot</div>
                  <div className="text-xs text-seal-200/60">бот · онлайн</div>
                </div>
                <Send className="ml-auto size-5 text-seal-300" />
              </div>
              <div className="mt-4 grid gap-3 text-sm">
                {[
                  { icon: Bell, t: "Скоро урок · 18:00", b: "Teens B1 через 60 хв", btn: "🎥 Приєднатися до уроку" },
                  { icon: BookOpen, t: "Нове домашнє завдання", b: "Essay: My dream job · до пт" },
                  { icon: CheckCircle2, t: "Роботу перевірено ⭐️", b: "Vocabulary quiz · 11/12" },
                ].map((m, i) => (
                  <motion.div
                    key={m.t}
                    initial={{ opacity: 0, y: 12, scale: 0.97 }}
                    whileInView={{ opacity: 1, y: 0, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.3 + i * 0.25, type: "spring", stiffness: 260, damping: 22 }}
                    className="max-w-[92%] rounded-2xl rounded-tl-md bg-white/10 p-3"
                  >
                    <div className="flex items-center gap-2 font-semibold"><m.icon className="size-4 text-seal-300" /> {m.t}</div>
                    <div className="mt-0.5 text-seal-100/70">{m.b}</div>
                    {m.btn && <div className="mt-2 rounded-xl bg-white/10 py-2 text-center text-xs font-semibold">{m.btn}</div>}
                  </motion.div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { k: "Google Meet", v: "посилання створюється автоматично" },
                { k: "Сілі 🦭", v: "ШІ-тренер для практики між уроками" },
              ].map((s) => (
                <div key={s.k} className="glass-dark rounded-3xl p-5">
                  <div className="font-display text-xl font-bold text-seal-200">{s.k}</div>
                  <div className="mt-1 text-sm text-seal-100/70">{s.v}</div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
