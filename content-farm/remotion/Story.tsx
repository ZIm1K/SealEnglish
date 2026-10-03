// Viral story as an animated scene: a generated location (with background characters baked in)
// + Sílі composited into the foreground, a virtual camera cutting between speakers, big synced
// captions, speaker tags, English easter-egg pill and a subtle brand mark.
import React from "react";
import { AbsoluteFill, Audio, Easing, Img, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { BLINKING_POSES } from "../src/brand.ts";
import type { RenderBeat, RenderLocation, RenderWord, StoryProps } from "../src/schema.ts";
import { BrandBackground } from "./parts.tsx";
import { body, C, display, H, W } from "./theme.ts";

export const beatFrames = (b: RenderBeat, fps: number) => Math.max(1, Math.round(b.duration * fps));

const YELLOW = "#FFD84D";
const SEAL_W = 500;
const SEAL_H = Math.round((SEAL_W * 1034) / 794);
const SEAL_FOOT = 1790; // world y of Sílі's feet
const sealX = (side: "left" | "right") => (side === "left" ? 320 : 760); // world x of his center

/** Camera = zoom + which world point (fx, fy) lands on which screen point (sx, sy). */
interface Cam {
  scale: number;
  fx: number;
  fy: number;
  sx: number;
  sy: number;
}

function camFor(beat: RenderBeat, loc: RenderLocation | undefined): Cam {
  const npcX = { left: 0.25 * W, center: 0.5 * W, right: 0.75 * W, none: 0.5 * W }[loc?.npc_side ?? "none"];
  const wide = { scale: 1.04, fx: W / 2, fy: H / 2, sx: W / 2, sy: H / 2 };
  switch (beat.shot) {
    case "npc":
      // Frame the detected head low enough that the speech bubble fits above it.
      if (loc?.npc_head) return { scale: 1.28, fx: loc.npc_head.x * W, fy: loc.npc_head.y * H, sx: W / 2, sy: 860 };
      return loc?.npc_side === "none" ? { ...wide, scale: 1.15 } : { scale: 1.28, fx: npcX, fy: 0.36 * H, sx: W / 2, sy: 0.38 * H };
    case "seal":
      // Medium shot: his head/upper body centered, feet allowed to leave the frame.
      return beat.seal_visible
        ? { scale: 1.3, fx: sealX(beat.seal_side), fy: SEAL_FOOT - SEAL_H * 0.55, sx: W / 2, sy: 0.66 * H }
        : { ...wide, scale: 1.2 };
    case "punch":
      return beat.seal_visible
        ? { scale: 1.5, fx: sealX(beat.seal_side), fy: SEAL_FOOT - SEAL_H * 0.72, sx: W / 2, sy: 0.62 * H }
        : { ...wide, scale: 1.35 };
    default:
      return wide;
  }
}

/** Clamp the translation so the background always covers the whole frame. */
function camMatrix(c: Cam) {
  const tx = Math.min(0, Math.max(W - W * c.scale, c.sx - c.fx * c.scale));
  const ty = Math.min(0, Math.max(H - H * c.scale, c.sy - c.fy * c.scale));
  return { tx, ty, scale: c.scale };
}

/** Current camera for a beat: eases from the previous beat's framing when the location is the same. */
function useCam(beat: RenderBeat, prev: RenderBeat | null, loc: RenderLocation | undefined, frames: number) {
  const f = useCurrentFrame();
  const sameLoc = !!prev && prev.location === beat.location;
  const to = camFor(beat, loc);
  const from = sameLoc && prev ? camFor(prev, loc) : beat.shot === "punch" ? { ...to, scale: 1.55 } : to;
  const k = interpolate(f, [0, 14], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const drift = interpolate(f, [0, frames], [0, 0.035]);
  const lerp = (a: number, b: number) => a + (b - a) * k;
  return camMatrix({
    scale: lerp(from.scale, to.scale) + drift,
    fx: lerp(from.fx, to.fx),
    fy: lerp(from.fy, to.fy),
    sx: lerp(from.sx, to.sx),
    sy: lerp(from.sy, to.sy),
  });
}

function chunkWords(words: RenderWord[]): RenderWord[][] {
  const chunks: RenderWord[][] = [];
  let cur: RenderWord[] = [];
  for (const w of words) {
    const len = cur.reduce((a, x) => a + x.text.length + 1, 0) + w.text.length;
    if (cur.length && (cur.length >= 3 || len > 20)) {
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

const clean = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}'’-]/gu, "");

const BigCaptions: React.FC<{ words: RenderWord[]; keyword: string }> = ({ words, keyword }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = f / fps;
  const chunks = React.useMemo(() => chunkWords(words), [words]);
  if (!chunks.length) return null;
  let idx = chunks.findIndex((c) => t < c[c.length - 1].end);
  if (idx === -1) idx = chunks.length - 1;
  const chunk = chunks[idx];
  if (t < chunk[0].start - 0.05 && idx === 0) return null;
  const appear = spring({ frame: Math.round((t - chunk[0].start) * fps), fps, config: { damping: 14, stiffness: 320, mass: 0.5 } });
  const kw = clean(keyword);
  return (
    <div
      style={{
        position: "absolute",
        top: 790,
        left: 60,
        right: 60,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "0 26px",
        transform: `scale(${0.85 + appear * 0.15})`,
      }}
    >
      {chunk.map((w, i) => {
        const active = t >= w.start && t < w.end + 0.05;
        const isKey = kw && clean(w.text).includes(kw);
        return (
          <span
            key={`${idx}-${i}`}
            style={{
              fontFamily: display,
              fontWeight: 900,
              fontSize: 88,
              lineHeight: 1.08,
              textTransform: "uppercase",
              color: isKey ? C.sky : active ? YELLOW : C.white,
              WebkitTextStroke: "14px #000",
              paintOrder: "stroke fill",
              textShadow: "0 10px 30px rgba(0,0,0,0.55)",
              transform: `scale(${active ? 1.06 : 1})`,
            }}
          >
            {w.text}
          </span>
        );
      })}
    </div>
  );
};

/** Sílі in the scene: walks in when he first appears, talks (bounce) on his lines, idles and blinks otherwise. */
const SealActor: React.FC<{ beat: RenderBeat; enters: boolean }> = ({ beat, enters }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = f / fps;
  const talking = beat.speaker === "seal";
  const walk = enters ? interpolate(f, [0, 18], [1, 0], { extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) }) : 0;
  const offscreen = beat.seal_side === "left" ? -700 : 700;
  const step = walk > 0 ? Math.abs(Math.sin(t * 14)) * 26 : 0;
  const bounce = talking ? Math.abs(Math.sin(t * 10.5)) * 14 : Math.sin(t * 2.2) * 6;
  const squash = talking ? 1 + Math.abs(Math.sin(t * 10.5)) * 0.025 : 1;
  const blinkCycle = Math.round(fps * 3.1);
  const blink = BLINKING_POSES.includes(beat.seal_pose) && f % blinkCycle > blinkCycle - 5;
  const flip = beat.seal_side === "right" ? -1 : 1; // face the scene's center
  const x = sealX(beat.seal_side) - SEAL_W / 2 + walk * offscreen;
  return (
    <>
      <Img
        src={staticFile("mascot3d/shadow-stand.webp")}
        style={{ position: "absolute", left: x + SEAL_W * 0.17, top: SEAL_FOOT - 40, width: SEAL_W * 0.66, opacity: 0.8 }}
      />
      <div
        style={{
          position: "absolute",
          left: x,
          top: SEAL_FOOT - SEAL_H - bounce - step,
          width: SEAL_W,
          transformOrigin: "50% 100%",
          transform: `scaleX(${flip}) scaleY(${squash}) rotate(${talking ? Math.sin(t * 5) * 2 : 0}deg)`,
          filter: "drop-shadow(0 18px 24px rgba(0,0,0,0.35))",
        }}
      >
        <Img src={staticFile(`mascot3d/${blink ? `${beat.seal_pose}-blink` : beat.seal_pose}.webp`)} style={{ width: "100%" }} />
      </div>
    </>
  );
};

const World: React.FC<{ beat: RenderBeat; prev: RenderBeat | null; loc: RenderLocation | undefined; frames: number }> = ({ beat, prev, loc, frames }) => {
  const cam = useCam(beat, prev, loc, frames);
  const sameLoc = !!prev && prev.location === beat.location;
  // Sílі walks in on his first appearance in a location (including the very first beat).
  const enters = beat.seal_visible && (!sameLoc || !prev?.seal_visible || prev.seal_side !== beat.seal_side);
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#000" }}>
      <div style={{ position: "absolute", width: W, height: H, transformOrigin: "0 0", transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.scale})` }}>
        {loc?.image_src ? (
          <Img src={staticFile(loc.image_src)} style={{ position: "absolute", inset: 0, width: W, height: H, objectFit: "cover" }} />
        ) : (
          <BrandBackground seed={beat.location * 17} />
        )}
        {beat.seal_visible && <SealActor beat={beat} enters={enters} />}
      </div>
    </AbsoluteFill>
  );
};

/**
 * Comic speech bubble for character lines: anchored over the speaker (screen position follows the
 * camera), name chip, karaoke highlight, and a Ukrainian translation under English lines.
 */
const SpeechBubble: React.FC<{ beat: RenderBeat; prev: RenderBeat | null; loc: RenderLocation | undefined; frames: number; minY: number }> = ({
  beat,
  prev,
  loc,
  frames,
  minY,
}) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cam = useCam(beat, prev, loc, frames);
  const t = f / fps;
  const pop = spring({ frame: f - 2, fps, config: { damping: 13, stiffness: 240 } });
  const isSeal = beat.speaker === "seal";
  // World anchor: top of Sílі's head, or the background character's head area.
  const npcX = { left: 0.25 * W, center: 0.5 * W, right: 0.75 * W, none: 0.5 * W }[loc?.npc_side ?? "none"];
  const head = loc?.npc_head;
  const wx = isSeal && beat.seal_visible ? sealX(beat.seal_side) : head ? head.x * W : npcX;
  // Anchor just above the speaker's head: bubbles always sit above heads, never over faces.
  const wy = isSeal && beat.seal_visible ? SEAL_FOOT - SEAL_H * 0.95 : head ? head.top * H - 12 : 0.26 * H;
  const ax = Math.min(W - 80, Math.max(80, cam.tx + wx * cam.scale));
  const ay = Math.min(1500, Math.max(minY + 260, cam.ty + wy * cam.scale));
  const bubbleW = 820;
  const left = Math.min(W - bubbleW - 40, Math.max(40, ax - bubbleW / 2));
  const above = true;
  const en = beat.speaker.startsWith("en_");
  const accent = isSeal ? C.sky : en ? C.white : C.coral;
  return (
    <div
      style={{
        position: "absolute",
        left,
        width: bubbleW,
        ...(above ? { bottom: H - ay + 34 } : { top: ay + 34 }),
        transform: `scale(${pop})`,
        transformOrigin: `${ax - left}px ${above ? "100%" : "0%"}`,
      }}
    >
      <div style={{ position: "relative", background: C.white, borderRadius: 40, padding: "30px 38px 28px", boxShadow: "0 20px 50px rgba(0,0,0,0.45)", border: `6px solid ${accent === C.white ? C.navy : accent}` }}>
        <div style={{ position: "absolute", top: -26, left: 30, display: "flex", gap: 10, alignItems: "center", padding: "6px 18px", borderRadius: 999, background: accent === C.white ? C.navy : accent, color: accent === C.sky ? C.navy : C.white, fontFamily: body, fontWeight: 800, fontSize: 30 }}>
          {en && <span style={{ fontSize: 22, padding: "1px 8px", borderRadius: 6, background: C.white, color: C.navy }}>EN</span>}
          {beat.speaker_name || "…"}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0 14px", fontFamily: body, fontWeight: 800, fontSize: 58, lineHeight: 1.15, color: "#1b1b1b" }}>
          {beat.words.map((w, i) => {
            const said = t >= w.start;
            const active = t >= w.start && t < w.end + 0.05;
            return (
              <span key={i} style={{ color: active ? C.coral : said ? "#1b1b1b" : "#9a9a9a" }}>
                {w.text}
              </span>
            );
          })}
        </div>
        {beat.translation && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "3px dashed #d9d9d9", fontFamily: body, fontWeight: 600, fontSize: 40, color: "#555" }}>
            {beat.translation}
          </div>
        )}
        {/* Tail pointing at the speaker: a rotated square overlapping the bubble, carrying the same
            border on its two outer edges — one solid shape, no seam. */}
        <div
          style={{
            position: "absolute",
            left: Math.min(bubbleW - 100, Math.max(50, ax - left - 22)),
            ...(above ? { bottom: -25 } : { top: -25 }),
            width: 40,
            height: 40,
            background: C.white,
            borderRadius: 5,
            transform: "rotate(45deg)",
            ...(above
              ? { borderRight: `6px solid ${accent === C.white ? C.navy : accent}`, borderBottom: `6px solid ${accent === C.white ? C.navy : accent}` }
              : { borderLeft: `6px solid ${accent === C.white ? C.navy : accent}`, borderTop: `6px solid ${accent === C.white ? C.navy : accent}` }),
          }}
        />
      </div>
    </div>
  );
};

const HookCard: React.FC<{ text: string }> = ({ text }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - 3, fps, config: { damping: 12, stiffness: 200 } });
  const out = interpolate(f, [fps * 2.3, fps * 2.6], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (!text || out <= 0) return null;
  return (
    <div style={{ position: "absolute", top: 300, left: 70, right: 70, display: "flex", justifyContent: "center", opacity: out }}>
      <div
        style={{
          background: C.white,
          color: "#111",
          fontFamily: body,
          fontWeight: 800,
          fontSize: 58,
          lineHeight: 1.18,
          textAlign: "center",
          padding: "22px 34px",
          borderRadius: 26,
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          transform: `scale(${s}) rotate(${(1 - s) * -4}deg)`,
        }}
      >
        {text}
      </div>
    </div>
  );
};

const EnglishPill: React.FC<{ text: string }> = ({ text }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - 4, fps, config: { damping: 10, stiffness: 170 } });
  if (!text) return null;
  return (
    <div style={{ position: "absolute", top: 440, left: 60, right: 60, display: "flex", flexDirection: "column", alignItems: "center", transform: `scale(${s})` }}>
      <div style={{ fontFamily: body, fontWeight: 800, fontSize: 34, color: C.white, background: C.coral, padding: "8px 22px", borderRadius: 999, marginBottom: -14, zIndex: 1 }}>
        англійською
      </div>
      <div
        style={{
          fontFamily: display,
          fontWeight: 900,
          fontSize: text.length > 22 ? 58 : 72,
          color: C.navy,
          background: C.sky,
          padding: "26px 44px 22px",
          borderRadius: 32,
          textAlign: "center",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        {text}
      </div>
    </div>
  );
};

const BrandMark: React.FC<{ handle: string }> = ({ handle }) => (
  <div style={{ position: "absolute", top: 210, right: 40, display: "flex", alignItems: "center", gap: 12, opacity: 0.85 }}>
    <div style={{ width: 74, height: 74, borderRadius: "50%", background: C.sky, overflow: "hidden", border: "3px solid white" }}>
      <Img src={staticFile("mascot3d/stand-happy.sm.webp")} style={{ width: 110, marginLeft: -18, marginTop: -4 }} />
    </div>
    <div style={{ fontFamily: body, fontWeight: 800, fontSize: 30, color: C.white, textShadow: "0 2px 10px rgba(0,0,0,0.8)" }}>{handle}</div>
  </div>
);

const Outro: React.FC = () => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - 6, fps, config: { damping: 12, stiffness: 160 } });
  return (
    <div style={{ position: "absolute", top: 640, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
      <div
        style={{
          padding: "18px 34px",
          background: C.coral,
          color: C.white,
          fontFamily: display,
          fontWeight: 900,
          fontSize: 40,
          borderRadius: 28,
          transform: `scale(${s})`,
          boxShadow: "0 18px 50px rgba(251,123,99,0.5)",
        }}
      >
        Більше історій — підпишись
      </div>
    </div>
  );
};

const BeatView: React.FC<{ beat: RenderBeat; prev: RenderBeat | null; loc: RenderLocation | undefined; index: number; last: boolean; hook: string; handle: string }> = (p) => {
  const { beat } = p;
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const frames = beatFrames(beat, fps);
  const cut = p.index > 0 && p.prev?.location !== beat.location;
  // Last beat: once the line is over, clear the text overlays and show the subscribe call alone.
  const tail = p.last && f > frames - 1.5 * fps;
  const flash = cut ? interpolate(f, [0, 4], [0.45, 0], { extrapolateRight: "clamp" }) : 0;
  return (
    <AbsoluteFill>
      <World beat={beat} prev={p.prev} loc={p.loc} frames={frames} />
      <AbsoluteFill
        style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0) 70%)" }}
      />
      <BrandMark handle={p.handle} />
      {p.index === 0 && <HookCard text={p.hook} />}
      {beat.speaker === "narrator" && !tail && <EnglishPill text={beat.english} />}
      {tail ? null : beat.speaker === "narrator" ? (
        <BigCaptions words={beat.words} keyword={beat.keyword} />
      ) : (
        <SpeechBubble beat={beat} prev={p.prev} loc={p.loc} frames={frames} minY={p.index === 0 ? 560 : 380} />
      )}
      {tail && (
        <Sequence from={frames - Math.round(1.5 * fps)} layout="none">
          <Outro />
        </Sequence>
      )}
      <AbsoluteFill style={{ background: "white", opacity: flash }} />
      {beat.voice_src && <Audio src={staticFile(beat.voice_src)} />}
      {cut && <Audio src={staticFile("sfx/whoosh.wav")} volume={0.18} />}
    </AbsoluteFill>
  );
};

export const StoryVideo: React.FC<StoryProps> = ({ beats, locations, hook_overlay, handle, music_src, fps }) => {
  let from = 0;
  const total = beats.reduce((a, b) => a + beatFrames(b, fps), 0);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {beats.map((beat, i) => {
        const frames = beatFrames(beat, fps);
        const el = (
          <Sequence key={i} from={from} durationInFrames={frames}>
            <BeatView
              beat={beat}
              prev={beats[i - 1] ?? null}
              loc={locations[beat.location]}
              index={i}
              last={i === beats.length - 1}
              hook={hook_overlay}
              handle={handle}
            />
          </Sequence>
        );
        from += frames;
        return el;
      })}
      {music_src && (
        <Audio
          loop
          src={staticFile(music_src)}
          volume={(fr) => interpolate(fr, [0, 10, total - 25, total], [0, 0.12, 0.12, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
        />
      )}
    </AbsoluteFill>
  );
};
