"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X, ArrowRight, LogIn } from "lucide-react";
import { Logo } from "./Logo";
import { Button } from "@/components/ui/button";
import { NAV } from "@/content/site";
import { cn } from "@/lib/utils";

export function SiteHeader({ solid = false }: { solid?: boolean }) {
  const [scrolled, setScrolled] = useState(solid);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (solid) return;
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [solid]);

  const dark = !scrolled;

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 transition-all duration-300",
        scrolled ? "border-b border-line/80 bg-white/80 backdrop-blur-xl" : "bg-transparent",
      )}
    >
      <div className="container-page flex h-[var(--header-h)] items-center justify-between gap-6">
        <Logo dark={dark} />
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Основна навігація">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className={cn(
                "rounded-full px-3.5 py-2 text-sm font-medium transition",
                dark ? "text-white/80 hover:bg-white/10 hover:text-white" : "text-ink-soft hover:bg-seal-100 hover:text-ink",
              )}
            >
              {n.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant={dark ? "glass" : "ghost"} size="sm" className="hidden sm:inline-flex">
            <Link href="/login/">
              <LogIn /> Кабінет
            </Link>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <a href="/#trial">
              Пробний урок <ArrowRight />
            </a>
          </Button>
          <button
            onClick={() => setOpen(true)}
            className={cn("flex size-10 cursor-pointer items-center justify-center rounded-xl lg:hidden", dark ? "text-white hover:bg-white/10" : "text-ink hover:bg-seal-100")}
            aria-label="Відкрити меню"
          >
            <Menu className="size-6" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ocean-950/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <motion.div
              className="absolute inset-x-3 top-3 rounded-3xl bg-white p-5 shadow-lift"
              initial={{ y: -20, opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: -10, opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            >
              <div className="flex items-center justify-between">
                <Logo />
                <button onClick={() => setOpen(false)} className="flex size-10 cursor-pointer items-center justify-center rounded-xl hover:bg-seal-100" aria-label="Закрити меню">
                  <X className="size-6" />
                </button>
              </div>
              <nav className="mt-4 grid gap-1">
                {NAV.map((n) => (
                  <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="rounded-2xl px-4 py-3 font-display text-lg font-semibold text-ink hover:bg-seal-50">
                    {n.label}
                  </a>
                ))}
              </nav>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button asChild variant="outline" size="lg">
                  <Link href="/login/">Кабінет</Link>
                </Button>
                <Button asChild size="lg">
                  <a href="/#trial" onClick={() => setOpen(false)}>Пробний урок</a>
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
