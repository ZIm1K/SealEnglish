"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { ArrowRight, Gift, Sparkles, Users, Video } from "lucide-react";
import { Seal, type SealEmotion } from "@/components/mascot/Seal";
import { Button } from "@/components/ui/button";

const PHRASES = [
  "Hi! I'm Seally 👋",
  "Ready to speak English?",
  "Let's make it fun!",
  "First lesson is free 🎁",
];
const CLICK_REPLIES: { text: string; emotion: SealEmotion }[] = [
  { text: "Hehe, that tickles! 😄", emotion: "joy" },
  { text: "Whoa! 😮", emotion: "surprised" },
  { text: "You're awesome! 💙", emotion: "love" },
  { text: "Let's learn together! 😉", emotion: "wink" },
];

export function Hero() {
  const [phrase, setPhrase] = useState(0);
  const [reply, setReply] = useState<string | null>(null);
  const [emotion, setEmotion] = useState<SealEmotion>("happy");
  const [wave, setWave] = useState(true);
  const [jump, setJump] = useState<number | undefined>(undefined);

  // parallax for floating chips
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 50, damping: 15 });
  const sy = useSpring(my, { stiffness: 50, damping: 15 });
  const px1 = useTransform(sx, (v) => v * 18);
  const py1 = useTransform(sy, (v) => v * 14);
  const px2 = useTransform(sx, (v) => v * -24);
  const py2 = useTransform(sy, (v) => v * -18);

  useEffect(() => {
    const t = setInterval(() => setPhrase((p) => (p + 1) % PHRASES.length), 3400);
    const w = setTimeout(() => setWave(false), 5200);
    return () => {
      clearInterval(t);
      clearTimeout(w);
    };
  }, []);

  const onPoke = () => {
    const r = CLICK_REPLIES[Math.floor(Math.random() * CLICK_REPLIES.length)];
    setReply(r.text);
    setEmotion(r.emotion);
    setJump((j) => (j ?? 0) + 1);
    setWave(true);
    setTimeout(() => {
      setReply(null);
      setEmotion("happy");
      setWave(false);
    }, 2400);
  };

  const bubbles = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        left: `${(i * 61) % 100}%`,
        size: 4 + ((i * 7) % 14),
        delay: `${(i * 1.7) % 9}s`,
        duration: `${9 + ((i * 3) % 8)}s`,
      })),
    [],
  );

  return (
    <section
      className="relative isolate overflow-hidden bg-ocean-950 text-white"
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return; // touch: no parallax jumps on taps/scroll
        const r = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width - 0.5);
        my.set((e.clientY - r.top) / r.height - 0.5);
      }}
    >
      {/* aurora */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-40 size-[42rem] rounded-full bg-seal-600/30 blur-[120px]" />
        <div className="absolute top-10 right-[-10rem] size-[36rem] rounded-full bg-violet-500/20 blur-[120px]" />
        <div className="absolute bottom-[-12rem] left-1/3 size-[40rem] rounded-full bg-coral-500/15 blur-[140px]" />
        <div className="noise absolute inset-0 opacity-[0.06] mix-blend-overlay" />
        <svg className="absolute inset-0 h-full w-full opacity-40" preserveAspectRatio="none">
          <defs>
            <pattern id="stars" width="140" height="140" patternUnits="userSpaceOnUse">
              <circle cx="12" cy="20" r="1" fill="#cbe3fd" opacity=".7" />
              <circle cx="90" cy="60" r="0.8" fill="#fff" opacity=".6" />
              <circle cx="50" cy="110" r="1.2" fill="#a9d0f7" opacity=".5" />
              <circle cx="120" cy="12" r="0.7" fill="#fff" opacity=".5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#stars)" />
        </svg>
        {bubbles.map((b, i) => (
          <span
            key={i}
            className="absolute bottom-0 rounded-full border border-white/30 bg-white/10 motion-safe:animate-rise"
            style={{ left: b.left, width: b.size, height: b.size, animationDelay: b.delay, animationDuration: b.duration }}
          />
        ))}
      </div>

      <div className="container-page grid min-h-[100svh] items-center gap-8 pt-[calc(var(--header-h)+2rem)] pb-40 lg:grid-cols-[1.05fr_1fr] lg:gap-4 lg:pb-44">
        <div className="relative z-10 max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-sm text-seal-200 backdrop-blur"
          >
            <Sparkles className="size-4 text-coral-300" />
            Онлайн-школа англійської для підлітків 12–18
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.08 }}
            className="mt-6 text-[2.5rem] leading-[1.06] font-bold text-balance sm:text-6xl lg:text-[3.4rem] xl:text-[3.9rem]"
          >
            Англійська, якою хочеться <span className="text-gradient">говорити</span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.16 }}
            className="mt-6 max-w-xl text-lg leading-relaxed text-seal-100/80 text-pretty"
          >
            Англійська, якою підліток говорить щотижня, а не лише на уроці: живий викладач у Google Meet, теми, які справді цікаві,
            кабінет з розкладом і домашкою та практика з ШІ-тренером Сілі між уроками.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.24 }}
            className="mt-9 flex flex-col gap-3 sm:flex-row"
          >
            <Button asChild size="xl">
              <a href="#trial">
                Безкоштовний пробний урок <ArrowRight />
              </a>
            </Button>
            <Button asChild size="xl" variant="glass">
              <a href="#method">Як ми навчаємо</a>
            </Button>
          </motion.div>
          <motion.ul
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.08, delayChildren: 0.4 } } }}
            className="mt-10 flex flex-wrap gap-x-6 gap-y-3 text-sm text-seal-100/80"
          >
            {[
              { icon: Gift, text: "Перший урок — безкоштовно" },
              { icon: Users, text: "Міні-групи 4–6 учнів" },
              { icon: Video, text: "Уроки в Google Meet" },
            ].map(({ icon: Icon, text }) => (
              <motion.li key={text} variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }} className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-lg bg-white/10">
                  <Icon className="size-4 text-seal-300" />
                </span>
                {text}
              </motion.li>
            ))}
          </motion.ul>
        </div>

        {/* mascot stage */}
        <div className="relative mx-auto w-full max-w-[560px] lg:max-w-none">
          <div aria-hidden className="absolute top-1/2 left-1/2 size-[80%] -translate-x-1/2 -translate-y-[46%] rounded-full bg-gradient-to-b from-seal-400/35 to-seal-700/5 blur-2xl" />

          <motion.div style={{ x: px1, y: py1 }} className="absolute top-[14%] -left-2 z-20 hidden sm:block lg:-left-6">
            <div className="glass-dark rotate-[-6deg] rounded-2xl px-4 py-3 shadow-glow motion-safe:animate-float">
              <div className="text-xs text-seal-200/70">Speaking club</div>
              <div className="font-display text-sm font-semibold">🎧 Talk about music</div>
            </div>
          </motion.div>
          <motion.div style={{ x: px2, y: py2 }} className="absolute right-0 bottom-[30%] z-20 hidden sm:block lg:-right-4">
            <div className="glass-dark rotate-[5deg] rounded-2xl px-4 py-3 shadow-glow motion-safe:animate-float-slow">
              <div className="text-xs text-seal-200/70">Прогрес</div>
              <div className="font-display text-sm font-semibold">A2 → B1 ✨</div>
              <div className="mt-2 h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-3/4 rounded-full bg-gradient-to-r from-seal-400 to-coral-400" />
              </div>
            </div>
          </motion.div>

          {/* speech bubble */}
          <div className="absolute top-[2%] right-[6%] z-30 sm:right-[10%]">
            <AnimatePresence mode="wait">
              <motion.div
                key={reply ?? phrase}
                initial={{ opacity: 0, y: 10, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 400, damping: 26 }}
                className="relative rounded-2xl rounded-bl-md bg-white px-4 py-2.5 font-display text-sm font-semibold text-ocean-900 shadow-lift sm:text-base"
              >
                {reply ?? PHRASES[phrase]}
                <span className="absolute -bottom-2 left-4 size-4 rotate-45 rounded-sm bg-white" />
              </motion.div>
            </AnimatePresence>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 120, damping: 16, delay: 0.2 }}
            className="relative z-10 mx-auto w-[88%] cursor-pointer sm:w-[80%]"
            onClick={onPoke}
            onPointerEnter={(e) => e.pointerType === "mouse" && !reply && setEmotion("joy")}
            onPointerLeave={(e) => e.pointerType === "mouse" && !reply && setEmotion("happy")}
          >
            <Seal emotion={emotion} wave={wave} track reading={!wave} jumpKey={jump} />
            <IceFloe />
          </motion.div>
        </div>
      </div>

      <Waves />
    </section>
  );
}

function IceFloe() {
  return (
    <svg viewBox="0 0 600 90" className="absolute -bottom-[7%] left-1/2 -z-10 w-[118%] -translate-x-1/2" aria-hidden>
      <path d="M40 34 L120 14 L260 8 L420 12 L540 22 L580 38 L520 58 L360 70 L180 66 L70 56 Z" fill="#eaf5ff" />
      <path d="M40 34 L70 56 L180 66 L360 70 L520 58 L580 38 L585 50 L530 76 L360 88 L170 84 L60 72 L34 46 Z" fill="#a9d0f7" />
      <path d="M120 14 L260 8 L300 16 L200 22 Z" fill="#fff" opacity=".8" />
    </svg>
  );
}

/** A wave that repeats exactly every 1440 units: two periods drift by one period → no seams. */
function wavePath(y: number, amp: number) {
  return `M0 ${y} C240 ${y - amp} 480 ${y - amp} 720 ${y} S1200 ${y + amp} 1440 ${y} S1920 ${y - amp} 2160 ${y} S2640 ${y + amp} 2880 ${y} L2880 200 L0 200 Z`;
}

const WAVES = [
  { fill: "#16447a", opacity: 0.5, y: 70, amp: 34, dur: "26s", delay: "-4s", reverse: false },
  { fill: "#2f69ad", opacity: 0.42, y: 104, amp: 26, dur: "19s", delay: "-11s", reverse: true },
  { fill: "#f5f9ff", opacity: 1, y: 142, amp: 22, dur: "34s", delay: "-7s", reverse: false },
];

function Waves() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-44 overflow-hidden">
      {WAVES.map((w, i) => (
        <svg
          key={i}
          viewBox="0 0 2880 200"
          preserveAspectRatio="none"
          className="absolute bottom-0 left-0 h-full w-[200%] motion-safe:animate-drift"
          style={{ animationDuration: w.dur, animationDelay: w.delay, animationDirection: w.reverse ? "reverse" : "normal" }}
        >
          <path d={wavePath(w.y, w.amp)} fill={w.fill} opacity={w.opacity} />
        </svg>
      ))}
    </div>
  );
}
