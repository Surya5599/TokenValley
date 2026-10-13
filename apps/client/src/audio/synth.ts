/**
 * Low-level synthesis helpers over the Web Audio API. Everything here is
 * procedural: oscillators, a shared noise buffer, filters and gain envelopes.
 * No samples, no assets.
 *
 * Every primitive takes a `Graph` (any BaseAudioContext, live or offline), an
 * output node and an absolute start time, so the same cue code plays live and
 * renders into an OfflineAudioContext for the episode export.
 */

export type Wave = OscillatorType;

/** Master gain of about -14 dB so the engine never dominates a voiceover. */
export const MASTER_GAIN = 0.2;

export interface Graph {
  ctx: BaseAudioContext;
  /** Sound effects bus. */
  sfx: GainNode;
  /** Music bus. */
  music: GainNode;
  /** Ambience bus (the office bed in the offline render). */
  ambience: GainNode;
  /** Shared one-second white noise buffer. */
  noise: AudioBuffer;
}

// ---- randomness ----
// Cues sprinkle small random variations (tick spacing, noise offsets). Live
// playback uses Math.random; the offline render swaps in a seeded generator
// so an export is bit-for-bit repeatable.

let random: () => number = Math.random;

/** Replaces the random source used by `rand`, `pick` and the noise primitive. Pass null to restore Math.random. */
export function setRandom(fn: (() => number) | null): void {
  random = fn ?? Math.random;
}

/** A small, fast seeded PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (lo: number, hi: number): number => lo + random() * (hi - lo);
export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)] as T;

/** Builds master -> soft limiter -> destination, with separate sfx, music and ambience buses. */
export function buildGraph(ctx: BaseAudioContext): Graph {
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;

  // Soft limiter: gentle ratio, fast attack, so bursts of overlapping cues stay tame.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -18;
  limiter.knee.value = 12;
  limiter.ratio.value = 6;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;

  master.connect(limiter);
  limiter.connect(ctx.destination);

  const sfx = ctx.createGain();
  sfx.gain.value = 1;
  sfx.connect(master);

  const music = ctx.createGain();
  music.gain.value = 0;
  music.connect(master);

  const ambience = ctx.createGain();
  ambience.gain.value = 1;
  ambience.connect(master);

  return { ctx, sfx, music, ambience, noise: makeNoise(ctx) };
}

function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const len = ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = random() * 2 - 1;
  return buf;
}

export interface ToneOpts {
  freq: number;
  /** Frequency at the end of the note, exponential glide. */
  freqEnd?: number;
  wave?: Wave;
  /** Seconds. */
  dur: number;
  gain?: number;
  attack?: number;
  /** Lowpass cutoff in Hz; omit for none. */
  lowpass?: number;
  /** Lowpass cutoff at the end of the note (a filter sweep, "wah"). */
  lowpassEnd?: number;
  /** Exponential (default) or linear release. */
  linear?: boolean;
}

/** One enveloped oscillator note starting at `t0`, routed into `out`. */
export function tone(g: Graph, out: AudioNode, t0: number, o: ToneOpts): void {
  const { ctx } = g;
  const osc = ctx.createOscillator();
  osc.type = o.wave ?? "sine";
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t0 + o.dur);

  const env = ctx.createGain();
  const peak = o.gain ?? 0.5;
  const attack = o.attack ?? 0.004;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + attack);
  if (o.linear) env.gain.linearRampToValueAtTime(0.0001, t0 + o.dur);
  else env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

  let head: AudioNode = osc;
  if (o.lowpass !== undefined) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(o.lowpass, t0);
    if (o.lowpassEnd !== undefined) lp.frequency.exponentialRampToValueAtTime(Math.max(20, o.lowpassEnd), t0 + o.dur);
    head.connect(lp);
    head = lp;
  }
  head.connect(env);
  env.connect(out);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.02);
}

export interface ShapeOpts {
  wave?: Wave;
  /** Frequency breakpoints as [secondsFromStart, hz]; the first should be at 0. Exponential glides between them. */
  points: [number, number][];
  /** Seconds; the envelope release ends here. */
  dur: number;
  gain?: number;
  attack?: number;
  /** Vibrato on the pitch. */
  vibrato?: { rate: number; depth: number };
  lowpass?: number;
  linear?: boolean;
}

/** An oscillator whose pitch follows a breakpoint curve: springs, slide whistles, reed licks. */
export function shape(g: Graph, out: AudioNode, t0: number, o: ShapeOpts): void {
  const { ctx } = g;
  const osc = ctx.createOscillator();
  osc.type = o.wave ?? "sine";
  const first = o.points[0];
  osc.frequency.setValueAtTime(Math.max(1, first ? first[1] : 440), t0);
  for (let i = 1; i < o.points.length; i++) {
    const p = o.points[i] as [number, number];
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, p[1]), t0 + p[0]);
  }

  if (o.vibrato) {
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = o.vibrato.rate;
    const depth = ctx.createGain();
    depth.gain.value = o.vibrato.depth;
    lfo.connect(depth);
    depth.connect(osc.frequency);
    lfo.start(t0);
    lfo.stop(t0 + o.dur + 0.02);
  }

  const env = ctx.createGain();
  const peak = o.gain ?? 0.4;
  const attack = o.attack ?? 0.005;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + attack);
  if (o.linear) env.gain.linearRampToValueAtTime(0.0001, t0 + o.dur);
  else env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

  let head: AudioNode = osc;
  if (o.lowpass !== undefined) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = o.lowpass;
    head.connect(lp);
    head = lp;
  }
  head.connect(env);
  env.connect(out);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.02);
}

export interface NoiseOpts {
  dur: number;
  gain?: number;
  attack?: number;
  filter?: BiquadFilterType;
  /** Filter centre/cutoff in Hz. */
  freq?: number;
  /** Filter frequency at the end, exponential sweep. */
  freqEnd?: number;
  q?: number;
  linear?: boolean;
}

/** One filtered noise burst starting at `t0`, routed into `out`. */
export function noise(g: Graph, out: AudioNode, t0: number, o: NoiseOpts): void {
  const { ctx } = g;
  const src = ctx.createBufferSource();
  src.buffer = g.noise;
  src.loop = true;
  // Random start so overlapping bursts never share a waveform.
  const offset = random() * Math.max(0, g.noise.duration - Math.min(o.dur, g.noise.duration * 0.5) - 0.01);

  const env = ctx.createGain();
  const peak = o.gain ?? 0.3;
  const attack = o.attack ?? 0.002;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + attack);
  if (o.linear) env.gain.linearRampToValueAtTime(0.0001, t0 + o.dur);
  else env.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

  let head: AudioNode = src;
  if (o.filter) {
    const f = ctx.createBiquadFilter();
    f.type = o.filter;
    f.frequency.setValueAtTime(o.freq ?? 1000, t0);
    if (o.freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t0 + o.dur);
    f.Q.value = o.q ?? 1;
    head.connect(f);
    head = f;
  }
  head.connect(env);
  env.connect(out);
  src.start(t0, Math.max(0, offset));
  src.stop(t0 + o.dur + 0.02);
}

/** MIDI note number to Hz. */
export const mtof = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);
