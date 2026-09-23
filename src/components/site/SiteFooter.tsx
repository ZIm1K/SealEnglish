import Link from "next/link";
import { Mail, Phone, Send } from "lucide-react";
import { Logo } from "./Logo";
import { NAV, SITE } from "@/content/site";

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative overflow-hidden bg-ocean-950 pt-20 pb-10 text-seal-100/80">
      <div aria-hidden className="absolute -top-40 left-1/2 size-[40rem] -translate-x-1/2 rounded-full bg-seal-600/15 blur-[120px]" />
      <div className="container-page relative grid gap-12 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div>
          <Logo dark />
          <p className="mt-5 max-w-sm text-sm leading-relaxed">
            Онлайн-школа англійської для підлітків, дітей і дорослих. Вчимо говорити впевнено — з першого уроку.
          </p>
        </div>
        <div>
          <h3 className="font-display text-sm font-semibold text-white">Навігація</h3>
          <ul className="mt-4 grid gap-2.5 text-sm">
            {NAV.map((n) => (
              <li key={n.href}><a href={n.href} className="transition hover:text-white">{n.label}</a></li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-display text-sm font-semibold text-white">Учням</h3>
          <ul className="mt-4 grid gap-2.5 text-sm">
            <li><Link href="/login/" className="transition hover:text-white">Особистий кабінет</Link></li>
            <li><a href="/#trial" className="transition hover:text-white">Пробний урок</a></li>
            <li><Link href="/privacy/" className="transition hover:text-white">Політика конфіденційності</Link></li>
            <li><Link href="/offer/" className="transition hover:text-white">Публічна оферта</Link></li>
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
