import React from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { HANDLES } from "../src/brand.ts";
import type { RenderProps, RenderScene } from "../src/schema.ts";
import { Backdrop, BigCaps, Host, pill, SeriesChip, Stage, unnumbered } from "./eduParts.tsx";
import { EnglishPill, ImageBackground, Lead, Mark, PopText } from "./parts.tsx";
import { body, C, display } from "./theme.ts";

export const sceneFrames = (s: RenderScene, fps: number) => Math.max(1, Math.round(s.duration * fps));

const Sub: React.FC<{ text: string; delay?: number }> = ({ text, delay = 6 }) => {
  const f = useCurrentFrame();
  if (!text) return null;
  return (
    <div
      style={{
        marginTop: 26,
        textAlign: "center",
        fontFamily: body,
        fontWeight: 600,
        fontSize: 40,
        color: "rgba(255,255,255,0.82)",
        opacity: interpolate(f, [delay, delay + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
      }}
    >
      {text}
    </div>
  );
};

const CompareCard: React.FC<{ ok: boolean; text: string; start: number }> = ({ ok, text, start }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - start, fps, config: { damping: 12, stiffness: 150 } });
  const strike = ok ? 0 : interpolate(f - start, [10, 22], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 28,
        padding: "34px 38px",
        marginTop: 26,
        borderRadius: 36,
        background: ok ? "rgba(61,220,151,0.16)" : "rgba(255,90,95,0.14)",
        border: `4px solid ${ok ? C.green : C.red}`,
        opacity: s,
        transform: `translateX(${(1 - Math.min(s, 1)) * (ok ? 300 : -300)}px) scale(${ok ? 1 + Math.min(0.05, Math.max(0, s - 1)) : 1})`,
      }}
    >
      <Mark ok={ok} size={78} />
      <div style={{ position: "relative", flex: "0 1 auto", minWidth: 0, overflowWrap: "anywhere", fontFamily: display, fontWeight: 900, fontSize: text.length > 24 ? 46 : 58, color: C.white }}>
        {text}
        {!ok && (
          <div style={{ position: "absolute", left: 0, top: "52%", height: 7, width: `${strike}%`, background: C.red, borderRadius: 7 }} />
        )}
      </div>
    </div>
  );
};

const QuizOption: React.FC<{ text: string; letter: string; i: number; state: "idle" | "right" | "dim" }> = ({ text, letter, i, state }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - 8 - i * 5, fps, config: { damping: 13, stiffness: 170 } });
  const bg = state === "right" ? C.green : "rgba(255,255,255,0.1)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 26,
        marginTop: 22,
        padding: "26px 32px",
        borderRadius: 30,
        background: bg,
        border: `3px solid ${state === "right" ? C.green : "rgba(255,255,255,0.25)"}`,
        opacity: state === "dim" ? 0.35 : s,
        transform: `translateY(${(1 - s) * 60}px) scale(${state === "right" ? 1.05 : 1})`,
      }}
    >
      <div
        style={{
          width: 70,
          height: 70,
          borderRadius: 22,
          display: "grid",
          placeItems: "center",
          background: state === "right" ? C.white : C.sky,
          color: C.navy,
          fontFamily: display,
          fontWeight: 900,
          fontSize: 38,
        }}
      >
        {letter}
      </div>
      <div style={{ fontFamily: display, fontWeight: 700, fontSize: text.length > 22 ? 40 : 48, color: state === "right" ? C.navy : C.white }}>
        {text}
      </div>
    </div>
  );
};

const Countdown: React.FC<{ from: number }> = ({ from }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = (f - from) / fps;
  if (t < 0 || t >= 3) return null;
  const n = 3 - Math.floor(t);
  const frac = t % 1;
  return (
    // Positioned relative to the Stage card: lands right of Sílі, clear of the feed's button column.
    <div style={{ position: "absolute", left: 510, top: 880, width: 190, height: 190 }}>
      <svg width="190" height="190" viewBox="0 0 190 190">
        <circle cx="95" cy="95" r="82" stroke="rgba(255,255,255,0.2)" strokeWidth="14" fill="rgba(6,20,40,0.6)" />
        <circle
          cx="95"
          cy="95"
          r="82"
          stroke={C.coral}
          strokeWidth="14"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={2 * Math.PI * 82}
          strokeDashoffset={2 * Math.PI * 82 * (t / 3)}
          transform="rotate(-90 95 95)"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          fontFamily: display,
          fontWeight: 900,
          fontSize: 92,
          color: C.white,
          transform: `scale(${1.25 - frac * 0.25})`,
        }}
      >
        {n}
      </div>
    </div>
  );
};

const SceneBody: React.FC<{ scene: RenderScene; index: number; listNumber: number }> = ({ scene, listNumber }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const revealFrame = Math.round(scene.reveal_start * fps);
  const countdownFrame = Math.round(scene.question_duration * fps);

  switch (scene.kind) {
    case "compare": {
      const rightAt = Math.round(Math.max(0.9, scene.duration * 0.42) * fps);
      return (
        <Stage>
          <PopText text={scene.headline} size={64} />
          <CompareCard ok={false} text={scene.wrong} start={8} />
          <CompareCard ok text={scene.right} start={rightAt} />
          <Sequence from={rightAt} layout="none">
            <Audio src={staticFile("sfx/ding.wav")} volume={0.5} />
          </Sequence>
          <Sequence from={14} layout="none">
            <Audio src={staticFile("sfx/buzz.wav")} volume={0.35} />
          </Sequence>
        </Stage>
      );
    }
    case "quiz": {
      const revealed = f >= revealFrame;
      return (
        <Stage>
          <PopText text={scene.headline} size={60} />
          {scene.options.map((o, i) => (
            <QuizOption
              key={i}
              i={i}
              text={o}
              letter={"ABC"[i] ?? "•"}
              state={!revealed ? "idle" : i === scene.answer ? "right" : "dim"}
            />
          ))}
          <Countdown from={countdownFrame} />
          {[0, 1, 2].map((k) => (
            <Sequence key={k} from={countdownFrame + k * fps} layout="none" durationInFrames={10}>
              <Audio src={staticFile("sfx/tick.wav")} volume={0.6} />
            </Sequence>
          ))}
          <Sequence from={revealFrame} layout="none">
            <Audio src={staticFile("sfx/ding.wav")} volume={0.55} />
          </Sequence>
        </Stage>
      );
    }
    case "list_item": {
      const s = spring({ frame: f, fps, config: { damping: 10, stiffness: 150 } });
      return (
        <Stage>
          <div
            style={{
              alignSelf: "center",
              width: 150,
              height: 150,
              borderRadius: 48,
              background: C.coral,
              display: "grid",
              placeItems: "center",
              fontFamily: display,
              fontWeight: 900,
              fontSize: 90,
              color: C.white,
              marginBottom: 34,
              transform: `scale(${s}) rotate(${(1 - s) * 30}deg)`,
            }}
          >
            {listNumber}
          </div>
          <PopText text={unnumbered(scene.headline)} size={68} delay={4} />
          <EnglishPill text={pill(scene.english, scene.headline)} />
          <Sub text={scene.sub} delay={14} />
        </Stage>
      );
    }
    case "cta": {
      const pulse = 1 + Math.sin((f / fps) * 5) * 0.03;
      return (
        <>
          <Stage>
            <PopText text={scene.headline} size={70} />
            <div
              style={{
                alignSelf: "center",
                marginTop: 44,
                padding: "26px 54px",
                borderRadius: 999,
                background: C.coral,
                color: C.white,
                fontFamily: display,
                fontWeight: 900,
                fontSize: 50,
                textAlign: "center",
                transform: `scale(${pulse})`,
                boxShadow: "0 18px 50px rgba(251,123,99,0.5)",
              }}
            >
              {/* The CTA is fixed brand-wide: the site first, the Telegram bot second. */}
              {HANDLES.site}
            </div>
            <div
              style={{
                alignSelf: "center",
                marginTop: 26,
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "16px 30px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.14)",
                border: "2px solid rgba(255,255,255,0.3)",
                color: C.white,
                fontFamily: body,
                fontWeight: 800,
                fontSize: 36,
              }}
            >
              <span style={{ padding: "4px 14px", borderRadius: 999, background: C.sky, color: C.navy, fontSize: 28 }}>Telegram</span>
              {HANDLES.bot}
            </div>
          </Stage>
        </>
      );
    }
    case "hook":
      return (
        <Stage>
          <PopText text={scene.headline} size={scene.headline.length > 28 ? 72 : 88} />
          <EnglishPill text={pill(scene.english, scene.headline)} delay={12} />
          <Sub text={scene.sub} delay={16} />
        </Stage>
      );
    default:
      return (
        <Stage>
          <PopText text={scene.headline} size={scene.headline.length > 30 ? 60 : 72} />
          <EnglishPill text={pill(scene.english, scene.headline)} />
          <Sub text={scene.sub} delay={12} />
        </Stage>
      );
  }
};

const SceneView: React.FC<{ scene: RenderScene; index: number; total: number; label: string; handle: string; listNumber: number; seed: number; prevCta: boolean }> = (
  props,
) => {
  const { scene } = props;
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const frames = sceneFrames(scene, fps);
  const fadeIn = interpolate(f, [0, 6], [0, 1], { extrapolateRight: "clamp" });
  const revealFrame = Math.round(scene.reveal_start * fps);
  return (
    <AbsoluteFill>
      {scene.image_src && (
        <AbsoluteFill style={{ opacity: fadeIn }}>
          <ImageBackground src={scene.image_src} durationInFrames={frames} />
        </AbsoluteFill>
      )}
      <SeriesChip label={props.label} handle={props.handle} />
      <Lead.Provider value={props.index === 0 ? 18 : 0}>
        <SceneBody scene={scene} index={props.index} listNumber={props.listNumber} />
      </Lead.Provider>
      {scene.kind !== "cta" && <BigCaps words={scene.words} until={scene.kind === "quiz" ? scene.reveal_start : Infinity} />}
      {scene.kind === "quiz" && <BigCaps words={scene.reveal_words} offset={scene.reveal_start} />}
      <Lead.Provider value={props.index === 0 ? 12 : 0}>
        <Host scene={scene} first={props.index === 0} prevCta={props.prevCta} />
      </Lead.Provider>
      {scene.voice_src && <Audio src={staticFile(scene.voice_src)} />}
      {scene.reveal_src && (
        <Sequence from={revealFrame} layout="none">
          <Audio src={staticFile(scene.reveal_src)} />
        </Sequence>
      )}
      <Audio src={staticFile(props.index === 0 ? "sfx/pop.wav" : "sfx/whoosh.wav")} volume={0.45} />
    </AbsoluteFill>
  );
};

export const Short: React.FC<RenderProps> = ({ scenes, series_label, handle, music_src, backdrop_src, fps }) => {
  let from = 0;
  let listCounter = 0;
  const total = scenes.reduce((a, s) => a + sceneFrames(s, fps), 0);
  return (
    <AbsoluteFill style={{ background: C.navy }}>
      <Backdrop src={backdrop_src ?? null} total={total} />
      {scenes.map((scene, i) => {
        const frames = sceneFrames(scene, fps);
        if (scene.kind === "list_item") listCounter++;
        const el = (
          <Sequence key={i} from={from} durationInFrames={frames}>
            <SceneView scene={scene} index={i} total={scenes.length} label={series_label} handle={handle} listNumber={listCounter} seed={i * 7} prevCta={scenes[i - 1]?.kind === "cta"} />
          </Sequence>
        );
        from += frames;
        return el;
      })}
      {music_src && (
          <Audio
            loop
            src={staticFile(music_src)}
            volume={(f) => interpolate(f, [0, 3, total - 20, total], [0, 0.09, 0.09, 0], { extrapolateRight: "clamp" })}
          />
      )}
    </AbsoluteFill>
  );
};
