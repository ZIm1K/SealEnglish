// Tiny synthesized sound effects (pop, tick, ding, whoosh) — free, license-clean, generated once.
import fs from "node:fs";
import path from "node:path";

const SR = 44100;

function writeWav(file: string, samples: Float32Array) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32000), i * 2));
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

function synth(seconds: number, fn: (t: number, i: number) => number) {
  const out = new Float32Array(Math.round(SR * seconds));
  for (let i = 0; i < out.length; i++) out[i] = fn(i / SR, i);
  return out;
}

const SOUNDS: Record<string, () => Float32Array> = {
  // Bubbly pop: fast downward pitch sweep.
  pop: () => synth(0.14, (t) => Math.sin(2 * Math.PI * (900 - 3500 * t) * t) * Math.exp(-t * 32) * 0.7),
  // Clock tick for the quiz countdown.
  tick: () => synth(0.05, (t) => Math.sin(2 * Math.PI * 2200 * t) * Math.exp(-t * 120) * 0.5),
  // Bright two-note "correct" chime.
  ding: () =>
    synth(0.7, (t) => {
      const a = Math.sin(2 * Math.PI * 1318.5 * t) * Math.exp(-t * 5);
      const b = t > 0.09 ? Math.sin(2 * Math.PI * 1760 * (t - 0.09)) * Math.exp(-(t - 0.09) * 5) : 0;
      return (a + b) * 0.32;
    }),
  // Soft whoosh: filtered noise with a swell.
  whoosh: () => {
    let prev = 0;
    return synth(0.35, (t) => {
      prev = prev * 0.9 + (Math.random() * 2 - 1) * 0.1;
      return prev * Math.sin((Math.PI * t) / 0.35) * 2.2;
    });
  },
  // Low "wrong" buzz.
  buzz: () => synth(0.3, (t) => Math.sign(Math.sin(2 * Math.PI * 140 * t)) * Math.exp(-t * 9) * 0.18),
};

export function ensureSfx(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, make] of Object.entries(SOUNDS)) {
    const file = path.join(dir, `${name}.wav`);
    if (!fs.existsSync(file)) writeWav(file, make());
  }
}
