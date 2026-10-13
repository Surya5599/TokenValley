/**
 * Low-level synthesis helpers over the Web Audio API. Everything here is
 * procedural: oscillators, a shared noise buffer, filters and gain envelopes.
 * No samples, no assets.
 */

export type Wave = OscillatorType;

/** Master gain of about -14 dB so the engine never dominates a voiceover. */
export const MASTER_GAIN = 0.2;

export interface Graph {
  ctx: AudioContext;
  /** Sound effects bus. */
  sfx: GainNode;
  /** Music bus. */
  music: GainNode;
  /** Shared one-second white noise buffer. */
  noise: AudioBuffer;
}

/** Builds master -> soft limiter -> destination, with separate sfx and music buses. */
export function buildGraph(ctx: AudioContext): Graph {
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

  return { ctx, sfx, music, noise: makeNoise(ctx) };
}

function makeNoise(ctx: AudioContext): AudioBuffer {
  const len = ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo);
export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)] as T;

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
  const offset = Math.random() * (g.noise.duration - o.dur - 0.01);

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
