import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Mail } from "lucide-react";
import { Logo } from "@/components/site/Logo";
import { Seal } from "@/components/mascot/Seal";
import { PLANS, SITE } from "@/content/site";

const TITLE = "Seal English — online English school for teens, kids and adults";
const DESCRIPTION =
  "Seal English is an online English school from Ukraine. Live lessons with a teacher in Google Meet, mini-groups of 4–6 students of the same level, homework and schedule in a personal cabinet, Telegram reminders. The first lesson is free.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: ["Seal English", "Seal English school", "online English school", "English school Ukraine", "English lessons for teens", "English for kids online", "NMT English preparation"],
  alternates: { canonical: "/en/", languages: { uk: "/", en: "/en/", "x-default": "/" } },
  openGraph: { locale: "en_US", title: TITLE, description: DESCRIPTION, url: "/en/" },
};

const PROGRAMS = [
  { title: "Teens · 12–18", badge: "Our main focus", text: "Speaking from the first lesson, topics teens actually care about, and preparation for Ukraine's NMT exam and Cambridge B1–C1." },
  { title: "Kids · 6–11", text: "Games, songs and phonics: children pick up English naturally, step by step." },
  { title: "Adults · 18+", text: "English for work, travel and relocation, with morning and evening slots." },
];

const PLAN_NAMES: Record<string, string> = { group: "Mini-group", solo: "One-to-one", exam: "NMT preparation" };
const PLAN_FORMATS: Record<string, string> = {
  group: "4–6 students of one level · 60 min · twice a week",
  solo: "Just you and the teacher · 50 min · twice a week",
  exam: "Group of 4–8 · 60 min + a weekly practice test",
};

const STEPS = [
  ["Request", "Leave your contact on the site or write to us by email."],
  ["Free trial lesson", "In a mini-group of up to 4 or one-to-one: we meet, check your level and set goals."],
  ["Personal plan", "We match the teacher, format and group by level, age and interests."],
  ["Learning", "Lessons in Google Meet, homework and materials in your cabinet, reminders in Telegram."],
];

const FAQ = [
  { q: "Who is Seal English for?", a: "Teens 12–18 are our main focus, but we also teach kids 6–11 and adults. Ukrainian families abroad are welcome: lessons are online and run in Kyiv time, with evening slots that suit most time zones." },
  { q: "How does the free trial lesson work?", a: "A lesson in Google Meet with a teacher: a short conversation in English, a level check and an introduction to the format. Afterwards you get a recommendation on the programme, with no obligation." },
  { q: "What language are lessons taught in?", a: "In English from the very first minute, with Ukrainian support for beginners when needed. Our platform and the Telegram bot are in Ukrainian." },
  { q: "What do I need to start?", a: "A computer or tablet with a camera and headphones, and a stable internet connection. The lesson link appears in your cabinet and comes in Telegram; there is nothing to install." },
  { q: "How do I pay?", a: "Prices are in Ukrainian hryvnia (UAH). Lessons are paid monthly or as a 3-month package at a lower price per lesson." },
];

export default function EnglishHome() {
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "EducationalOrganization",
      name: SITE.name,
      alternateName: SITE.altNames,
      url: `${SITE.url}/en/`,
      logo: `${SITE.url}/icon-512.png`,
      image: `${SITE.url}/og.png`,
      description: DESCRIPTION,
      email: SITE.email,
      areaServed: "UA",
      availableLanguage: ["uk", "en"],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
    },
  ];

  return (
    <div lang="en" className="min-h-screen bg-canvas text-ink">
      <header className="relative overflow-hidden bg-gradient-to-br from-ocean-950 via-ocean-900 to-ocean-800 text-white">
        <div aria-hidden className="absolute -top-32 -right-24 size-[34rem] rounded-full bg-seal-500/25 blur-[110px]" />
        <div className="container-page relative flex items-center justify-between py-6">
          <Logo dark />
          <Link href="/" hrefLang="uk" className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white/85 transition hover:bg-white/10 hover:text-white">
            Українською
          </Link>
        </div>

        <div className="container-page relative grid items-center gap-10 pt-10 pb-20 sm:pt-16 sm:pb-28 lg:grid-cols-[1.3fr_1fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-seal-200 uppercase">
              Online English school · from Ukraine
            </span>
            <h1 className="mt-6 text-4xl leading-[1.08] font-bold text-balance sm:text-6xl">
              Speak English with confidence, <span className="text-seal-300">from the first lesson</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-seal-100/80">
              Live lessons with a real teacher in Google Meet, small groups of students of the same level and age,
              and practice with our AI tutor between classes. Taught from Ukraine, available anywhere online.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/#trial" className="inline-flex items-center gap-2 rounded-full bg-coral-500 px-6 py-3.5 font-semibold text-white shadow-lift transition hover:bg-coral-600">
                Book a free trial lesson <ArrowRight className="size-4" />
              </Link>
              <a href={`mailto:${SITE.email}`} className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 font-semibold text-white transition hover:bg-white/10">
                <Mail className="size-4" /> {SITE.email}
              </a>
            </div>
            <p className="mt-4 text-sm text-seal-100/60">The booking form is in Ukrainian; feel free to email us in English instead.</p>
          </div>
          <div className="mx-auto w-56 sm:w-72 lg:w-full lg:max-w-sm">
            <Seal emotion="happy" wave crop="bust" title="Seally, the Seal English mascot" />
          </div>
        </div>
      </header>

      <main className="container-page pb-24">
        <section className="pt-20">
          <h2 className="text-3xl font-bold text-ocean-900 sm:text-4xl">Programs for every age</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            {PROGRAMS.map((p, i) => (
              <article key={p.title} className={`rounded-4xl border p-7 shadow-soft ${i === 0 ? "border-transparent bg-gradient-to-br from-ocean-900 via-ocean-800 to-seal-700 text-white" : "border-line bg-white"}`}>
                {p.badge && <span className="mb-3 inline-block rounded-full bg-coral-500 px-3 py-1 text-xs font-semibold text-white">{p.badge}</span>}
                <h3 className={`font-display text-xl font-semibold ${i === 0 ? "text-white" : "text-ocean-900"}`}>{p.title}</h3>
                <p className={`mt-3 leading-relaxed ${i === 0 ? "text-seal-100/85" : "text-ink-soft"}`}>{p.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="pt-20">
          <h2 className="text-3xl font-bold text-ocean-900 sm:text-4xl">Simple pricing</h2>
          <p className="mt-3 text-ink-soft">Prices per lesson in Ukrainian hryvnia (UAH). The first lesson is free.</p>
          <div className="mt-8 grid gap-5 sm:grid-cols-3">
            {PLANS.map((p) => (
              <article key={p.id} className={`rounded-4xl border p-7 shadow-soft ${p.highlight ? "border-seal-400 bg-white ring-2 ring-seal-300" : "border-line bg-white"}`}>
                <h3 className="font-display text-lg font-semibold text-ocean-900">{PLAN_NAMES[p.id] ?? p.title}</h3>
                <p className="mt-1 text-sm text-mute">{PLAN_FORMATS[p.id]}</p>
                <p className="mt-5 text-4xl font-bold text-ocean-900">
                  {p.monthly} ₴<span className="text-base font-medium text-mute"> / lesson</span>
                </p>
                <p className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
                  <Check className="size-4 text-mint-500" /> {p.package} ₴ with a 3-month package
                </p>
                <p className="mt-1 flex items-center gap-2 text-sm text-ink-soft">
                  <Check className="size-4 text-mint-500" /> {p.perMonth} lessons a month
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="pt-20">
          <h2 className="text-3xl font-bold text-ocean-900 sm:text-4xl">How it works</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="rounded-4xl border border-line bg-white p-6 shadow-soft">
                <span className="flex size-9 items-center justify-center rounded-full bg-seal-100 font-display font-bold text-seal-700">{i + 1}</span>
                <h3 className="mt-4 font-display text-lg font-semibold text-ocean-900">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="max-w-3xl pt-20">
          <h2 className="text-3xl font-bold text-ocean-900 sm:text-4xl">Questions</h2>
          <div className="mt-8 grid gap-3">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-3xl border border-line bg-white p-5 shadow-soft open:ring-1 open:ring-seal-300">
                <summary className="cursor-pointer list-none font-display font-semibold text-ocean-900 marker:hidden">{f.q}</summary>
                <p className="mt-3 leading-relaxed text-ink-soft">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mt-20 overflow-hidden rounded-4xl bg-gradient-to-br from-ocean-900 via-ocean-800 to-seal-700 p-8 text-center text-white sm:p-14">
          <h2 className="text-3xl font-bold text-balance sm:text-4xl">Try the first lesson for free</h2>
          <p className="mx-auto mt-3 max-w-xl text-seal-100/80">No obligation: meet the teacher, check your level and see if the format suits you.</p>
          <Link href="/#trial" className="mt-7 inline-flex items-center gap-2 rounded-full bg-coral-500 px-7 py-3.5 font-semibold text-white transition hover:bg-coral-600">
            Book a free trial lesson <ArrowRight className="size-4" />
          </Link>
        </section>
      </main>

      <footer className="bg-ocean-950 py-8 text-xs text-seal-100/60">
        <div className="container-page flex flex-col justify-between gap-2 sm:flex-row">
          <span>© {new Date().getFullYear()} {SITE.name}. {SITE.legal.owner}</span>
          <span>{SITE.phone} · <a href={`mailto:${SITE.email}`} className="hover:text-white">{SITE.email}</a></span>
        </div>
      </footer>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </div>
  );
}
