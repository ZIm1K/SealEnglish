"use client";

import { motion, type HTMLMotionProps } from "motion/react";

export function Reveal({ delay = 0, y = 28, ...props }: HTMLMotionProps<"div"> & { delay?: number; y?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: [0.2, 0.7, 0.2, 1] }}
      {...props}
    />
  );
}

export function SectionHead({
  eyebrow, title, text, center = false, dark = false,
}: {
  eyebrow: string;
  title: React.ReactNode;
  text?: React.ReactNode;
  center?: boolean;
  dark?: boolean;
}) {
  return (
    <Reveal className={center ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <span className={dark ? "inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-xs font-semibold tracking-wide text-seal-200 uppercase" : "eyebrow"}>
        {eyebrow}
      </span>
      <h2 className={`mt-5 text-3xl leading-[1.1] font-bold text-balance sm:text-5xl ${dark ? "text-white" : "text-ocean-900"}`}>{title}</h2>
      {text && <p className={`mt-5 text-lg leading-relaxed text-pretty ${dark ? "text-seal-100/75" : "text-ink-soft"}`}>{text}</p>}
    </Reveal>
  );
}
