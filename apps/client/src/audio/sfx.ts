/**
 * The sound bank. Every cue is a short synthesized gesture: cartoon, tasteful,
 * mostly under 300 ms. Each takes the graph, a start time, and optional
 * parameters, and schedules itself on the AudioContext clock.
 */
import { mtof, noise, pick, rand, tone, type Graph } from "./synth";

export type SfxName =
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
  | "buzzer";

export interface SfxParams {
  /** Base pitch in Hz for `speech`. */
  pitch?: number;
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
};

type Cue = (g: Graph, t0: number, p: SfxParams) => void;

const SFX: Record<SfxName, Cue> = {
  /** Keyboard clatter: 3 to 6 bright noise ticks. */
  keys: (g, t0) => {
    const n = 3 + Math.floor(Math.random() * 4);
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

  /** Budget exhausted: a low "lights off" thunk. */
  thunk: (g, t0) => {
    tone(g, g.sfx, t0, { freq: 130, freqEnd: 45, wave: "sine", dur: 0.22, gain: 0.6 });
    noise(g, g.sfx, t0, { dur: 0.05, gain: 0.3, filter: "lowpass", freq: 400 });
  },

  /** Budget warning: cash register ka-ching. */
  kaching: (g, t0) => {
    noise(g, g.sfx, t0, { dur: 0.03, gain: 0.3, filter: "highpass", freq: 3000 });
    tone(g, g.sfx, t0 + 0.04, { freq: 2500, dur: 0.05, gain: 0.15 });
    tone(g, g.sfx, t0 + 0.11, { freq: 3800, dur: 0.3, gain: 0.3 });
    tone(g, g.sfx, t0 + 0.11, { freq: 3800 * 1.5, dur: 0.22, gain: 0.1 });
  },

  /** Build failed: alternating two-tone alarm for 1.5 s. */
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

  /** Agent spawned: a rising door chime. */
  doorchime: (g, t0) => {
    tone(g, g.sfx, t0, { freq: mtof(79), dur: 0.3, gain: 0.25 });
    tone(g, g.sfx, t0 + 0.14, { freq: mtof(83), dur: 0.4, gain: 0.25 });
  },

  /** Agent retired: a soft door close. */
  doorclose: (g, t0) => {
    noise(g, g.sfx, t0, { dur: 0.09, gain: 0.3, attack: 0.01, filter: "lowpass", freq: 900, freqEnd: 300 });
    tone(g, g.sfx, t0 + 0.03, { freq: 95, dur: 0.16, gain: 0.35 });
  },

  /** Speech: three short square bleeps around a per-role pitch. */
  speech: (g, t0, p) => {
    const base = p.pitch ?? 350;
    let t = t0;
    for (let i = 0; i < 3; i++) {
      tone(g, g.sfx, t, { freq: base * rand(0.85, 1.25), wave: "square", dur: 0.045, gain: 0.07, lowpass: 2200 });
      t += rand(0.06, 0.09);
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
};

export function playSfx(g: Graph, name: SfxName, t0: number, params: SfxParams = {}): void {
  SFX[name](g, t0, params);
}

export const SFX_NAMES = Object.keys(SFX) as SfxName[];
