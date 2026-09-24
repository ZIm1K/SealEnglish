"use client";

import { MessagesSquare, Target, Sparkles, Gamepad2, LineChart, Headphones, BellRing } from "lucide-react";
import { motion } from "motion/react";
import { Reveal, SectionHead } from "./Reveal";
import { STEPS } from "@/content/site";
import { Seal } from "@/components/mascot/Seal";

const FEATURES = [
  {
    icon: MessagesSquare,
    title: "Speaking first",
    text: "70% уроку учні говорять. Граматика — як інструмент, а не мета: одразу застосовуємо її в розмові.",
    className: "lg:col-span-2",
    tone: "from-seal-500 to-seal-700",
  },
  {
    icon: Target,
    title: "Персональний план",
    text: "Визначаємо рівень і цілі на пробному уроці та будуємо маршрут: від A1 до впевненого B2+.",
    tone: "from-coral-400 to-coral-600",
  },
  {
    icon: Gamepad2,
    title: "Теми, що цікаві",
    text: "Ігри, серіали, музика, соцмережі, майбутня професія — вчимо мову на живому контенті.",
    tone: "from-violet-400 to-violet-600",
  },
  {
    icon: Headphones,
    title: "Міні-групи 4–6",
    text: "Однолітки одного рівня. Достатньо людей для дискусій — і достатньо уваги кожному.",
    tone: "from-emerald-400 to-emerald-600",
  },
  {
    icon: LineChart,
    title: "Практика між уроками",
    text: "ШІ-тренер Сілі дає короткі діалоги на матеріалі уроку й пам'ятає типові помилки учня, а викладач бачить підсумки. Оцінки, коментарі й домашка — в кабінеті.",
    className: "lg:col-span-2",
    tone: "from-amber-400 to-amber-600",
  },
  {
    icon: BellRing,
    title: "Нічого не пропустиш",
    text: "Telegram-бот нагадає про урок і дедлайн, а посилання на Meet — завжди під рукою.",
    tone: "from-sky-400 to-sky-600",
  },
];

export function Method() {
  return (
    <section id="method" className="relative overflow-hidden bg-white py-24 sm:py-32">
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-seal-200 to-transparent" />
      <div className="container-page">
        <SectionHead
          center
          eyebrow="Як ми вчимо"
          title={<>Методика, в якій мова <span className="text-gradient-ink">оживає</span></>}
          text="Комунікативний підхід, сучасні матеріали й технології, що прибирають рутину. Учень зосереджується на головному — говорити."
        />
        <div className="mt-16 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.06} className={f.className}>
              <div className="group relative h-full overflow-hidden rounded-4xl border border-line bg-canvas p-7 transition-all duration-500 hover:-translate-y-1 hover:bg-white hover:shadow-lift">
                <div className={`flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br ${f.tone} text-white shadow-soft transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-6`}>
                  <f.icon className="size-6" />
                </div>
                <h3 className="mt-6 font-display text-xl font-semibold text-ocean-900">{f.title}</h3>
                <p className="mt-3 leading-relaxed text-ink-soft">{f.text}</p>
                <Sparkles aria-hidden className="absolute top-6 right-6 size-5 text-seal-200 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              </div>
            </Reveal>
          ))}
        </div>

        {/* journey */}
        <div className="mt-28 grid items-center gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <Reveal className="relative mx-auto w-full max-w-sm">
            <div aria-hidden className="absolute inset-6 rounded-full bg-gradient-to-br from-seal-200 to-coral-100 blur-2xl" />
            <div className="relative">
              <Seal emotion="neutral" reading track />
            </div>
          </Reveal>
          <div>
            <SectionHead eyebrow="Шлях учня" title="Від заявки до першого «I can!» — чотири кроки" />
            <ol className="relative mt-10 grid gap-4">
              <div aria-hidden className="absolute top-3 bottom-3 left-[1.35rem] w-px bg-gradient-to-b from-seal-300 via-seal-200 to-transparent" />
              {STEPS.map((s, i) => (
                <motion.li
                  key={s.title}
                  initial={{ opacity: 0, x: 24 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.6, delay: i * 0.12 }}
                  className="relative flex gap-5 rounded-3xl p-3 transition-colors hover:bg-white"
                >
                  <span className="relative z-10 flex size-11 shrink-0 items-center justify-center rounded-2xl bg-ocean-800 font-display font-bold text-white shadow-soft">
                    {i + 1}
                  </span>
                  <div className="pt-1">
                    <h3 className="font-display text-lg font-semibold text-ocean-900">{s.title}</h3>
                    <p className="mt-1 leading-relaxed text-ink-soft">{s.text}</p>
                  </div>
                </motion.li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
