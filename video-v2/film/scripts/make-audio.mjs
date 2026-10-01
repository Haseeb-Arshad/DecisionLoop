// Generates the film's score as a WAV, entirely from code: a quiet pad whose
// chord follows the scenes, soft ticks when decisions appear, a low pulse when
// the water crosses the line and when decisions are flagged, a chime on the title.
// Deterministic: same input, same file.
import fs from "node:fs";
import path from "node:path";

const RATE = 44100;
const FPS = 30;
// Must match src/theme.ts.
const LEN = { opening: 300, builds: 450, rise: 450, engine: 816, asks: 420, decide: 420, closing: 330 };
const XFADE = 15;
const order = Object.keys(LEN);
const START = {};
order.forEach((n, i) => (START[n] = i === 0 ? 0 : START[order[i - 1]] + LEN[order[i - 1]] - XFADE));
const TOTAL = START.closing + LEN.closing;
const sec = (frame) => frame / FPS;
const duration = sec(TOTAL);
const N = Math.ceil(duration * RATE);
const L = new Float32Array(N);
const R = new Float32Array(N);

const hz = (note) => 440 * Math.pow(2, (note - 69) / 12);
// [start s, end s, MIDI notes]
const chords = [
  [0, sec(START.builds) + 1, [45, 52, 60, 64]], // A minor, calm
  [sec(START.builds), sec(START.rise) + 1, [41, 48, 57, 60]], // F major, building
  [sec(START.rise), sec(START.engine) + 1, [38, 45, 53, 64]], // D minor add9, unease
  [sec(START.engine), sec(START.asks) + 1, [45, 52, 59, 64]], // A sus, working
  [sec(START.asks), sec(START.decide) + 1, [48, 55, 64, 67]], // C major, a clear answer
  [sec(START.decide), sec(START.closing) + 1, [41, 48, 57, 64]], // F major 7, people decide
  [sec(START.closing), duration, [48, 55, 64, 72]], // C major, resolved
];

function pad(start, end, notes) {
  const a = Math.floor(start * RATE);
  const b = Math.min(N, Math.floor(end * RATE));
  const attack = 1.6 * RATE;
  const release = 1.6 * RATE;
  for (let i = a; i < b; i++) {
    const t = i / RATE;
    const env = Math.min(1, (i - a) / attack) * Math.min(1, (b - i) / release);
    let s = 0;
    for (const [k, n] of notes.entries()) {
      const f = hz(n);
      const amp = k === 0 ? 0.5 : 0.32;
      s += amp * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 1.004 * t) + 0.12 * Math.sin(2 * Math.PI * 2 * f * t));
    }
    // A slow swell so the bed breathes.
    const swell = 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.07 * t);
    L[i] += s * env * swell * 0.045;
    R[i] += s * env * swell * 0.045 * (0.92 + 0.08 * Math.sin(2 * Math.PI * 0.05 * t));
  }
}

function tone(at, f, length, amp, decay) {
  const a = Math.floor(at * RATE);
  const b = Math.min(N, a + Math.floor(length * RATE));
  for (let i = a; i < b; i++) {
    const t = (i - a) / RATE;
    const env = Math.exp(-t * decay) * Math.min(1, t * 400);
    const s = amp * env * Math.sin(2 * Math.PI * f * t);
    L[i] += s;
    R[i] += s;
  }
}

const tick = (at) => tone(at, 1320, 0.12, 0.08, 38);
const pulse = (at) => {
  tone(at, 62, 1.6, 0.34, 2.6);
  tone(at, 124, 1.0, 0.1, 4);
};
const chime = (at) => {
  tone(at, hz(72), 3.5, 0.09, 1.1);
  tone(at + 0.08, hz(79), 3.5, 0.06, 1.2);
  tone(at + 0.16, hz(84), 3.5, 0.045, 1.3);
};

for (const [s, e, n] of chords) pad(s, e, n);
// Decisions appear (Builds: frames 54 + i*26).
for (let i = 0; i < 4; i++) tick(sec(START.builds + 54 + i * 26));
// The water crosses 2.4 m in the rise scene (about 2.9 s into a 5 s rise that starts at 2.6 s).
pulse(sec(START.rise) + 5.5);
// Engine: the four decisions are flagged one after another near the end of the scene.
for (let i = 0; i < 4; i++) tick(sec(START.engine) + 21.9 + i * 0.35);
pulse(sec(START.engine) + 21.9);
// The agent is told to stop.
pulse(sec(START.asks + 190));
// The title.
chime(sec(START.closing) + 6.1);

// Fade the ends, normalise to -14 dBFS peak.
const fadeIn = 0.6 * RATE;
const fadeOut = 2.0 * RATE;
let peak = 0;
for (let i = 0; i < N; i++) {
  const g = Math.min(1, i / fadeIn) * Math.min(1, (N - i) / fadeOut);
  L[i] *= g;
  R[i] *= g;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const target = Math.pow(10, -14 / 20);
const gain = peak > 0 ? target / peak : 1;

const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + N * 4, 4);
buf.write("WAVE", 8);
buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(RATE, 24);
buf.writeUInt32LE(RATE * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36);
buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * gain * 32767))), 44 + i * 4);
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * gain * 32767))), 46 + i * 4);
}
const out = path.join(import.meta.dirname, "..", "public", "audio", "score.wav");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, buf);
console.log(`score.wav: ${duration.toFixed(2)} s, ${(buf.length / 1e6).toFixed(1)} MB`);
