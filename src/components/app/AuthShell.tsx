"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Seal, type SealEmotion } from "@/components/mascot/Seal";
import { Logo } from "@/components/site/Logo";

export function AuthShell({
  title, subtitle, children, emotion = "happy", bubble, look,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  emotion?: SealEmotion;
  bubble?: string;
  look?: { x: number; y: number } | null;
}) {
  return (
    <div className="grid min-h-[100svh] lg:grid-cols-[1fr_1.05fr]">
      <aside className="relative hidden overflow-hidden bg-ocean-950 lg:block">
        <div aria-hidden className="absolute -top-32 -left-32 size-[36rem] rounded-full bg-seal-600/30 blur-[120px]" />
        <div aria-hidden className="absolute right-0 bottom-0 size-[28rem] rounded-full bg-violet-500/20 blur-[120px]" />
        <div className="relative flex h-full flex-col p-10">
          <Logo dark />
          <div className="relative mx-auto mt-auto mb-auto w-full max-w-md">
            <AnimatePresence mode="wait">
              {bubble && (
                <motion.div
                  key={bubble}
                  initial={{ opacity: 0, y: 8, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute -top-4 right-4 z-10 rounded-2xl rounded-bl-md bg-white px-4 py-2.5 font-display text-sm font-semibold text-ocean-900 shadow-lift"
                >
                  {bubble}
                </motion.div>
              )}
            </AnimatePresence>
            <Seal emotion={emotion} look={look ?? null} track={!look} reading={emotion === "happy"} />
          </div>
          <p className="max-w-sm text-sm text-seal-100/60">
            Кабінет Seal English: розклад, уроки в Google Meet, домашні завдання, матеріали та заявки — в одному місці.
          </p>
        </div>
      </aside>
      <main className="relative flex flex-col px-5 py-8 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-medium text-mute transition hover:text-ink">
            <ArrowLeft className="size-4" /> На сайт
          </Link>
          <div className="lg:hidden">
            <Logo />
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <div className="mx-auto mb-6 w-28 lg:hidden">
            <Seal crop="head" emotion={emotion} track />
          </div>
          <h1 className="font-display text-3xl font-bold text-ocean-900">{title}</h1>
          {subtitle && <p className="mt-2 text-ink-soft">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
