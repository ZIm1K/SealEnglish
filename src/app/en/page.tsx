import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/site/Logo";
import { PLANS, SITE } from "@/content/site";

const TITLE = "Seal English — online English school for teens and kids";
const DESCRIPTION =
  "Seal English is an online English school from Ukraine for teens 12–18, kids and adults. Live lessons with a teacher in Google Meet, mini-groups of 4–6, homework in a personal cabinet, Telegram reminders. The first lesson is free.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  keywords: ["Seal English", "Seal English school", "online English school", "English school Ukraine", "English lessons for teens", "English for kids online", "NMT English preparation"],
  alternates: { canonical: "/en/", languages: { uk: "/", en: "/en/", "x-default": "/" } },
  openGraph: { locale: "en_US", title: TITLE, description: DESCRIPTION, url: "/en/" },
};

const PROGRAMS = [
  { title: "Teens · 12–18", text: "Speaking from the first lesson, topics teens actually care about, NMT and Cambridge (B1–C1) preparation." },
  { title: "Kids · 6–11", text: "Games, songs and phonics — children get used to English naturally, step by step." },
  { title: "Adults · 18+", text: "English for work, travel and relocation, with morning and evening slots." },
];

const PLAN_NAMES: Record<string, string> = { group: "Mini-group", solo: "One-to-one", exam: "NMT preparation" };

export default function EnglishHome() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    name: SITE.name,
    alternateName: SITE.altNames,
    url: `${SITE.url}/en/`,
    description: DESCRIPTION,
    email: SITE.email,
    areaServed: "UA",
    availableLanguage: ["uk", "en"],
  };
  return (
    <div lang="en" className="min-h-screen bg-ocean-950 text-seal-100/85">
      <header className="container-page flex items-center justify-between py-6">
        <Logo dark />
        <Link href="/" hrefLang="uk" className="text-sm font-semibold text-white/80 transition hover:text-white">Українською</Link>
      </header>

      <main className="container-page pb-24">
        <section className="max-w-3xl pt-12 sm:pt-20">
          <p className="text-sm font-semibold tracking-wide text-coral-300 uppercase">Seal English school · online</p>
          <h1 className="mt-4 text-4xl leading-tight font-bold text-white text-balance sm:text-6xl">
            Online English school for teens, kids and adults
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-pretty">
            {SITE.name} teaches English live: a real teacher in Google Meet, small groups of students of the same level and age,
            a personal cabinet with schedule and homework, and practice with the AI tutor Seely between lessons.
            Lessons are taught from Ukraine and are available anywhere online.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/#trial" className="rounded-full bg-coral-500 px-6 py-3 font-semibold text-white transition hover:bg-coral-600">
              Book a free trial lesson
            </Link>
            <a href={`mailto:${SITE.email}`} className="rounded-full border border-white/20 px-6 py-3 font-semibold text-white transition hover:bg-white/10">
              {SITE.email}
            </a>
          </div>
        </section>

        <section className="mt-20">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Programs</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {PROGRAMS.map((p) => (
              <div key={p.title} className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <h3 className="font-display text-lg font-semibold text-white">{p.title}</h3>
                <p className="mt-2 text-sm leading-relaxed">{p.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-20">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">Prices</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {PLANS.map((p) => (
              <div key={p.id} className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <h3 className="font-display text-lg font-semibold text-white">{PLAN_NAMES[p.id] ?? p.title}</h3>
                <p className="mt-3 text-3xl font-bold text-white">{p.monthly} ₴<span className="text-base font-medium text-seal-100/60"> / lesson</span></p>
                <p className="mt-1 text-sm">from {p.package} ₴ with a package · {p.perMonth} lessons a month</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-20 max-w-3xl">
          <h2 className="text-2xl font-bold text-white sm:text-3xl">How it works</h2>
          <ol className="mt-6 grid gap-3 text-base leading-relaxed">
            <li><b className="text-white">1. Request.</b> Leave your contact on the site or in our Telegram bot.</li>
            <li><b className="text-white">2. Free trial lesson.</b> In a mini-group of up to 4 or one-to-one: we meet, check the level and set goals.</li>
            <li><b className="text-white">3. Personal plan.</b> We match the teacher, format and group by level, age and interests.</li>
            <li><b className="text-white">4. Learning.</b> Lessons in Google Meet, homework and materials in the cabinet, reminders in Telegram.</li>
          </ol>
        </section>
      </main>

      <footer className="container-page border-t border-white/10 py-8 text-xs text-seal-100/50">
        © {new Date().getFullYear()} {SITE.name}. {SITE.legal.owner} · {SITE.phone}
      </footer>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </div>
  );
}
