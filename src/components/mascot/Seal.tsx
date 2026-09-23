"use client";

import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useEffect, useId, useRef } from "react";
import { cn } from "@/lib/utils";
import { SEAL } from "./seal-geometry";
import { FACE } from "./seal-face";

/**
 * Сілі — the Seal English mascot.
 * A cut-out SVG rig (see design/mascot/build_rig.py) animated with motion values:
 * every moving part rotates around its own anatomical pivot via the SVG transform attribute.
 */

export type SealEmotion = "happy" | "neutral" | "joy" | "surprised" | "sad" | "wink" | "sleepy" | "love";

export interface SealProps {
  emotion?: SealEmotion;
  /** Keep waving the flipper. */
  wave?: boolean;
  /** Eyes (and a little bit of the head) follow the pointer. */
  track?: boolean;
  /** Turn a page every few seconds. */
  reading?: boolean;
  /** Breathing, blinking, whisker twitches, hair sway. */
  idle?: boolean;
  /** Change the value to trigger a happy jump. */
  jumpKey?: number;
  /** Explicit gaze (-1…1), overrides pointer tracking. */
  look?: { x: number; y: number } | null;
  /** Framing: whole body or just the head (avatars, icons). */
  crop?: "full" | "head" | "bust";
  className?: string;
  title?: string;
}

const P = SEAL.paths;
const C = SEAL.palette;
const A = SEAL.anchors;

const VIEW: Record<NonNullable<SealProps["crop"]>, string> = {
  full: "200 120 740 830",
  head: "318 150 480 430",
  bust: "250 130 680 560",
};

type EyeShape = "open" | "wide" | "happy" | "closed";
type MouthShape = keyof Pick<typeof FACE, "open" | "grin" | "smile" | "smallSmile" | "o" | "sad" | "flat">;

interface Expression {
  eyes: [EyeShape, EyeShape];
  mouth: MouthShape;
  brow: number; // vertical brow offset
  browTilt: number; // degrees, positive = worried
  blush: number;
  gazeY?: number;
}

const EXPRESSIONS: Record<SealEmotion, Expression> = {
  happy: { eyes: ["open", "open"], mouth: "open", brow: 0, browTilt: 0, blush: 1 },
  neutral: { eyes: ["open", "open"], mouth: "smallSmile", brow: 0, browTilt: 0, blush: 0.85 },
  joy: { eyes: ["happy", "happy"], mouth: "grin", brow: -6, browTilt: 0, blush: 1.2 },
  surprised: { eyes: ["wide", "wide"], mouth: "o", brow: -14, browTilt: 0, blush: 0.9 },
  sad: { eyes: ["open", "open"], mouth: "sad", brow: 4, browTilt: 14, blush: 0.6, gazeY: 0.7 },
  wink: { eyes: ["open", "happy"], mouth: "grin", brow: -4, browTilt: 0, blush: 1.1 },
  sleepy: { eyes: ["closed", "closed"], mouth: "flat", brow: 2, browTilt: 0, blush: 0.8 },
  love: { eyes: ["happy", "happy"], mouth: "smile", brow: -4, browTilt: 0, blush: 1.45 },
};

// Measured on the reference (pixels of the 1092px artwork).
const EYES = [
  { cx: 450.7, cy: 404.5, rot: -19, rx: 41.5, ry: 45.7, idx: 8, idy: 3, hx: 15, hy: -20.5 },
  { cx: 650.9, cy: 352.7, rot: -7.4, rx: 41, ry: 45.7, idx: -8, idy: 4, hx: -22.7, hy: -10.8 },
] as const;
const IRIS = { rx: 36.5, ry: 42 };

const rotAbout = (px: number, py: number) => (deg: number) => `rotate(${deg.toFixed(3)} ${px} ${py})`;

function useLoop(value: MotionValue<number>, keyframes: number[], duration: number, enabled: boolean, delay = 0) {
  useEffect(() => {
    if (!enabled) {
      const c = animate(value, 0, { duration: 0.6, ease: "easeOut" });
      return () => c.stop();
    }
    const c = animate(value, keyframes, { duration, repeat: Infinity, ease: "easeInOut", delay });
    return () => c.stop();
  }, [value, enabled, duration, delay, keyframes]);
}

// Stable keyframe arrays (identity matters for effect deps).
const K = {
  breathe: [1, 1.016, 1],
  headIdle: [0, -1.6, 0.8, 0],
  hair: [0, 5, -3, 0],
  wave: [0, -16, 4, -14, 2, 0],
  armIdle: [0, -2.5, 0],
  whisker: [0, 3, 0, -2, 0],
};

export function Seal({
  emotion = "happy",
  wave = false,
  track = false,
  reading = false,
  idle = true,
  jumpKey,
  look = null,
  crop = "full",
  className,
  title = "Сілі — тюлень-талісман Seal English",
}: SealProps) {
  const reduce = useReducedMotion() ?? false;
  const live = idle && !reduce;
  const uid = useId().replace(/:/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  const expr = EXPRESSIONS[emotion];

  // ── motion values ──
  const breathe = useMotionValue(1);
  const headRot = useMotionValue(0);
  const headLook = useSpring(0, { stiffness: 60, damping: 14 });
  const hairRot = useMotionValue(0);
  const armRot = useMotionValue(0);
  const footL = useMotionValue(0);
  const footR = useMotionValue(0);
  const whiskers = useMotionValue(0);
  const jumpY = useMotionValue(0);
  const squash = useMotionValue(1);
  const blink = useMotionValue(1);
  const gazeX = useSpring(0, { stiffness: 140, damping: 16 });
  const gazeY = useSpring(0, { stiffness: 140, damping: 16 });
  const page = useMotionValue(0); // 0 → right, 1 → left

  const breatheT = useTransform(breathe, (s) => `translate(560 905) scale(1 ${s.toFixed(4)}) translate(-560 -905)`);
  const headT = useTransform([headRot, headLook], ([a, b]: number[]) => rotAbout(A.headPivot[0], A.headPivot[1])(a + b));
  const hairT = useTransform(hairRot, rotAbout(A.hairPivot[0], A.hairPivot[1]));
  const armT = useTransform(armRot, rotAbout(A.armPivot[0], A.armPivot[1]));
  const footLT = useTransform(footL, rotAbout(A.footLPivot[0], A.footLPivot[1]));
  const footRT = useTransform(footR, rotAbout(A.footRPivot[0], A.footRPivot[1]));
  const whiskLT = useTransform(whiskers, rotAbout(A.whiskersL[0], A.whiskersL[1]));
  const whiskRT = useTransform(whiskers, (v) => rotAbout(A.whiskersR[0], A.whiskersR[1])(-v));
  const jumpT = useTransform([jumpY, squash], ([y, s]: number[]) =>
    `translate(0 ${y.toFixed(2)}) translate(560 910) scale(${(2 - s).toFixed(4)} ${s.toFixed(4)}) translate(-560 -910)`);
  const shadowScale = useTransform(jumpY, [-90, 0], [0.62, 1]);
  const shadowT = useTransform(shadowScale, (s) => `translate(560 918) scale(${s.toFixed(3)} ${s.toFixed(3)}) translate(-560 -918)`);
  const shadowOpacity = useTransform(jumpY, [-90, 0], [0.08, 0.16]);

  // ── idle life ──
  useLoop(breathe, K.breathe, 3.4, live);
  useLoop(headRot, K.headIdle, 7, live);
  useLoop(hairRot, K.hair, 3.1, live, 0.4);
  useLoop(armRot, wave ? K.wave : K.armIdle, wave ? 1.5 : 4.2, (wave || idle) && !reduce);
  useLoop(whiskers, K.whisker, 5.3, live, 1.2);

  // blinking + occasional foot taps
  useEffect(() => {
    if (reduce) return;
    let t: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t = setTimeout(() => {
        const double = Math.random() < 0.18;
        animate(blink, double ? [1, 0.06, 1, 0.06, 1] : [1, 0.06, 1], { duration: double ? 0.42 : 0.2, ease: "easeInOut" });
        if (idle && Math.random() < 0.3) {
          const f = Math.random() < 0.5 ? footL : footR;
          animate(f, [0, f === footL ? 5 : -5, 0], { duration: 0.5, ease: "easeInOut" });
        }
        schedule();
      }, 2200 + Math.random() * 3800);
    };
    schedule();
    return () => clearTimeout(t);
  }, [blink, footL, footR, idle, reduce]);

  // page turning
  useEffect(() => {
    if (!reading || reduce) return;
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const flip = async () => {
      page.set(0);
      await animate(page, 1, { duration: 1.1, ease: [0.45, 0, 0.3, 1] });
      if (!alive) return;
      page.set(0);
      t = setTimeout(flip, 4200 + Math.random() * 3000);
    };
    t = setTimeout(flip, 1800);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [reading, reduce, page]);

  // happy jump
  useEffect(() => {
    if (jumpKey === undefined || reduce) return;
    const seq = async () => {
      await animate(squash, 0.9, { duration: 0.12, ease: "easeOut" });
      animate(squash, [0.9, 1.06, 1], { duration: 0.55, ease: "easeOut" });
      await animate(jumpY, [0, -90, 0], { duration: 0.62, ease: [0.3, 0, 0.35, 1] });
      await animate(squash, [1, 0.92, 1], { duration: 0.28, ease: "easeOut" });
    };
    seq();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpKey]);

  // gaze: explicit look, pointer tracking or expression default
  useEffect(() => {
    if (look) {
      gazeX.set(look.x * 7);
      gazeY.set(look.y * 7);
      headLook.set(look.x * 3);
      return;
    }
    if (!track || reduce) {
      gazeX.set(0);
      gazeY.set((expr.gazeY ?? 0) * 7);
      headLook.set(0);
      return;
    }
    const onMove = (e: PointerEvent) => {
      // only a real cursor: taps and scrolls on touch screens would make the gaze jump randomly
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      const svg = svgRef.current;
      if (!svg) return;
      const r = svg.getBoundingClientRect();
      const cx = r.left + r.width * 0.5;
      const cy = r.top + r.height * 0.32;
      const dx = (e.clientX - cx) / Math.max(window.innerWidth * 0.5, 1);
      const dy = (e.clientY - cy) / Math.max(window.innerHeight * 0.5, 1);
      const clamp = (v: number) => Math.max(-1, Math.min(1, v));
      gazeX.set(clamp(dx * 1.4) * 7);
      gazeY.set(clamp(dy * 1.4) * 6 + (expr.gazeY ?? 0) * 4);
      headLook.set(clamp(dx) * 3.5);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [track, reduce, look, expr.gazeY, gazeX, gazeY, headLook]);

  return (
    <svg
      ref={svgRef}
      viewBox={VIEW[crop]}
      className={cn("block h-auto w-full select-none", crop === "full" ? "overflow-visible" : "overflow-hidden", className)}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {crop !== "full" && (
        <defs>
          <linearGradient id={`seal-fade-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.68" stopColor="#fff" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id={`seal-mask-${uid}`} maskUnits="userSpaceOnUse" x="0" y="0" width="1100" height="1100">
            <rect x="0" y="0" width="1100" height={crop === "head" ? 580 : 690} fill={`url(#seal-fade-${uid})`} />
          </mask>
        </defs>
      )}
      {crop === "full" && (
        <motion.ellipse cx={560} cy={918} rx={250} ry={16} fill={C.navy} style={{ opacity: shadowOpacity }} transform={shadowT} />
      )}
      <motion.g transform={jumpT} mask={crop !== "full" ? `url(#seal-mask-${uid})` : undefined}>
        <motion.g transform={footLT}>
          <path d={P.footL} fill={C.body} />
          <path d={P.strokeFootL} fill={C.stroke} />
        </motion.g>
        <motion.g transform={footRT}>
          <path d={P.footR} fill={C.body} />
          <path d={P.strokeFootR} fill={C.stroke} />
        </motion.g>

        <motion.g transform={breatheT}>
          {crop !== "head" && (
            <motion.g transform={armT}>
              <path d={P.arm} fill={C.body} />
              <path d={P.strokeArm} fill={C.stroke} />
            </motion.g>
          )}
          <path d={P.torso} fill={C.body} />
          <path d={P.belly} fill={C.light} />
          <Book page={page} />
          <path d={P.hand} fill={C.body} />
          <path d={P.strokeHand} fill={C.stroke} />

          <motion.g transform={headT}>
            <motion.g transform={hairT}>
              <path d={P.hair} fill={C.body} />
            </motion.g>
            <path d={P.head} fill={C.body} />
            {EYES.map((e, i) => (
              <ellipse key={`halo${i}`} cx={e.cx} cy={e.cy} rx={e.rx + 12} ry={e.ry + 13} fill="#9ACBF7" opacity={0.85} transform={`rotate(${e.rot} ${e.cx} ${e.cy})`} />
            ))}
            <path d={P.muzzle} fill={C.light} />
            <Cheeks blush={expr.blush} />
            {EYES.map((e, i) => (
              <Eye key={i} idx={i} uid={uid} shape={expr.eyes[i]} gazeX={gazeX} gazeY={gazeY} blink={blink} />
            ))}
            <Brows offset={expr.brow} tilt={expr.browTilt} />
            <Mouth shape={expr.mouth} />
            <path d={P.nose} fill={C.navy} />
            <motion.g transform={whiskLT}>
              <path d={P.whiskersL} fill={C.navy} />
            </motion.g>
            <motion.g transform={whiskRT}>
              <path d={P.whiskersR} fill={C.navy} />
            </motion.g>
          </motion.g>
        </motion.g>
      </motion.g>
    </svg>
  );
}

// ───────────────────────── parts ─────────────────────────

function Eye({
  idx, uid, shape, gazeX, gazeY, blink,
}: {
  idx: number;
  uid: string;
  shape: EyeShape;
  gazeX: MotionValue<number>;
  gazeY: MotionValue<number>;
  blink: MotionValue<number>;
}) {
  const e = EYES[idx];
  const rot = `rotate(${e.rot} ${e.cx} ${e.cy})`;
  const icx = e.cx + e.idx;
  const icy = e.cy + e.idy;
  const scale = shape === "wide" ? 1.07 : 1;
  const blinkT = useTransform(blink, (s) =>
    `translate(${e.cx} ${e.cy}) scale(${scale} ${(s * scale).toFixed(3)}) translate(${-e.cx} ${-e.cy})`);
  const irisT = useTransform([gazeX, gazeY], ([x, y]: number[]) => `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
  const irisScale = shape === "wide" ? 0.84 : 1;
  const clip = `seal-sc-${uid}-${idx}`;
  const irisClip = `seal-ir-${uid}-${idx}`;

  // closed shapes (^ happy, ‿ asleep) are the vectorised elements from the parts sheet
  const arc = (shape === "happy" ? FACE[idx === 0 ? "eyeHappy0" : "eyeHappy1"] : FACE[idx === 0 ? "eyeClosed0" : "eyeClosed1"]).navy;

  return (
    <AnimatePresence initial={false}>
      {shape === "happy" || shape === "closed" ? (
        <motion.path
          key={shape}
          d={arc}
          fill={C.navy}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        />
      ) : (
        <motion.g key="open" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
          <motion.g transform={blinkT}>
            <defs>
              <clipPath id={clip}>
                <ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} transform={rot} />
              </clipPath>
              <clipPath id={irisClip}>
                <ellipse cx={icx} cy={icy} rx={IRIS.rx * irisScale} ry={IRIS.ry * irisScale} transform={`rotate(${e.rot} ${icx} ${icy})`} />
              </clipPath>
            </defs>
            <ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} fill={C.white} stroke={C.navy} strokeWidth={5} transform={rot} />
            <g clipPath={`url(#${clip})`}>
              <motion.g transform={irisT}>
                <ellipse cx={icx} cy={icy} rx={IRIS.rx * irisScale} ry={IRIS.ry * irisScale} fill={C.navy} transform={`rotate(${e.rot} ${icx} ${icy})`} />
                <g clipPath={`url(#${irisClip})`}>
                  <ellipse
                    cx={icx + 2}
                    cy={icy + IRIS.ry * irisScale * 0.92}
                    rx={IRIS.rx * irisScale * 0.78}
                    ry={IRIS.ry * irisScale * 0.42}
                    fill={C.navySoft}
                    transform={`rotate(${e.rot} ${icx} ${icy})`}
                  />
                </g>
                <circle cx={e.cx + e.hx} cy={e.cy + e.hy} r={8.2} fill={C.white} />
                <circle cx={e.cx + e.hx + (idx === 0 ? 14 : -10)} cy={e.cy + e.hy + 30} r={3.2} fill={C.white} opacity={0.9} />
              </motion.g>
            </g>
          </motion.g>
        </motion.g>
      )}
    </AnimatePresence>
  );
}

function Brows({ offset, tilt }: { offset: number; tilt: number }) {
  return (
    <>
      <motion.g
        animate={{ y: offset, rotate: tilt }}
        transition={{ type: "spring", stiffness: 220, damping: 16 }}
        style={{ transformBox: "fill-box", transformOrigin: "100% 50%" }}
      >
        <path d={P.browL} fill={C.navy} />
      </motion.g>
      <motion.g
        animate={{ y: offset, rotate: -tilt }}
        transition={{ type: "spring", stiffness: 220, damping: 16 }}
        style={{ transformBox: "fill-box", transformOrigin: "0% 50%" }}
      >
        <path d={P.browR} fill={C.navy} />
      </motion.g>
    </>
  );
}

function Cheeks({ blush }: { blush: number }) {
  return (
    <motion.g animate={{ opacity: Math.min(1, 0.55 + blush * 0.4) }} transition={{ duration: 0.3 }}>
      {[
        [432.9, 469.6],
        [690.7, 408],
      ].map(([cx, cy]) => (
        <motion.ellipse
          key={cx}
          cx={cx}
          cy={cy}
          rx={21}
          ry={20}
          fill={C.cheek}
          animate={{ scale: blush }}
          transition={{ type: "spring", stiffness: 200, damping: 14 }}
          style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}
        />
      ))}
    </motion.g>
  );
}

// Mouths are the vectorised elements from the parts sheet (see design/mascot/build_face_parts.py),
// already placed on the face with the head's tilt. Emotions cross-fade between them.
function Mouth({ shape }: { shape: MouthShape }) {
  const m = FACE[shape] as { navy: string; coral?: string };
  return (
    <AnimatePresence initial={false}>
      <motion.g key={shape} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
        <path d={m.navy} fill={C.navy} />
        {m.coral && <path d={m.coral} fill={C.coral} />}
      </motion.g>
    </AnimatePresence>
  );
}

// ───────────────────────── book ─────────────────────────
// Seen from behind (Сілі is reading it): coral covers, page edges on top, a page fin sweeps over while turning.
const PAGE_FIN = [
  "M553 651 C585 622 632 600 691 596 C636 606 592 628 557 656 Z",
  "M553 651 C572 612 592 580 612 558 C601 584 581 620 557 656 Z",
  "M553 651 C555 610 557 575 560 548 C562 575 562 615 557 656 Z",
  "M553 651 C540 612 522 580 500 560 C516 585 535 620 557 656 Z",
  "M553 651 C520 608 478 580 428 572 C476 590 519 618 557 656 Z",
];

function Book({ page }: { page: MotionValue<number> }) {
  const d = useTransform(page, [0, 0.25, 0.5, 0.75, 1], PAGE_FIN);
  const opacity = useTransform(page, [0, 0.06, 0.94, 1], [0, 1, 1, 0]);
  return (
    <g strokeLinejoin="round">
      <path d="M411 590 L534 654 L526 777 L406 714 Z" fill={C.coral} stroke={C.coral} strokeWidth={6} />
      <path d="M560 657 L699 618 L675 734 L544 777 Z" fill={C.coral} stroke={C.coral} strokeWidth={6} />
      <path d="M411 589 L427 572 C478 578 522 604 548 644 L552 652 L533 654 Z" fill={C.page} />
      <path d="M552 652 L556 646 C585 612 630 596 691 594 L699 617 L560 657 Z" fill={C.page} />
      <g fill="none" stroke={C.white} strokeLinecap="round">
        <path d="M428 573 C478 579 522 605 548 645" strokeWidth={5} />
        <path d="M420 581 C470 588 515 612 543 650" strokeWidth={3.5} />
        <path d="M414 588 C466 596 512 620 538 654" strokeWidth={3} />
        <path d="M556 646 C585 613 630 597 690 595" strokeWidth={5} />
        <path d="M558 652 C590 624 636 608 694 604" strokeWidth={3.5} />
        <path d="M561 657 C594 632 640 618 697 614" strokeWidth={3} />
      </g>
      <motion.path d={d} fill={C.white} stroke={C.page} strokeWidth={2} style={{ opacity }} />
      <path d="M533 654 C541 661 553 661 560 656 L544 777 C539 783 530 782 526 776 Z" fill={C.navy} />
    </g>
  );
}

export default Seal;
