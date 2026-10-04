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

const PAD = 0.22; // breathing room after each voice line
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
    const min = scene.kind === "compare" ? 3 : scene.kind === "cta" ? 2.4 : 1.3;
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

// Silence the voice clips start and end with. Eight lines of it add up to seconds of dead air, and
// before the first line it is exactly where viewers swipe away; the measured word timings say where
// the speech really is. Capped, so a word the aligner missed loses a breath, not a syllable.
const MAX_LEAD = 0.4;
const VOICE_MARGIN = 0.05;
const TAIL_MARGIN = 0.25;

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
    const clip = m?.voice_seconds ?? readingSeconds(beat.narration);
    const timed = m?.words?.length ? m.words : null;
    const lead = timed ? Math.min(MAX_LEAD, Math.max(0, timed[0].start - VOICE_MARGIN)) : 0;
    const voice = (timed ? Math.min(clip, timed[timed.length - 1].end + TAIL_MARGIN) : clip) - lead;
    const last = i === story.beats.length - 1;
    return {
      ...beat,
      location: Math.min(Math.max(0, Math.round(beat.location)), Math.max(0, locations.length - 1)),
      // Breathing room so lines don't run into each other: longer when the speaker changes; the
      // last line leaves a second for the subscribe call.
      duration: Math.max(1, voice + (last ? 1 : story.beats[i + 1]?.speaker !== beat.speaker ? 0.3 : 0.15)),
      voice_lead: lead,
      voice_src: m?.voice_src ?? null,
      words: (timed ?? spreadWords(beat.narration, voice)).map((w) => ({ ...w, start: Math.max(0, w.start - lead), end: Math.max(0, w.end - lead) })),
    };
  });
  return { hook_overlay: story.hook_overlay, cover_title: story.cover_title || story.hook_overlay, handle: HANDLES.tiktok.replace(/^@?/, "@"), locations, beats, music_src, fps };
}
