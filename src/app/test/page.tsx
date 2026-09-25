import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { LevelQuiz } from "@/components/site/LevelQuiz";
import { SITE } from "@/content/site";

const TITLE = "Тест рівня англійської онлайн — безкоштовно, 5 хвилин";
const DESCRIPTION =
  "Безкоштовний тест рівня англійської мови від A1 до C1: 20 питань, результат одразу, без реєстрації. Дізнайтеся свій рівень і що він означає для НМТ з англійської.";

const FAQ = [
  { q: "Який рівень англійської потрібен для НМТ?", a: "Завдання НМТ з англійської орієнтовані на рівень B1. Для високого бала варто мати впевнений B1+ або B2 і знати формат завдань." },
  { q: "Наскільки точний онлайн-тест?", a: "Тест перевіряє граматику і дає орієнтовний рівень за шкалою CEFR. Розмовну мову, аудіювання та словниковий запас точніше оцінює викладач на пробному уроці." },
  { q: "Чи потрібно реєструватися?", a: "Ні. Результат видно одразу після останнього питання. Залишити контакт можна за бажанням — якщо хочете безкоштовний пробний урок." },
];

export const metadata: Metadata = {
  title: { absolute: `${TITLE} | ${SITE.name}` },
  description: DESCRIPTION,
  keywords: ["тест рівня англійської", "тест на рівень англійської онлайн", "визначити рівень англійської", "тест англійська безкоштовно", "рівень англійської для НМТ"],
  alternates: { canonical: "/test/" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/test/" },
};

export default function TestPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  return (
    <>
      <SiteHeader solid />
      <main className="container-page pt-[calc(var(--header-h)+2.5rem)] pb-24">
        <span className="eyebrow">🎯 Безкоштовно · без реєстрації</span>
        <h1 className="mt-4 max-w-3xl font-display text-3xl leading-tight font-bold text-balance text-ocean-900 sm:text-5xl">
          Тест рівня англійської за 5 хвилин
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-soft">
          20 питань від A1 до C1. Одразу побачите свій рівень і дізнаєтеся, чого не вистачає для високого бала на НМТ.
        </p>
        <div className="mt-10">
          <LevelQuiz />
        </div>

        <section className="mt-20 max-w-3xl">
          <h2 className="font-display text-2xl font-bold text-ocean-900 sm:text-3xl">Питання про тест</h2>
          <div className="mt-6 grid gap-3">
            {FAQ.map((f) => (
              <details key={f.q} className="rounded-3xl border border-line bg-white p-5 shadow-soft">
                <summary className="cursor-pointer font-display font-semibold text-ocean-900">{f.q}</summary>
                <p className="mt-3 leading-relaxed text-ink-soft">{f.a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}
