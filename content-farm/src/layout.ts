// Pure (browser-safe) conversion: script + measured audio → timed render scenes.
import { HANDLES } from "./brand.ts";
import { readingSeconds, spreadWords } from "./media/timing.ts";
import type { RenderBeat, RenderLocation, RenderProps, RenderScene, RenderWord, Script, Story, StoryProps } from "./schema.ts";

export interface SceneAudio {
  voice_src: string | null;
  voice_seconds: number | null;
  reveal_src: string | null;
  reveal_seconds: number | null;
  image_src: string | null;
}

const PAD = 0.35; // breathing room after each voice line
const COUNTDOWN = 3;

export function buildRenderProps(script: Script, audio: SceneAudio[], music_src: string | null, fps = 30, backdrop_src: string | null = null): RenderProps {
  const scenes: RenderScene[] = script.scenes.map((scene, i) => {
    const a = audio[i];
    const voiceLen = a?.voice_seconds ?? readingSeconds(scene.voice);
    const words = spreadWords(scene.voice, voiceLen);
    if (scene.kind === "quiz") {
      const question_duration = voiceLen + 0.2;
      const reveal_start = question_duration + COUNTDOWN;
      const revealText = scene.reveal_voice || scene.options[scene.answer] || "";
      const revealLen = a?.reveal_seconds ?? readingSeconds(revealText);
      return {
        ...scene,
        duration: reveal_start + revealLen + PAD + 0.3,
        question_duration,
        reveal_start,
        voice_src: a?.voice_src ?? null,
        reveal_src: a?.reveal_src ?? null,
        image_src: a?.image_src ?? null,
        words,
        reveal_words: spreadWords(revealText, revealLen),
      };
    }
    const min = scene.kind === "compare" ? 3.2 : scene.kind === "cta" ? 2.8 : 1.8;
    return {
      ...scene,
      duration: Math.max(min, voiceLen + PAD),
      question_duration: 0,
      reveal_start: 0,
      voice_src: a?.voice_src ?? null,
      reveal_src: null,
      image_src: a?.image_src ?? null,
      words,
      reveal_words: [],
    };
  });
  return { series_label: script.series_label, handle: HANDLES.tiktok.replace(/^@?/, "@"), scenes, music_src, backdrop_src, fps };
}

export interface BeatMedia {
  voice_src: string | null;
  voice_seconds: number | null;
  words: RenderWord[] | null;
}

/** Tight pacing: a cut right after each line keeps retention high. */
export function buildStoryProps(
  story: Story,
  media: BeatMedia[],
  locationImages: (string | null)[],
  music_src: string | null,
  fps = 30,
  heads: (RenderLocation["npc_head"])[] = [],
): StoryProps {
  const locations: RenderLocation[] = story.locations.map((l, i) => ({ ...l, image_src: locationImages[i] ?? null, npc_head: heads[i] ?? null }));
  const beats: RenderBeat[] = story.beats.map((beat, i) => {
    const m = media[i];
    const voice = m?.voice_seconds ?? readingSeconds(beat.narration);
    const last = i === story.beats.length - 1;
    return {
      ...beat,
      location: Math.min(Math.max(0, Math.round(beat.location)), Math.max(0, locations.length - 1)),
      // Breathing room so lines don't run into each other: longer when the speaker changes.
      duration: Math.max(1.4, voice + (last ? 1.8 : story.beats[i + 1]?.speaker !== beat.speaker ? 0.55 : 0.3)),
      voice_src: m?.voice_src ?? null,
      words: m?.words ?? spreadWords(beat.narration, voice),
    };
  });
  return { hook_overlay: story.hook_overlay, cover_title: story.cover_title || story.hook_overlay, handle: HANDLES.tiktok.replace(/^@?/, "@"), locations, beats, music_src, fps };
}
