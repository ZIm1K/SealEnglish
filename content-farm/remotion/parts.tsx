import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { BLINKING_POSES, type MascotPose } from "../src/brand.ts";
import type { RenderWord } from "../src/schema.ts";
import { body, C, display } from "./theme.ts";

/** Animated brand backdrop: deep navy with drifting sky/coral glows and floating ice flakes. */
export const BrandBackground: React.FC<{ seed: number }> = ({ seed }) => {
  const f = useCurrentFrame();
  const t = f / 30;
  const blob = (x: number, y: number, r: number, color: string, speed: number, phase: number) => (
    <div
      style={{
        position: "absolute",
        left: x + Math.sin(t * speed + phase + seed) * 120,
        top: y + Math.cos(t * speed * 0.8 + phase + seed) * 140,
        width: r,
        height: r,
        borderRadius: "50%",
        background: color,
        filter: "blur(120px)",
        opacity: 0.55,
      }}
    />
  );
  return (
    <AbsoluteFill style={{ background: `linear-gradient(170deg, ${C.navy2} 0%, ${C.navy} 65%)`, overflow: "hidden" }}>
      {blob(-200, 150, 760, C.skyDeep, 0.35, 0)}
      {blob(560, 900, 680, C.coral, 0.28, 2)}
      {blob(200, 1450, 720, C.sky, 0.22, 4)}
      {Array.from({ length: 22 }, (_, i) => {
        const x = ((i * 397 + seed * 131) % 1080) + Math.sin(t * 0.6 + i) * 18;
        const y = (((i * 263 + seed * 71) % 2100) - ((t * (14 + (i % 5) * 6)) % 2100) + 2100) % 2100 - 90;
        const size = 6 + (i % 4) * 5;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: size,
              height: size,
              borderRadius: size / 3,
              transform: `rotate(${t * 20 + i * 30}deg)`,
              background: "rgba(255,255,255,0.16)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

/** Generated illustration with a slow Ken Burns push and a readability gradient. */
export const ImageBackground: React.FC<{ src: string; durationInFrames: number }> = ({ src, durationInFrames }) => {
  const f = useCurrentFrame();
  const scale = interpolate(f, [0, durationInFrames], [1.04, 1.16]);
  const x = interpolate(f, [0, durationInFrames], [-20, 20]);
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: C.navy }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale}) translateX(${x}px)` }} />
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(6,20,40,0.82) 0%, rgba(6,20,40,0.35) 30%, rgba(6,20,40,0.45) 55%, rgba(6,20,40,0.92) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/** Sílі: pops in on every scene, idles with a gentle bob, blinks if the pose has a blink frame. */
export const Mascot: React.FC<{ pose: MascotPose; big?: boolean }> = ({ pose, big }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: f, fps, config: { damping: 11, stiffness: 140, mass: 0.7 } });
  const bob = Math.sin((f / fps) * 2.4) * 10;
  const tilt = Math.sin((f / fps) * 1.3) * 2.5;
  const blinkCycle = Math.round(fps * 3.2);
  const blinking = BLINKING_POSES.includes(pose) && f % blinkCycle > blinkCycle - 5;
  const file = blinking ? `${pose}-blink` : pose;
  const width = big ? 560 : 380;
  return (
    <div
      style={{
        position: "absolute",
        left: big ? 260 : 10,
        bottom: big ? 250 : 230,
        width,
        transform: `translateY(${(1 - enter) * 420 + bob}px) rotate(${tilt + (1 - enter) * -12}deg) scale(${0.8 + enter * 0.2})`,
        transformOrigin: "50% 100%",
        filter: "drop-shadow(0 30px 40px rgba(0,0,0,0.45))",
      }}
    >
      <Img src={staticFile(`mascot3d/${file}.webp`)} style={{ width: "100%" }} />
    </div>
  );
};

/** Story-style segmented progress bar + series chip + handle. */
export const Header: React.FC<{ label: string; handle: string; sceneIndex: number; total: number; sceneProgress: number }> = ({
  label,
  handle,
  sceneIndex,
  total,
  sceneProgress,
}) => (
  <>
    <div style={{ position: "absolute", top: 70, left: 60, right: 60, display: "flex", gap: 10 }}>
      {Array.from({ length: total }, (_, i) => (
        <div key={i} style={{ flex: 1, height: 9, borderRadius: 9, background: "rgba(255,255,255,0.22)", overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: `${i < sceneIndex ? 100 : i === sceneIndex ? sceneProgress * 100 : 0}%`,
              background: C.white,
              borderRadius: 9,
            }}
          />
        </div>
      ))}
    </div>
    <div style={{ position: "absolute", top: 118, right: 64, fontFamily: body, fontWeight: 600, fontSize: 30, color: "rgba(255,255,255,0.7)" }}>{handle}</div>
    <div
      style={{
        position: "absolute",
        top: 175,
        left: 60,
        padding: "16px 34px",
        borderRadius: 999,
        background: C.coral,
        color: C.white,
        fontFamily: display,
        fontWeight: 700,
        fontSize: 36,
        boxShadow: "0 12px 30px rgba(251,123,99,0.35)",
      }}
    >
      {label}
    </div>
  </>
);

/** Karaoke captions: shows a window of words around the spoken one, the spoken word lit up. */
export const Captions: React.FC<{ words: RenderWord[]; offset?: number; until?: number }> = ({ words, offset = 0, until = Infinity }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = f / fps - offset;
  if (!words.length || t < 0 || t + offset >= until) return null;
  const found = words.findIndex((w) => t < w.end);
  const current = found === -1 ? words.length - 1 : found;
  const pageSize = 5;
  const page = Math.floor(current / pageSize);
  const shown = words.slice(page * pageSize, page * pageSize + pageSize);
  return (
    <div
      style={{
        position: "absolute",
        top: 1095,
        left: 70,
        right: 70,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "6px 18px",
        fontFamily: body,
        fontWeight: 800,
        fontSize: 60,
        lineHeight: 1.15,
        textAlign: "center",
      }}
    >
      {shown.map((w, i) => {
        const active = page * pageSize + i === current;
        const pop = active ? spring({ frame: Math.round((t - w.start) * fps), fps, config: { damping: 12, stiffness: 260 } }) : 0;
        const said = t >= w.start;
        return (
          <span
            key={`${page}-${i}`}
            style={{
              color: active ? C.navy : said ? C.white : "rgba(255,255,255,0.55)",
              background: active ? C.sky : "transparent",
              padding: "2px 14px",
              borderRadius: 16,
              transform: `scale(${1 + pop * 0.08})`,
              textShadow: active ? "none" : "0 4px 18px rgba(0,0,0,0.6)",
            }}
          >
            {w.text}
          </span>
        );
      })}
    </div>
  );
};

/** Text that springs in word by word. */
export const PopText: React.FC<{ text: string; size: number; color?: string; delay?: number; font?: string; weight?: number }> = ({
  text,
  size,
  color = C.white,
  delay = 0,
  font = display,
  weight = 900,
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `0 ${size * 0.28}px`, textAlign: "center" }}>
      {text.split(/\s+/).map((w, i) => {
        const s = spring({ frame: f - delay - i * 3, fps, config: { damping: 13, stiffness: 180 } });
        return (
          <span
            key={i}
            style={{
              fontFamily: font,
              fontWeight: weight,
              fontSize: size,
              lineHeight: 1.12,
              color,
              opacity: s,
              transform: `translateY(${(1 - s) * 40}px) scale(${0.7 + s * 0.3})`,
              textShadow: "0 8px 30px rgba(0,0,0,0.45)",
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};

/** Highlighted English phrase — the "takeaway" of the scene. */
export const EnglishPill: React.FC<{ text: string; delay?: number }> = ({ text, delay = 8 }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - delay, fps, config: { damping: 9, stiffness: 160 } });
  if (!text) return null;
  return (
    <div
      style={{
        marginTop: 40,
        alignSelf: "center",
        padding: "22px 44px",
        borderRadius: 34,
        background: C.sky,
        color: C.navy,
        fontFamily: display,
        fontWeight: 900,
        fontSize: text.length > 22 ? 52 : 66,
        textAlign: "center",
        transform: `scale(${s}) rotate(${(1 - s) * -6}deg)`,
        boxShadow: "0 18px 50px rgba(140,193,242,0.45)",
      }}
    >
      {text}
    </div>
  );
};

export const Mark: React.FC<{ ok: boolean; size?: number }> = ({ ok, size = 64 }) => (
  <svg width={size} height={size} viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="30" fill={ok ? C.green : C.red} />
    {ok ? (
      <path d="M18 33 l9 9 l19 -20" stroke="white" strokeWidth="7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    ) : (
      <path d="M21 21 L43 43 M43 21 L21 43" stroke="white" strokeWidth="7" strokeLinecap="round" />
    )}
  </svg>
);
