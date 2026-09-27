"use client";
/* eslint-disable @next/next/no-img-element -- static export: the frames are pre-sized webp, next/image adds nothing */

import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Seal, type SealEmotion, type SealProps } from "./Seal";
import { SEAL3D_CANVAS as CV, SEAL3D_FRAMES, SEAL3D_ICE, SEAL3D_SHADOW, SEAL3D_VERSION } from "./seal3d-frames";

/**
 * Сілі in 3D — pre-rendered frames (design/mascot/gen3d) for the marketing pages.
 * Same props as the 2D <Seal>; poses and emotions are separate images that cross-fade,
 * blinking and waving swap in extra frames, everything else (breathing, hops, leaning) is CSS transforms.
 * Falls back to the 2D mascot while no frames are generated.
 */

export interface Seal3DProps extends SealProps {
  /** Hop when clicked. */
  hop?: boolean;
  /** Warm up every frame of the current pose, for parents that switch emotions on interaction. */
  preload?: boolean;
  /** Stand on the 3D ice floe. */
  ice?: boolean;
}

type Pose = "wave" | "read" | "stand";

const FRAMES = new Set<string>(SEAL3D_FRAMES);
/** Whether <Seal3D> renders the 3D frames (and not the 2D fallback). */
export const hasSeal3D = SEAL3D_FRAMES.length > 0;
/** Whether <Seal3D ice> draws its own floe (the Hero keeps its SVG one otherwise). */
export const seal3dIce = hasSeal3D && SEAL3D_ICE !== null;
const POSES: Pose[] = ["stand", "read", "wave"];
// closest look-alikes, tried in the same pose before switching poses
const SIMILAR: Record<SealEmotion, SealEmotion[]> = {
  happy: ["neutral"],
  neutral: ["happy"],
  joy: ["love"],
  love: ["joy"],
  wink: ["joy"],
  sleepy: ["love", "neutral"],
  surprised: [],
  sad: [],
};

export function seal3dFrame(pose: Pose, emotion: SealEmotion): string {
  for (const e of [emotion, ...SIMILAR[emotion]]) if (FRAMES.has(`${pose}-${e}`)) return `${pose}-${e}`;
  for (const p of POSES) if (FRAMES.has(`${p}-${emotion}`)) return `${p}-${emotion}`;
  return FRAMES.has(`${pose}-happy`) ? `${pose}-happy` : SEAL3D_FRAMES[0];
}

const src = (name: string, small: boolean) => `/mascot3d/${name}${small ? ".sm" : ""}.webp?v=${SEAL3D_VERSION}`;

// decode() before a frame is shown, so a cross-fade never starts on a half-loaded image
const decoded = new Map<string, Promise<void>>();
function load(url: string): Promise<void> {
  let p = decoded.get(url);
  if (!p) {
    const img = new Image();
    img.src = url;
    p = img.decode().catch(() => undefined);
    decoded.set(url, p);
  }
  return p;
}

// Crops in canvas pixels, from the landmarks key.py measured (head top, feet, body centre).
const U = CV.bodyH;
const BOX = {
  full: { x: 0, y: 0, w: CV.w, h: CV.h },
  bust: { x: CV.cx - 0.47 * U, y: CV.headTop - 0.04 * U, w: 0.94 * U, h: 0.8 * U },
  head: { x: CV.cx - 0.34 * U, y: CV.headTop - 0.03 * U, w: 0.68 * U, h: 0.6 * U },
} as const;
const pct = (v: number, of: number) => `${(v / of) * 100}%`;
// Soft pool of shade around the feet, in feet widths. Centred a little above the baseline so the feet hide most of it:
// a band below the feet makes the seal float. The dark contact shadow hugging the feet is baked per pose (key.py).
const POOL = { w: 1.25, h: 0.12, lift: 0.02 };
const ORIGIN = `${pct(CV.cx, CV.w)} ${pct(CV.baseline, CV.h)}`;
const HOP = 0.09; // of the frame height

export function Seal3D({ hop, preload, ice, ...rest }: Seal3DProps) {
  if (!SEAL3D_FRAMES.length) return <Seal {...rest} />;
  return <Seal3DFrames hop={hop} preload={preload} ice={ice} {...rest} />;
}

interface Layer {
  id: number;
  name: string;
  fade: boolean;
}

function Seal3DFrames({
  emotion = "happy",
  wave = false,
  track = false,
  reading = false,
  idle = true,
  jumpKey,
  look = null,
  crop = "full",
  hop = false,
  preload = false,
  ice = false,
  className,
  title = "Сілі — тюлень-талісман Seal English",
}: Seal3DProps) {
  const reduce = useReducedMotion() ?? false;
  const rootRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef(0);
  const box = BOX[crop];
  const pose: Pose = wave ? "wave" : reading ? "read" : "stand";
  const target = seal3dFrame(pose, emotion);

  // ── size & visibility ──
  // null until measured: the frames start loading only once we know which size fits
  const [small, setSmall] = useState<boolean | null>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [pageShown, setPageShown] = useState(true);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const stageW = (r.width * CV.w) / box.w;
      heightRef.current = (stageW * CV.h) / CV.w;
      const fits = stageW * (window.devicePixelRatio || 1) <= CV.w * 0.58;
      // only ever upgrade to the big frames, never re-download the small ones
      setSmall((s) => (s === false ? false : fits));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { rootMargin: "80px" });
    io.observe(el);
    const onVis = () => setPageShown(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => {
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [box.w]);
  const live = !reduce && onScreen && pageShown;

  // ── frame layers: the new frame fades in over the opaque old one, then the old one fades out ──
  const [layers, setLayers] = useState<Layer[]>([]);
  const seq = useRef(0);
  const top = layers[layers.length - 1];
  useEffect(() => {
    if (small === null || (top && top.name === target)) return;
    let alive = true;
    load(src(target, small)).then(() => {
      if (!alive) return;
      const layer = { id: ++seq.current, name: target, fade: !reduce };
      setLayers((ls) => (ls.length && !reduce ? [...ls, layer] : [layer]));
    });
    return () => {
      alive = false;
    };
  }, [target, small, reduce, top]);
  const settle = (id: number) =>
    setLayers((ls) => {
      const i = ls.findIndex((l) => l.id === id);
      return i > 0 ? ls.slice(i) : ls;
    });

  // blink / second wave frame of the current frame, decoded ahead of use
  useEffect(() => {
    if (small === null || !top) return;
    for (const v of ["blink", "b"]) if (FRAMES.has(`${top.name}-${v}`)) load(src(`${top.name}-${v}`, small));
  }, [top, small]);
  useEffect(() => {
    if (!preload || small === null) return;
    const t = setTimeout(() => {
      for (const f of SEAL3D_FRAMES) if (f.startsWith(`${pose}-`) && f.split("-").length === 2) load(src(f, small));
    }, 1200);
    return () => clearTimeout(t);
  }, [preload, pose, small]);

  // ── blinking ──
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (!live) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms));
    const schedule = () =>
      later(() => {
        const twice = Math.random() < 0.18;
        setBlink(true);
        later(() => setBlink(false), 130);
        if (twice) {
          later(() => setBlink(true), 260);
          later(() => setBlink(false), 390);
        }
        schedule();
      }, 2000 + Math.random() * 4000);
    schedule();
    return () => {
      timers.forEach(clearTimeout);
      setBlink(false);
    };
  }, [live]);

  // ── waving: bursts of three flaps, then a pause ──
  const [flap, setFlap] = useState(false);
  useEffect(() => {
    if (!wave || !live) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const burst = (n: number) => {
      setFlap(n % 2 === 1);
      timers.push(n < 6 ? setTimeout(() => burst(n + 1), 240) : setTimeout(() => burst(1), 2300 + Math.random() * 1800));
    };
    timers.push(setTimeout(() => burst(1), 300));
    return () => {
      timers.forEach(clearTimeout);
      setFlap(false);
    };
  }, [wave, live]);

  // ── breathing ──
  const breathe = useMotionValue(1);
  useEffect(() => {
    if (!live || !idle) {
      const c = animate(breathe, 1, { duration: 0.5 });
      return () => c.stop();
    }
    const c = animate(breathe, [1, 1.012, 1], { duration: 3.4, repeat: Infinity, ease: "easeInOut" });
    return () => c.stop();
  }, [live, idle, breathe]);

  // ── hop: squash, jump with stretch, land ──
  const lift = useMotionValue(0); // 0 … 1 of the hop height
  const squash = useMotionValue(1);
  const hopY = useTransform(lift, (v) => -v * HOP * heightRef.current);
  const scaleX = useTransform(squash, (s) => 2 - s);
  const shadowScale = useTransform(lift, [0, 1], [1, 0.62]);
  const shadowOpacity = useTransform(lift, [0, 1], [1, 0.45]);
  const contactOpacity = useTransform(lift, [0, 0.25], [1, 0]); // only while the feet touch the ground
  const hopNow = async () => {
    if (reduce) return;
    await animate(squash, 0.9, { duration: 0.12, ease: "easeOut" });
    animate(squash, [0.9, 1.05, 1], { duration: 0.55, ease: "easeOut" });
    await animate(lift, [0, 1, 0], { duration: 0.62, ease: [0.3, 0, 0.35, 1] });
    await animate(squash, [1, 0.93, 1], { duration: 0.28, ease: "easeOut" });
  };
  useEffect(() => {
    if (jumpKey !== undefined) hopNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpKey]);

  // ── lean toward the cursor (or an explicit look) ──
  const leanX = useSpring(0, { stiffness: 70, damping: 16 });
  const leanY = useSpring(0, { stiffness: 70, damping: 16 });
  const rotate = useTransform(leanX, (v) => v * 2.2);
  const rotateY = useTransform(leanX, (v) => v * 7);
  const rotateX = useTransform(leanY, (v) => v * -4);
  useEffect(() => {
    if (look) {
      leanX.set(look.x);
      leanY.set(look.y);
      return;
    }
    leanX.set(0);
    leanY.set(0);
    if (!track || reduce) return;
    const onMove = (e: PointerEvent) => {
      // only a real cursor: taps and scrolls on touch screens would make it jerk around
      if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
      const el = rootRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const clamp = (v: number) => Math.max(-1, Math.min(1, v));
      leanX.set(clamp(((e.clientX - (r.left + r.width / 2)) / Math.max(window.innerWidth * 0.5, 1)) * 1.3));
      leanY.set(clamp(((e.clientY - (r.top + r.height * 0.3)) / Math.max(window.innerHeight * 0.5, 1)) * 1.3));
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [track, reduce, look, leanX, leanY]);

  const faded = crop !== "full";
  const contact = crop === "full" ? SEAL3D_SHADOW : null;
  const fade = crop === "head" ? "linear-gradient(to bottom, #000 70%, transparent)" : "linear-gradient(to bottom, #000 76%, transparent)";

  return (
    <div
      ref={rootRef}
      role="img"
      aria-label={title}
      title={title}
      onClick={hop ? hopNow : undefined}
      className={cn("relative block w-full select-none", className)}
      style={{ aspectRatio: `${Math.round(box.w)} / ${Math.round(box.h)}` }}
    >
      <div
        className={cn("absolute inset-0", faded && "overflow-hidden")}
        style={faded ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
      >
        <div
          className="absolute"
          style={{ left: pct(-box.x, box.w), top: pct(-box.y, box.h), width: pct(CV.w, box.w), height: pct(CV.h, box.h) }}
        >
          {ice && SEAL3D_ICE && small !== null && <Ice small={small} />}
          {crop === "full" && (
            <motion.div
              aria-hidden
              className="absolute"
              style={{
                left: pct(CV.feetCx - (CV.feetW * POOL.w) / 2, CV.w),
                width: pct(CV.feetW * POOL.w, CV.w),
                top: pct(CV.baseline - CV.feetW * (POOL.lift + POOL.h / 2), CV.h),
                height: pct(CV.feetW * POOL.h, CV.h),
                background: "radial-gradient(closest-side, rgb(32 78 146 / 0.22), transparent)",
                scale: shadowScale,
                opacity: shadowOpacity,
              }}
            />
          )}
          {/* leaning moves the feet, so the contact shadow leans along; the hop leaves it on the ground */}
          <motion.div
            className="absolute inset-0"
            style={{ rotate, rotateX, rotateY, transformPerspective: 1400, transformOrigin: ORIGIN }}
          >
            {contact && top && (
              <motion.div className="absolute inset-0" style={{ opacity: contactOpacity }}>
                {contact.poses.map((p) => (
                  <img
                    key={p}
                    src={src(`shadow-${p}`, false)}
                    alt=""
                    draggable={false}
                    className="pointer-events-none absolute left-0 w-full max-w-none"
                    style={{
                      top: pct(contact.top, CV.h),
                      height: pct(contact.h, CV.h),
                      opacity: top.name.startsWith(`${p}-`) ? 1 : 0,
                      transition: "opacity 200ms ease-out",
                    }}
                  />
                ))}
              </motion.div>
            )}
            <motion.div className="absolute inset-0" style={{ y: hopY, scaleX, scaleY: squash, transformOrigin: ORIGIN }}>
              <motion.div className="absolute inset-0" style={{ scaleY: breathe, transformOrigin: ORIGIN }}>
                <AnimatePresence initial={false}>
                  {small !== null &&
                    layers.map((l) => (
                      <FrameLayer
                        key={l.id}
                        layer={l}
                        small={small}
                        blink={blink && l === top}
                        flap={flap && l === top}
                        onShown={settle}
                      />
                    ))}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function FrameLayer({
  layer, small, blink, flap, onShown,
}: {
  layer: Layer;
  small: boolean;
  blink: boolean;
  flap: boolean;
  onShown: (id: number) => void;
}) {
  const { name } = layer;
  const hasB = FRAMES.has(`${name}-b`);
  const hasBlink = FRAMES.has(`${name}-blink`);
  const b = flap && hasB;
  const img = "pointer-events-none absolute inset-0 size-full";
  return (
    <motion.div
      className="absolute inset-0"
      initial={layer.fade ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.16 } }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      onAnimationComplete={() => onShown(layer.id)}
    >
      {/* the flap frame covers the base first and only then the base hides, so the body never goes see-through */}
      <img
        src={src(name, small)}
        alt=""
        draggable={false}
        className={img}
        style={{ opacity: b ? 0 : 1, transition: b ? "opacity 50ms linear 70ms" : "none" }}
      />
      {hasB && (
        <img src={src(`${name}-b`, small)} alt="" draggable={false} className={img} style={{ opacity: b ? 1 : 0, transition: "opacity 70ms linear" }} />
      )}
      {hasBlink && (
        <img
          src={src(`${name}-blink`, small)}
          alt=""
          draggable={false}
          className={img}
          style={{ opacity: blink && !b ? 1 : 0, transition: "opacity 40ms linear" }}
        />
      )}
    </motion.div>
  );
}

// The floe's top surface sits this far down its image; the seal's feet go there.
const ICE_SURFACE = 0.4;

function Ice({ small }: { small: boolean }) {
  if (!SEAL3D_ICE) return null;
  const w = CV.w * 0.98;
  const h = (w * SEAL3D_ICE.h) / SEAL3D_ICE.w;
  return (
    <img
      src={src("ice", small)}
      alt=""
      aria-hidden
      draggable={false}
      className="pointer-events-none absolute max-w-none"
      style={{ left: pct(CV.cx - w / 2, CV.w), width: pct(w, CV.w), top: pct(CV.baseline - h * ICE_SURFACE, CV.h) }}
    />
  );
}

export default Seal3D;
