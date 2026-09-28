import Link from "next/link";
import { Mail, Phone, Send } from "lucide-react";
import { Logo } from "./Logo";
import { NAV, SITE } from "@/content/site";

function InstagramIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TikTokIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M16.6 5.82a4.28 4.28 0 0 1-3.02-3.7h-3.16v13.2a2.6 2.6 0 1 1-1.84-2.49V9.6a5.86 5.86 0 1 0 5 5.8V9.75a7.4 7.4 0 0 0 4.32 1.38V8a4.28 4.28 0 0 1-1.3-.18v-2Z" />
    </svg>
  );
}

function ThreadsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <path d="M12 22c-4.4 0-7.6-2.9-7.6-8.3v-1.4C4.4 6.8 7.6 4 12 4c3.3 0 5.9 1.6 6.9 4.3l-1.9.6C16.3 6.9 14.5 5.9 12 5.9c-3.3 0-5.6 2-5.6 6.4v1.4c0 4.4 2.3 6.4 5.6 6.4 2.6 0 4.3-1.1 4.3-2.9 0-1.5-1.1-2.3-3-2.6-.2 1.7-1.4 2.8-3.2 2.8-1.7 0-2.9-1-2.9-2.5 0-1.6 1.4-2.6 3.6-2.6.6 0 1.1 0 1.6.1 0-1.3-.8-2-2.1-2-1 0-1.8.4-2.3 1.2l-1.6-1.1c.8-1.3 2.3-2.1 4-2.1 2.5 0 4 1.5 4 3.9v.5c2.3.5 3.7 1.9 3.7 4 0 2.8-2.3 4.6-6.1 4.6Zm-.4-6.8c-1.1 0-1.7.4-1.7.9 0 .6.6.9 1.3.9.9 0 1.5-.5 1.6-1.6-.4-.1-.8-.2-1.2-.2Z" />
    </svg>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative overflow-hidden bg-ocean-950 pt-20 pb-10 text-seal-100/80">
      <div aria-hidden className="absolute -top-40 left-1/2 size-[40rem] -translate-x-1/2 rounded-full bg-seal-600/15 blur-[120px]" />
      <div className="container-page relative grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div>
          <Logo dark />
          <p className="mt-5 max-w-sm text-sm leading-relaxed">
            Seal English (Сіл Інгліш) — онлайн-школа англійської мови для підлітків, дітей і дорослих. Вчимо говорити впевнено — з першого уроку.
          </p>
          <div className="mt-5 flex items-center gap-3">
            <a href={SITE.social.telegram} target="_blank" rel="noopener noreferrer" aria-label="Telegram" className="flex size-9 items-center justify-center rounded-full bg-white/5 text-seal-100/80 transition hover:bg-white/10 hover:text-white">
              <Send className="size-4" />
            </a>
            <a href={SITE.social.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="flex size-9 items-center justify-center rounded-full bg-white/5 text-seal-100/80 transition hover:bg-white/10 hover:text-white">
              <InstagramIcon className="size-4" />
            </a>
            <a href={SITE.social.threads} target="_blank" rel="noopener noreferrer" aria-label="Threads" className="flex size-9 items-center justify-center rounded-full bg-white/5 text-seal-100/80 transition hover:bg-white/10 hover:text-white">
              <ThreadsIcon className="size-4" />
            </a>
            <a href={SITE.social.tiktok} target="_blank" rel="noopener noreferrer" aria-label="TikTok" className="flex size-9 items-center justify-center rounded-full bg-white/5 text-seal-100/80 transition hover:bg-white/10 hover:text-white">
              <TikTokIcon className="size-4" />
            </a>
          </div>
        </div>
        <div>
          <h3 className="font-display text-sm font-semibold text-white">Навігація</h3>
          <ul className="mt-4 grid gap-2.5 text-sm">
            {NAV.map((n) => (
              <li key={n.href}><Link href={n.href} className="transition hover:text-white">{n.label}</Link></li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-display text-sm font-semibold text-white">Учням</h3>
          <ul className="mt-4 grid gap-2.5 text-sm">
            <li><Link href="/login/" className="transition hover:text-white">Особистий кабінет</Link></li>
            <li><Link href="/#trial" className="transition hover:text-white">Пробний урок</Link></li>
            <li><Link href="/privacy/" className="transition hover:text-white">Політика конфіденційності</Link></li>
            <li><Link href="/offer/" className="transition hover:text-white">Публічна оферта</Link></li>
            <li><Link href="/en/" hrefLang="en" className="transition hover:text-white">English version</Link></li>
          </ul>
        </div>
        <div>
          <h3 className="font-display text-sm font-semibold text-white">Контакти</h3>
          <ul className="mt-4 grid gap-3 text-sm">
            <li><a href={`mailto:${SITE.email}`} className="flex items-center gap-2.5 transition hover:text-white"><Mail className="size-4 text-seal-300" />{SITE.email}</a></li>
            <li><a href={`tel:${SITE.phone.replace(/\s/g, "")}`} className="flex items-center gap-2.5 transition hover:text-white"><Phone className="size-4 text-seal-300" />{SITE.phone}</a></li>
            {SITE.telegramBot && (
              <li><a href={`https://t.me/${SITE.telegramBot}`} className="flex items-center gap-2.5 transition hover:text-white"><Send className="size-4 text-seal-300" />@{SITE.telegramBot}</a></li>
            )}
          </ul>
        </div>
      </div>
      <div className="container-page relative mt-16 flex flex-col justify-between gap-3 border-t border-white/10 pt-8 text-xs text-seal-100/50 sm:flex-row">
        <span>© {year} {SITE.name}. {SITE.legal.owner}</span>
        <span>Зроблено з 💙 і трохи тюленячої магії</span>
      </div>
    </footer>
  );
}
