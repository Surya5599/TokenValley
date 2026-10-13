/**
 * Offline render of an episode's sound: the recorded cue list and the
 * ambience bed are scheduled into an OfflineAudioContext through the same
 * master chain as live playback, rendered, and encoded as a 16-bit WAV.
 */
import { scheduleAmbience } from "./ambience";
import type { CueRecord } from "./engine";
import { playSfx } from "./sfx";
import { buildGraph, seededRandom, setRandom } from "./synth";

export const RENDER_RATE = 48000;
/** Silence appended after the last beat so tails ring out. */
const TAIL_SECONDS = 1.5;
const DEFAULT_SEED = 0x70ab1e;

export interface RenderOptions {
  seed?: number;
  /** Skip the ambience bed (cues only). */
  ambience?: boolean;
}

/** Renders the cues plus the ambience bed for `duration` seconds. Deterministic for a given seed. */
export async function renderCues(cues: readonly CueRecord[], duration: number, opts: RenderOptions = {}): Promise<AudioBuffer> {
  const Ctor = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctor) throw new Error("OfflineAudioContext is not available");
  const total = duration + TAIL_SECONDS;
  const ctx = new Ctor(2, Math.ceil(RENDER_RATE * total), RENDER_RATE);

  // Seeded randomness for the whole scheduling pass (noise buffer, tick spacing, phone calls).
  setRandom(seededRandom(opts.seed ?? DEFAULT_SEED));
  try {
    const graph = buildGraph(ctx);
    if (opts.ambience !== false) scheduleAmbience(graph, 0, total);
    for (const c of cues) {
      if (c.time < 0 || c.time > total) continue;
      playSfx(graph, c.name, c.time, c.params);
    }
  } finally {
    setRandom(null);
  }
  return ctx.startRendering();
}

/** Export peak level: the master chain sits at -14 dB for live mixing under a voiceover; the file is lifted to this. */
export const EXPORT_PEAK_DB = -6;

/** Scales the buffer in place so its peak sits at `peakDb` dBFS. Silence is left alone. */
export function normalizePeak(buffer: AudioBuffer, peakDb = EXPORT_PEAK_DB): number {
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i] as number);
      if (a > peak) peak = a;
    }
  }
  if (peak <= 0) return 1;
  const gain = Math.pow(10, peakDb / 20) / peak;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = (d[i] as number) * gain;
  }
  return gain;
}

/** Encodes an AudioBuffer as a 16-bit PCM WAV. */
export function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const rate = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign;
  const out = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(out);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, dataBytes, true);

  const data = new Int16Array(out, 44, frames * channels);
  const chans: Float32Array[] = [];
  for (let c = 0; c < channels; c++) chans.push(buffer.getChannelData(c));
  let i = 0;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, (chans[c] as Float32Array)[f] ?? 0));
      data[i++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
  }
  return out;
}

/** Base64 of a byte buffer, in chunks so large files do not blow the call stack. */
export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const parts: string[] = [];
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]));
  }
  return btoa(parts.join(""));
}

/** Peak and RMS of a rendered buffer, in dBFS, for checking a render. */
export function measure(buffer: AudioBuffer): { peakDb: number; rmsDb: number; seconds: number } {
  let peak = 0;
  let sum = 0;
  let n = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = d[i] as number;
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
      n++;
    }
  }
  const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  return { peakDb: db(peak), rmsDb: db(Math.sqrt(sum / Math.max(1, n))), seconds: buffer.duration };
}
