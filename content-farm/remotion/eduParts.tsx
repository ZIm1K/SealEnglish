// Building blocks of the edu video (Short.tsx), designed for the TikTok / Reels feed:
// content stays out of the top ~200px, the bottom ~420px and the right-hand button column.
import React from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { BLINKING_POSES } from "../src/brand.ts";
import type { RenderScene, RenderWord } from "../src/schema.ts";
import { BrandBackground } from "./parts.tsx";
import { body, C, display } from "./theme.ts";

/** Glass card that holds the scene's content, readable over any backdrop. */
export const Stage: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 16, stiffness: 170 } });
  return (
    <div
      style={{
        position: "absolute",
        top: 330,
        left: 50,
        right: 50,
        padding: "46px 44px 50px",
        borderRadius: 48,
        background: "rgba(6,20,40,0.74)",
        border: "2px solid rgba(255,255,255,0.14)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        opacity: s,
        transform: `translateY(${(1 - s) * 40}px)`,
      }}
    >
      {children}
    </div>
  );
};

/** Rubric chip: wraps instead of truncating. */
export const SeriesChip: React.FC<{ label: string; handle: string }> = ({ label, handle }) => (
  <div style={{ position: "absolute", top: 205, left: 50, right: 50, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20 }}>
    <div
      style={{
        padding: "14px 30px",
        borderRadius: 30,
        background: C.coral,
        color: C.white,
        fontFamily: display,
        fontWeight: 700,
        fontSize: 34,
        lineHeight: 1.15,
        maxWidth: 640,
        boxShadow: "0 12px 30px rgba(251,123,99,0.35)",
      }}
    >
      {label}
    </div>
    <div style={{ fontFamily: body, fontWeight: 800, fontSize: 28, color: "rgba(255,255,255,0.85)", textShadow: "0 2px 10px rgba(0,0,0,0.7)" }}>{handle}</div>
  </div>
);

function chunkWords(words: RenderWord[]): RenderWord[][] {
  const chunks: RenderWord[][] = [];
  let cur: RenderWord[] = [];
  for (const w of words) {
    const len = cur.reduce((a, x) => a + x.text.length + 1, 0) + w.text.length;
    if (cur.length && (cur.length >= 3 || len > 22)) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(w);
    if (/[.,!?:;—…]$/.test(w.text)) {
      chunks.push(cur);
      cur = [];
    }
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

/** Big 2–3-word captions synced to the voice (same language as the story format). */
export const BigCaps: React.FC<{ words: RenderWord[]; offset?: number; until?: number }> = ({ words, offset = 0, until = Infinity }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = f / fps - offset;
  const chunks = React.useMemo(() => chunkWords(words), [words]);
  if (!chunks.length || t < 0 || t + offset >= until) return null;
  let idx = chunks.findIndex((c) => t < c[c.length - 1].end);
  if (idx === -1) idx = chunks.length - 1;
  const chunk = chunks[idx];
  const appear = spring({ frame: Math.round((t - chunk[0].start) * fps), fps, config: { damping: 14, stiffness: 320, mass: 0.5 } });
  // Speech bubble to the right of Sílі (he is the one talking), left of the feed's button column.
  return (
    <div
      style={{
        position: "absolute",
        top: 1090,
        left: 470,
        width: 450,
        padding: "24px 30px",
        borderRadius: 34,
        background: C.white,
        boxShadow: "0 18px 44px rgba(0,0,0,0.45)",
        transformOrigin: "0% 60%",
        transform: `scale(${0.9 + appear * 0.1})`,
      }}
    >
      {/* Tail: a rotated square overlapping the bubble — one solid shape, no seam between the parts. */}
      <div
        style={{
          position: "absolute",
          left: -14,
          // Vertically centred, so it never lands on the rounded corner of a one-line bubble.
          top: "50%",
          marginTop: -18,
          width: 36,
          height: 36,
          borderRadius: 6,
          background: C.white,
          transform: "rotate(45deg)",
        }}
      />
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0 14px", fontFamily: body, fontWeight: 800, fontSize: 52, lineHeight: 1.16 }}>
        {chunk.map((w, i) => {
          const active = t >= w.start && t < w.end + 0.05;
          return (
            <span key={`${idx}-${i}`} style={{ color: active ? C.coral : t >= w.start ? "#1b1b1b" : "#9a9a9a" }}>
              {w.text}
            </span>
          );
        })}
      </div>
    </div>
  );
};

/** Sílі as the on-screen host: big, bounces while his line plays, blinks, centered on the CTA. */
export const Host: React.FC<{ scene: RenderScene; first: boolean; prevCta: boolean }> = ({ scene, first, prevCta }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = f / fps;
  // He walks in once at the start (and when he moves to the centre for the CTA) — not on every scene.
  const moves = first || (scene.kind === "cta") !== prevCta;
  const enter = moves ? spring({ frame: f, fps, config: { damping: 12, stiffness: 150, mass: 0.7 } }) : 1;
  const voiceEnd = scene.words.at(-1)?.end ?? 0;
  const revealEnd = scene.reveal_start + (scene.reveal_words.at(-1)?.end ?? 0);
  const talking = t < voiceEnd || (scene.kind === "quiz" && t >= scene.reveal_start && t < revealEnd);
  const beat = Math.abs(Math.sin(t * 10.5));
  const bounce = talking ? beat * 14 : Math.sin(t * 2.2) * 6;
  const blinkCycle = Math.round(fps * 3.1);
  const blink = BLINKING_POSES.includes(scene.mascot) && f % blinkCycle > blinkCycle - 5;
  const cta = scene.kind === "cta";
  const width = cta ? 520 : 440;
  return (
    <div
      style={{
        position: "absolute",
        left: cta ? (1080 - width) / 2 : 40,
        bottom: 400 + bounce,
        width,
        transformOrigin: "50% 100%",
        transform: `translateY(${(1 - enter) * 300}px) scaleY(${talking ? 1 + beat * 0.02 : 1}) rotate(${talking ? Math.sin(t * 5) * 2 : 0}deg)`,
        filter: "drop-shadow(0 24px 34px rgba(0,0,0,0.5))",
      }}
    >
      <Img src={staticFile(`mascot3d/${blink ? `${scene.mascot}-blink` : scene.mascot}.webp`)} style={{ width: "100%" }} />
    </div>
  );
};

/** One generated backdrop for the whole video, slowly drifting, dimmed for contrast. */
export const Backdrop: React.FC<{ src: string | null; total: number }> = ({ src, total }) => {
  const f = useCurrentFrame();
  if (!src) return <BrandBackground seed={5} />;
  const scale = interpolate(f, [0, total], [1.06, 1.18]);
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: C.navy }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(6,20,40,0.6) 0%, rgba(6,20,40,0.28) 45%, rgba(6,20,40,0.5) 100%)" }} />
    </AbsoluteFill>
  );
};

/** The pill repeats the takeaway only when the headline doesn't already show it. */
export const pill = (english: string, headline: string) => (english && !headline.toLowerCase().includes(english.toLowerCase()) ? english : "");
/** List items get their number from the badge, so a leading "1." in the headline is dropped. */
export const unnumbered = (text: string) => text.replace(/^\s*\d+[.)]\s*/, "");
