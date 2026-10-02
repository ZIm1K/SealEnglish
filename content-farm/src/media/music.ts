// Procedural background music: drums + bass + chords + melody per mood, rendered once to WAV.
// License-clean and free; real tracks dropped into assets/music/ take priority when present.
import fs from "node:fs";
import path from "node:path";

const SR = 44100;

interface Mood {
  bpm: number;
  bars: number;
  /** Chord roots as MIDI notes + quality, one chord per bar. */
  chords: [number, "maj" | "min"][];
  swing: number;
  drums: "four" | "trap" | "lofi" | "pulse";
  lead: "pluck" | "bell" | "square" | "none";
  padLevel: number;
}

const MOODS: Record<string, Mood> = {
  // I–V–vi–IV in C, bright four-on-the-floor.
  upbeat: { bpm: 118, bars: 16, chords: [[60, "maj"], [67, "maj"], [69, "min"], [65, "maj"]], swing: 0, drums: "four", lead: "pluck", padLevel: 0.5 },
  // vi–IV–I–V in A minor, lazy swung lo-fi.
  chill: { bpm: 84, bars: 12, chords: [[57, "min"], [65, "maj"], [60, "maj"], [67, "maj"]], swing: 0.12, drums: "lofi", lead: "bell", padLevel: 0.7 },
  // Bouncy staccato in F.
  funny: { bpm: 126, bars: 16, chords: [[65, "maj"], [70, "maj"], [72, "maj"], [65, "maj"]], swing: 0.18, drums: "pulse", lead: "square", padLevel: 0.35 },
  // Minor ostinato with sub pulse — for stories, mysteries, plot twists.
  suspense: { bpm: 92, bars: 12, chords: [[57, "min"], [53, "maj"], [55, "maj"], [52, "maj"]], swing: 0, drums: "trap", lead: "pluck", padLevel: 0.8 },
};

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const triad = (root: number, q: "maj" | "min") => [root, root + (q === "maj" ? 4 : 3), root + 7];

// Tiny deterministic PRNG so every render of a mood sounds the same.
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function render(mood: Mood, seed: number): Float32Array {
  const rand = rng(seed);
  const beat = 60 / mood.bpm;
  const bar = beat * 4;
  const total = mood.bars * bar;
  const out = new Float32Array(Math.ceil(total * SR) + SR);
  const add = (start: number, dur: number, fn: (t: number) => number, gain: number) => {
    const s0 = Math.floor(start * SR);
    const n = Math.floor(dur * SR);
    for (let i = 0; i < n && s0 + i < out.length; i++) out[s0 + i] += fn(i / SR) * gain;
  };
  const swingAt = (step: number) => (step % 2 === 1 ? mood.swing * beat * 0.5 : 0);

  // --- instruments ---
  const kick = (t: number) => Math.sin(2 * Math.PI * (52 * t + 90 * (1 - Math.exp(-t * 28)) / 28)) * Math.exp(-t * 7);
  const noise = () => rand() * 2 - 1;
  let hpPrev = 0;
  let hpOut = 0;
  const hat = (t: number) => {
    const x = noise();
    hpOut = 0.7 * (hpOut + x - hpPrev);
    hpPrev = x;
    return hpOut * Math.exp(-t * 60);
  };
  const snare = (t: number) => (noise() * 0.8 + Math.sin(2 * Math.PI * 185 * t) * 0.5) * Math.exp(-t * 18);
  const bass = (f: number) => (t: number) =>
    (Math.sin(2 * Math.PI * f * t) * 0.8 + Math.sin(2 * Math.PI * f * 2 * t) * 0.2) * Math.min(1, t * 200) * Math.exp(-t * 2.2);
  const pad = (fs: number[]) => (t: number) => {
    let v = 0;
    for (const f of fs) for (const d of [-0.12, 0.12]) v += Math.sin(2 * Math.PI * f * (1 + d / 100) * t + Math.sin(2 * Math.PI * 0.3 * t) * 0.4);
    return (v / (fs.length * 2)) * Math.min(1, t * 1.5) * Math.min(1, (bar - t) * 4);
  };
  const lead = (f: number, kind: Mood["lead"]) => (t: number) => {
    if (kind === "bell") return (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 6)) * Math.exp(-t * 2.5);
    if (kind === "square") return Math.sign(Math.sin(2 * Math.PI * f * t)) * 0.35 * Math.exp(-t * 14);
    // pluck: triangle-ish with fast decay
    return (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * f * t)) * Math.exp(-t * 9);
  };

  for (let b = 0; b < mood.bars; b++) {
    const t0 = b * bar;
    const [root, q] = mood.chords[b % mood.chords.length];
    const notes = triad(root, q);
    const intro = b < 2; // first bars sparse, so the hook voice-over lands clean
    // Pad
    add(t0, bar, pad(notes.map(hz)), 0.16 * mood.padLevel);
    // Bass: root on beats (octave down), syncopated push on "and of 3"
    const bf = hz(root - 24);
    for (const at of [0, 1.5, 2, 3.5].slice(0, mood.drums === "lofi" ? 2 : 4)) add(t0 + at * beat, beat * 0.9, bass(bf), 0.32);
    // Drums
    for (let step = 0; step < 8; step++) {
      const at = t0 + step * beat * 0.5 + swingAt(step);
      const onBeat = step % 2 === 0;
      if (mood.drums === "four" && onBeat) add(at, 0.35, kick, 0.75);
      if (mood.drums === "pulse" && (step === 0 || step === 3 || step === 4)) add(at, 0.35, kick, 0.7);
      if ((mood.drums === "lofi" || mood.drums === "trap") && (step === 0 || step === 5)) add(at, 0.35, kick, 0.7);
      if (!intro && (step === 2 || step === 6)) add(at, 0.25, snare, mood.drums === "lofi" ? 0.18 : 0.26);
      if (!intro) add(at, 0.06, hat, onBeat ? 0.09 : 0.13);
      if (mood.drums === "trap" && !intro && step % 2 === 1) add(at + beat * 0.25, 0.04, hat, 0.08);
    }
    // Lead: arpeggio from chord tones, a little randomness, rests on some steps
    if (mood.lead !== "none" && !intro) {
      const scale = [...notes, notes[0] + 12, notes[1] + 12];
      for (let step = 0; step < 8; step++) {
        if (rand() < (mood.lead === "bell" ? 0.55 : 0.3)) continue;
        const n = scale[Math.floor(rand() * scale.length)] + 12;
        add(t0 + step * beat * 0.5 + swingAt(step), beat * 0.9, lead(hz(n), mood.lead), mood.lead === "bell" ? 0.1 : 0.12);
      }
    }
  }

  // Feedback delay as cheap reverb + soft clip + normalize.
  const d = Math.floor(beat * 0.75 * SR);
  for (let i = d; i < out.length; i++) out[i] += out[i - d] * 0.22;
  let peak = 0;
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.tanh(out[i] * 1.2);
    peak = Math.max(peak, Math.abs(out[i]));
  }
  // Fade the tail so loops don't click.
  const fade = Math.floor(SR * 0.8);
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  const k = 0.9 / (peak || 1);
  for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

function writeWav(file: string, samples: Float32Array) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32000), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

/** Generates two variations per mood (gen-<mood>-<n>.wav) if missing. */
export function ensureMusic(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, mood] of Object.entries(MOODS)) {
    for (const v of [1, 2]) {
      const file = path.join(dir, `gen-${name}-${v}.wav`);
      if (!fs.existsSync(file)) writeWav(file, render(mood, v * 7919 + name.length * 104729));
    }
  }
}

export const MOODS_LIST = Object.keys(MOODS);
