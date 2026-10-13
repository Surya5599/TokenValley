/**
 * The sound bank. Every cue is a short synthesized gesture: cartoon, tasteful,
 * mostly under a second. Each takes the graph, a start time, and optional
 * parameters, and schedules itself on the context clock, so the same code
 * plays live and renders offline.
 */
import { mtof, noise, pick, rand, shape, tone, type Graph } from "./synth";

export type SfxName =
  // Office verbs.
  | "keys"
  | "tick"
  | "blip"
  | "whoosh"
  | "bell"
  | "tada"
  | "rejected"
  | "pop"
  | "applause"
  | "thunk"
  | "kaching"
  | "alarm"
  | "chime"
  | "clunk"
  | "doorchime"
  | "doorclose"
  | "speech"
  | "dingdong"
  | "pageflip"
  | "wave"
  | "titlecard"
  | "grind"
  | "buzzer"
  // Comedy stingers.
  | "sadTrombone"
  | "boing"
  | "recordScratch"
  | "crickets"
  | "kazooSynergy"
  | "slideUp"
  | "slideDown"
  | "rimshot"
  | "womp"
  | "cowbell"
  | "newtask"
  | "doink"
  | "ding"
  | "cheer"
  // Story cues (aliases with their own rate limits).
  | "jimlook"
  | "talkinghead";

export interface SfxParams {
  /** Base pitch in Hz for `speech`. */
  pitch?: number;
  /** Speaker role for `speech`: picks the two-note pattern. */
  role?: string;
}

/** Minimum gap in ms between two plays of the same cue. */
export const SFX_MIN_GAP: Record<SfxName, number> = {
  keys: 150,
  tick: 100,
  blip: 150,
  whoosh: 300,
  bell: 400,
  tada: 400,
  rejected: 400,
  pop: 250,
  applause: 2000,
  thunk: 500,
  kaching: 500,
  alarm: 2000,
  chime: 400,
  clunk: 400,
  doorchime: 400,
  doorclose: 400,
  speech: 250,
  dingdong: 600,
  pageflip: 200,
  wave: 400,
  titlecard: 1000,
  grind: 800,
  buzzer: 600,
  sadTrombone: 1500,
  boing: 600,
  recordScratch: 800,
  crickets: 2500,
  kazooSynergy: 1200,
  slideUp: 500,
  slideDown: 500,
  rimshot: 600,
  womp: 1000,
  cowbell: 300,
  newtask: 200,
  doink: 300,
  ding: 1000,
  cheer: 2000,
  jimlook: 1500,
  talkinghead: 800,
};

type Cue = (g: Graph, t0: number, p: SfxParams) => void;

/** Speech bleep patterns per role: pitch ratios of the two notes, note length and gap in seconds. */
const SPEECH_PATTERN: Record<string, { ratios: [number, number]; dur: number; gap: number }> = {
  // Michael: a touch pompous, lower and slower, a falling third.
  ceo: { ratios: [1, 0.84], dur: 0.075, gap: 0.1 },
  cfo: { ratios: [1, 0.94], dur: 0.06, gap: 0.085 },
  engineer: { ratios: [1, 1.0], dur: 0.05, gap: 0.075 },
  backend: { ratios: [1, 0.89], dur: 0.05, gap: 0.075 },
  frontend: { ratios: [1, 1.12], dur: 0.05, gap: 0.07 },
  it: { ratios: [1, 0.75], dur: 0.065, gap: 0.09 },
  legal: { ratios: [1, 0.94], dur: 0.06, gap: 0.08 },
  qa: { ratios: [1, 1.06], dur: 0.045, gap: 0.065 },
  hr: { ratios: [1, 1.19], dur: 0.05, gap: 0.07 },
  marketing: { ratios: [1, 1.26], dur: 0.045, gap: 0.065 },
  pm: { ratios: [1, 1.12], dur: 0.05, gap: 0.07 },
  receptionist: { ratios: [1, 1.33], dur: 0.045, gap: 0.065 },
  designer: { ratios: [1, 1.19], dur: 0.05, gap: 0.07 },
  intern: { ratios: [1, 1.5], dur: 0.04, gap: 0.06 },
};
const DEFAULT_PATTERN = { ratios: [1, 1.12] as [number, number], dur: 0.05, gap: 0.07 };

const SFX: Record<SfxName, Cue> = {
  /** Keyboard clatter: 3 to 6 bright noise ticks. */
  keys: (g, t0) => {
    const n = 3 + Math.floor(rand(0, 4));
    let t = t0;
    for (let i = 0; i < n; i++) {
      noise(g, g.sfx, t, { dur: 0.018, gain: rand(0.25, 0.45), filter: "bandpass", freq: rand(2200, 4200), q: 2 });
      t += rand(0.035, 0.07);
    }
  },

  /** One softer tick for a file read. */
  tick: (g, t0) => {
    noise(g, g.sfx, t0, { dur: 0.015, gain: 0.18, filter: "bandpass", freq: 3000, q: 2.5 });
  },

  /** Terminal blip: a rounded square wave with a quick upward chirp. */
  blip: (g, t0) => {
    tone(g, g.sfx, t0, { freq: 900, freqEnd: 1400, wave: "square", dur: 0.07, gain: 0.12, lowpass: 2600 });
  },

  /** Paper whoosh: a noise sweep rising then settling. */
  whoosh: (g, t0) => {
    noise(g, g.sfx, t0, { dur: 0.26, gain: 0.35, attack: 0.08, filter: "bandpass", freq: 500, freqEnd: 3200, q: 1.2, linear: true });
  },

  /** Desk bell: two sine partials with a long decay. */
  bell: (g, t0) => {
    tone(g, g.sfx, t0, { freq: 1760, dur: 0.6, gain: 0.35, attack: 0.002 });
    tone(g, g.sfx, t0, { freq: 1760 * 2.76, dur: 0.35, gain: 0.12, attack: 0.002 });
  },

  /** Approved: an upward two-note ta-da. */
  tada: (g, t0) => {
    tone(g, g.sfx, t0, { freq: mtof(67), wave: "triangle", dur: 0.14, gain: 0.3 });
    tone(g, g.sfx, t0 + 0.13, { freq: mtof(72), wave: "triangle", dur: 0.3, gain: 0.35 });
    tone(g, g.sfx, t0 + 0.13, { freq: mtof(76), wave: "sine", dur: 0.3, gain: 0.15 });
  },

  /** Rejected: a descending two-note "wah". */
  rejected: (g, t0) => {
    tone(g, g.sfx, t0, { freq: mtof(64), wave: "square", dur: 0.15, gain: 0.12, lowpass: 1200 });
    tone(g, g.sfx, t0 + 0.16, { freq: mtof(60), freqEnd: mtof(58), wave: "square", dur: 0.26, gain: 0.12, lowpass: 1000 });
  },

  /** Task done: a pop and a tiny confetti shimmer. */
  pop: (g, t0) => {
    tone(g, g.sfx, t0, { freq: 700, freqEnd: 220, wave: "sine", dur: 0.09, gain: 0.4 });
    for (let i = 0; i < 5; i++) {
      tone(g, g.sfx, t0 + 0.05 + i * 0.035, { freq: rand(2400, 5200), wave: "sine", dur: 0.06, gain: 0.07 });
    }
  },

  /** Shipped: soft applause, many little noise bursts over 1.2 s. */
  applause: (g, t0) => {
    const dur = 1.2;
    let t = t0;
    while (t < t0 + dur) {
      const pos = (t - t0) / dur;
      const env = pos < 0.25 ? pos / 0.25 : 1 - (pos - 0.25) / 0.75;
      noise(g, g.sfx, t, { dur: 0.03, gain: 0.12 * (0.4 + env), filter: "bandpass", freq: rand(1200, 2600), q: 1.5 });
      t += rand(0.012, 0.045);
    }
  },

  /** Budget exhausted (classic): a low "lights off" thunk. */
  thunk: (g, t0) => {
    tone(g, g.sfx, t0, { freq: 130, freqEnd: 45, wave: "sine", dur: 0.22, gain: 0.6 });
    noise(g, g.sfx, t0, { dur: 0.05, gain: 0.3, filter: "lowpass", freq: 400 });
  },

  /** Budget warning (classic): cash register ka-ching. */
  kaching: (g, t0) => {
    noise(g, g.sfx, t0, { dur: 0.03, gain: 0.3, filter: "highpass", freq: 3000 });
    tone(g, g.sfx, t0 + 0.04, { freq: 2500, dur: 0.05, gain: 0.15 });
    tone(g, g.sfx, t0 + 0.11, { freq: 3800, dur: 0.3, gain: 0.3 });
    tone(g, g.sfx, t0 + 0.11, { freq: 3800 * 1.5, dur: 0.22, gain: 0.1 });
  },

  /** Build failed (classic): alternating two-tone alarm for 1.5 s. */
  alarm: (g, t0) => {
    for (let i = 0; i < 10; i++) {
      tone(g, g.sfx, t0 + i * 0.15, { freq: i % 2 ? 620 : 830, wave: "square", dur: 0.13, gain: 0.08, attack: 0.01, lowpass: 1800, linear: true });
    }
  },

  /** Build passed: a bright three-note chime. */
  chime: (g, t0) => {
    const notes = [84, 88, 91];
    notes.forEach((n, i) => tone(g, g.sfx, t0 + i * 0.07, { freq: mtof(n), dur: 0.35, gain: 0.22 }));
  },

  /** Idle timeout: vending machine clunk. */
  clunk: (g, t0) => {
    noise(g, g.sfx, t0, { dur: 0.06, gain: 0.35, filter: "lowpass", freq: 700 });
    tone(g, g.sfx, t0 + 0.02, { freq: 190, freqEnd: 90, wave: "triangle", dur: 0.14, gain: 0.4 });
    noise(g, g.sfx, t0 + 0.12, { dur: 0.04, gain: 0.15, filter: "lowpass", freq: 500 });
  },

  /** Receptionist arrives: a rising door chime. */
  doorchime: (g, t0) => {
    tone(g, g.sfx, t0, { freq: mtof(79), dur: 0.3, gain: 0.25 });
    tone(g, g.sfx, t0 + 0.14, { freq: mtof(83), dur: 0.4, gain: 0.25 });
  },

  /** A soft door close. */
  doorclose: (g, t0) => {
    noise(g, g.sfx, t0, { dur: 0.09, gain: 0.3, attack: 0.01, filter: "lowpass", freq: 900, freqEnd: 300 });
    tone(g, g.sfx, t0 + 0.03, { freq: 95, dur: 0.16, gain: 0.35 });
  },

  /** Speech: a two-note square bleep per role around a per-role pitch. */
  speech: (g, t0, p) => {
    const base = p.pitch ?? 350;
    const pat = (p.role && SPEECH_PATTERN[p.role]) || DEFAULT_PATTERN;
    let t = t0;
    for (const r of pat.ratios) {
      tone(g, g.sfx, t, { freq: base * r * rand(0.97, 1.03), wave: "square", dur: pat.dur, gain: 0.07, lowpass: 2200 });
      t += pat.gap;
    }
  },

  /** Meeting called: a bell-like ding-dong. */
  dingdong: (g, t0) => {
    tone(g, g.sfx, t0, { freq: mtof(76), dur: 0.45, gain: 0.3 });
    tone(g, g.sfx, t0, { freq: mtof(76) * 2.4, dur: 0.2, gain: 0.08 });
    tone(g, g.sfx, t0 + 0.3, { freq: mtof(72), dur: 0.6, gain: 0.3 });
    tone(g, g.sfx, t0 + 0.3, { freq: mtof(72) * 2.4, dur: 0.25, gain: 0.08 });
  },

  /** Persona changed: a tiny page flip. */
  pageflip: (g, t0) => {
    noise(g, g.sfx, t0, { dur: 0.08, gain: 0.25, attack: 0.02, filter: "bandpass", freq: 900, freqEnd: 4500, q: 1.5, linear: true });
  },

  /** Story: a friendly wave, boop-beep. */
  wave: (g, t0) => {
    tone(g, g.sfx, t0, { freq: mtof(69), wave: "triangle", dur: 0.1, gain: 0.25 });
    tone(g, g.sfx, t0 + 0.11, { freq: mtof(76), wave: "triangle", dur: 0.18, gain: 0.25 });
  },

  /** Story: a soft major chord swell for a title card. */
  titlecard: (g, t0) => {
    for (const n of [60, 64, 67, 72]) {
      tone(g, g.sfx, t0, { freq: mtof(n), wave: "triangle", dur: 0.9, gain: 0.1, attack: 0.25, lowpass: 2500 });
    }
  },

  /** Incident sign: printer-jam grind. */
  grind: (g, t0) => {
    tone(g, g.sfx, t0, { freq: 70, freqEnd: 55, wave: "sawtooth", dur: 0.6, gain: 0.12, attack: 0.02, lowpass: 600, linear: true });
    for (let i = 0; i < 10; i++) {
      noise(g, g.sfx, t0 + i * 0.055, { dur: 0.035, gain: 0.18, filter: "bandpass", freq: pick([600, 800, 1100]), q: 3 });
    }
  },

  /** Incident sign: a beating two-oscillator buzzer. */
  buzzer: (g, t0) => {
    tone(g, g.sfx, t0, { freq: 150, wave: "square", dur: 0.4, gain: 0.09, attack: 0.01, lowpass: 1200, linear: true });
    tone(g, g.sfx, t0, { freq: 156, wave: "square", dur: 0.4, gain: 0.09, attack: 0.01, lowpass: 1200, linear: true });
  },

  // ---- comedy stingers ----

  /** Sad trombone: three descending "wah"s, the last one drooping in pitch. About 1.4 s. */
  sadTrombone: (g, t0) => {
    const notes: [number, number, number][] = [
      [0, 58, 0.3],
      [0.34, 56, 0.3],
      [0.68, 54, 0.72],
    ];
    for (const [dt, n, dur] of notes) {
      const last = dt > 0.6;
      const f = mtof(n);
      // Two slightly detuned saws through a lowpass that opens and closes: the "wah".
      for (const det of [0.996, 1.004]) {
        tone(g, g.sfx, t0 + dt, { freq: f * det, freqEnd: last ? f * 0.8 : f * det, wave: "sawtooth", dur, gain: 0.11, attack: 0.03, lowpass: 420, lowpassEnd: last ? 300 : 1500, linear: true });
      }
    }
  },

  /** Boing: a spring, pitch bends up fast then wobbles down. */
  boing: (g, t0) => {
    shape(g, g.sfx, t0, {
      wave: "triangle",
      points: [
        [0, 160],
        [0.07, 720],
        [0.14, 480],
        [0.21, 640],
        [0.28, 520],
        [0.35, 600],
        [0.45, 560],
        [0.6, 580],
      ],
      dur: 0.62,
      gain: 0.35,
      lowpass: 2600,
    });
    noise(g, g.sfx, t0, { dur: 0.03, gain: 0.12, filter: "bandpass", freq: 1500, q: 1.5 });
  },

  /** Record scratch: a fast noise sweep down with a stutter. 0.5 s. */
  recordScratch: (g, t0) => {
    noise(g, g.sfx, t0, { dur: 0.3, gain: 0.45, attack: 0.005, filter: "bandpass", freq: 3200, freqEnd: 320, q: 1.8, linear: true });
    tone(g, g.sfx, t0, { freq: 900, freqEnd: 130, wave: "sawtooth", dur: 0.28, gain: 0.08, lowpass: 2200, linear: true });
    // The stutter: three short re-hits on the way out.
    for (const dt of [0.3, 0.38, 0.45]) {
      noise(g, g.sfx, t0 + dt, { dur: 0.05, gain: 0.3, filter: "bandpass", freq: 1400, freqEnd: 500, q: 1.6 });
    }
  },

  /** Crickets: two alternating high chirps repeating for 2.5 s. */
  crickets: (g, t0) => {
    let t = t0;
    let side = 0;
    while (t < t0 + 2.4) {
      const f = side ? 4650 : 4200;
      // A chirp is three very short pulses.
      for (let i = 0; i < 3; i++) {
        tone(g, g.sfx, t + i * 0.022, { freq: f, dur: 0.012, gain: 0.07, attack: 0.002 });
      }
      side ^= 1;
      t += 0.27;
    }
  },

  /** Kazoo synergy: a buzzy reed with vibrato playing a three-note rising lick. 0.7 s. */
  kazooSynergy: (g, t0) => {
    const notes: [number, number][] = [
      [0, 62],
      [0.22, 66],
      [0.44, 69],
    ];
    for (const [dt, n] of notes) {
      const f = mtof(n);
      const dur = dt > 0.4 ? 0.3 : 0.22;
      shape(g, g.sfx, t0 + dt, { wave: "square", points: [[0, f]], dur, gain: 0.07, attack: 0.02, vibrato: { rate: 9, depth: f * 0.03 }, lowpass: 2200, linear: true });
      shape(g, g.sfx, t0 + dt, { wave: "sawtooth", points: [[0, f * 1.005]], dur, gain: 0.06, attack: 0.02, vibrato: { rate: 9, depth: f * 0.03 }, lowpass: 2600, linear: true });
    }
  },

  /** Slide whistle up: a hire walks in. */
  slideUp: (g, t0) => {
    shape(g, g.sfx, t0, { wave: "sine", points: [[0, 420], [0.42, 1300]], dur: 0.5, gain: 0.3, attack: 0.02, lowpass: 3000 });
    noise(g, g.sfx, t0, { dur: 0.45, gain: 0.05, attack: 0.05, filter: "bandpass", freq: 900, freqEnd: 2400, q: 1.2, linear: true });
  },

  /** Slide whistle down: someone leaves. */
  slideDown: (g, t0) => {
    shape(g, g.sfx, t0, { wave: "sine", points: [[0, 1300], [0.42, 380]], dur: 0.5, gain: 0.3, attack: 0.02, lowpass: 3000 });
    noise(g, g.sfx, t0, { dur: 0.45, gain: 0.05, attack: 0.05, filter: "bandpass", freq: 2400, freqEnd: 800, q: 1.2, linear: true });
  },

  /** Rimshot: snare hit, then a cymbal tick. */
  rimshot: (g, t0) => {
    noise(g, g.sfx, t0, { dur: 0.13, gain: 0.4, filter: "bandpass", freq: 1800, q: 0.7 });
    tone(g, g.sfx, t0, { freq: 190, freqEnd: 90, wave: "sine", dur: 0.09, gain: 0.35 });
    noise(g, g.sfx, t0 + 0.1, { dur: 0.17, gain: 0.14, filter: "highpass", freq: 7500 });
  },

  /** Womp womp: two low drooping notes. */
  womp: (g, t0) => {
    tone(g, g.sfx, t0, { freq: 115, freqEnd: 98, wave: "square", dur: 0.3, gain: 0.14, attack: 0.02, lowpass: 500, lowpassEnd: 300, linear: true });
    tone(g, g.sfx, t0 + 0.36, { freq: 92, freqEnd: 68, wave: "square", dur: 0.55, gain: 0.14, attack: 0.02, lowpass: 500, lowpassEnd: 220, linear: true });
  },

  /** Cowbell: two inharmonic squares with a quick decay. */
  cowbell: (g, t0) => {
    tone(g, g.sfx, t0, { freq: 587, wave: "square", dur: 0.28, gain: 0.12, attack: 0.002, lowpass: 1400 });
    tone(g, g.sfx, t0, { freq: 845, wave: "square", dur: 0.22, gain: 0.1, attack: 0.002, lowpass: 1400 });
  },

  /** Task created: a tiny page flip and a pen click. */
  newtask: (g, t0) => {
    noise(g, g.sfx, t0, { dur: 0.07, gain: 0.2, attack: 0.015, filter: "bandpass", freq: 900, freqEnd: 4200, q: 1.5, linear: true });
    noise(g, g.sfx, t0 + 0.11, { dur: 0.012, gain: 0.35, filter: "highpass", freq: 3500 });
    tone(g, g.sfx, t0 + 0.11, { freq: 2600, dur: 0.02, gain: 0.12 });
  },

  /** Task blocked: a cartoon doink, a muted xylophone note that sags. */
  doink: (g, t0) => {
    tone(g, g.sfx, t0, { freq: 1040, freqEnd: 700, wave: "sine", dur: 0.2, gain: 0.32, attack: 0.002 });
    tone(g, g.sfx, t0, { freq: 1040 * 2.7, dur: 0.05, gain: 0.06, attack: 0.002 });
  },

  /** Kettle-ish ding for shipping. */
  ding: (g, t0) => {
    tone(g, g.sfx, t0, { freq: 2093, dur: 1.2, gain: 0.3, attack: 0.002 });
    tone(g, g.sfx, t0, { freq: 2093 * 1.5, dur: 0.6, gain: 0.08, attack: 0.002 });
    tone(g, g.sfx, t0, { freq: 2093 * 2.4, dur: 0.4, gain: 0.06, attack: 0.002 });
  },

  /** A short crowd cheer: six "voices" of formant-filtered noise that rise. */
  cheer: (g, t0) => {
    for (let i = 0; i < 6; i++) {
      const f = rand(380, 900);
      const dt = rand(0, 0.22);
      noise(g, g.sfx, t0 + dt, { dur: rand(0.55, 0.85), gain: 0.11, attack: 0.09, filter: "bandpass", freq: f, freqEnd: f * 1.35, q: 4, linear: true });
      noise(g, g.sfx, t0 + dt, { dur: 0.6, gain: 0.05, attack: 0.09, filter: "bandpass", freq: f * 2.6, freqEnd: f * 3.2, q: 3, linear: true });
    }
  },

  /** Story: Jim looks down the lens. A record scratch. */
  jimlook: (g, t0, p) => SFX.recordScratch(g, t0, p),

  /** Story: a talking-head caption appears. A rimshot. */
  talkinghead: (g, t0, p) => SFX.rimshot(g, t0, p),
};

export function playSfx(g: Graph, name: SfxName, t0: number, params: SfxParams = {}): void {
  SFX[name](g, t0, params);
}

export const SFX_NAMES = Object.keys(SFX) as SfxName[];
