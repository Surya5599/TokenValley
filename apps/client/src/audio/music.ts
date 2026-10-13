/**
 * An original, gentle 8-bar loop in C major at 92 BPM: a triangle-wave
 * "synth piano" arpeggio, a soft sine bass and a brushed hi-hat from noise.
 * Notes are scheduled ahead on the AudioContext clock so the loop is seamless.
 */
import { mtof, noise, tone, type Graph } from "./synth";

const BPM = 92;
const BEAT = 60 / BPM;
const STEP = BEAT / 4; // sixteenth
const STEPS_PER_BAR = 16;
const BARS = 8;
const LOOP_STEPS = STEPS_PER_BAR * BARS;
/** How far ahead notes are scheduled, in seconds. */
const LOOKAHEAD = 0.35;

/** Chord per bar as MIDI notes (root, third, fifth, octave): I vi IV V I iii IV V. */
const CHORDS: number[][] = [
  [60, 64, 67, 72], // C
  [57, 60, 64, 69], // Am
  [53, 57, 60, 65], // F
  [55, 59, 62, 67], // G
  [60, 64, 67, 72], // C
  [52, 55, 59, 64], // Em
  [53, 57, 60, 65], // F
  [55, 59, 62, 67], // G
];

/** Arpeggio pattern over the chord tones, one entry per eighth note. */
const ARP: number[] = [0, 2, 3, 2, 1, 2, 3, 2];

/** A small melody over the last two bars so the loop has a turnaround. One note per eighth, -1 is a rest. */
const MELODY_TAIL: number[] = [76, -1, 74, -1, 72, 74, 76, -1, 79, -1, 77, -1, 76, -1, 74, -1];

export class MusicLoop {
  private step = 0;
  private nextTime = 0;
  private running = false;
  private readonly gain: GainNode;

  constructor(private readonly g: Graph) {
    this.gain = g.ctx.createGain();
    this.gain.gain.value = 1;
    this.gain.connect(g.music);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.step = 0;
    this.nextTime = this.g.ctx.currentTime + 0.05;
    this.g.music.gain.cancelScheduledValues(this.g.ctx.currentTime);
    this.g.music.gain.setValueAtTime(0.0001, this.g.ctx.currentTime);
    this.g.music.gain.exponentialRampToValueAtTime(0.55, this.g.ctx.currentTime + 1.2);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const t = this.g.ctx.currentTime;
    this.g.music.gain.cancelScheduledValues(t);
    this.g.music.gain.setValueAtTime(Math.max(0.0001, this.g.music.gain.value), t);
    this.g.music.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Call every frame: schedules any steps that fall inside the lookahead window. */
  update(): void {
    if (!this.running) return;
    const now = this.g.ctx.currentTime;
    // If the tab slept and we fell far behind, jump rather than spray notes.
    if (this.nextTime < now - 0.5) this.nextTime = now + 0.05;
    while (this.nextTime < now + LOOKAHEAD) {
      this.schedule(this.step, this.nextTime);
      this.step = (this.step + 1) % LOOP_STEPS;
      this.nextTime += STEP;
    }
  }

  private schedule(step: number, t: number): void {
    const g = this.g;
    const bar = Math.floor(step / STEPS_PER_BAR);
    const inBar = step % STEPS_PER_BAR;
    const chord = CHORDS[bar] ?? CHORDS[0]!;

    // Hi-hat: every eighth, brushed and quiet, a little louder on the offbeat.
    if (inBar % 2 === 0) {
      const off = inBar % 4 === 2;
      noise(g, this.gain, t, { dur: off ? 0.07 : 0.045, gain: off ? 0.09 : 0.06, attack: 0.004, filter: "highpass", freq: 7000, q: 0.7 });
    }

    // Bass: root on beat 1, fifth on beat 3, soft sine with a touch of triangle.
    if (inBar === 0 || inBar === 8) {
      const n = (inBar === 0 ? chord[0]! : chord[2]!) - 12;
      tone(g, this.gain, t, { freq: mtof(n), wave: "sine", dur: BEAT * 1.6, gain: 0.3, attack: 0.01 });
      tone(g, this.gain, t, { freq: mtof(n), wave: "triangle", dur: BEAT * 0.9, gain: 0.08, attack: 0.01, lowpass: 500 });
    }

    // Piano arpeggio: one note per eighth.
    if (inBar % 2 === 0) {
      const idx = ARP[inBar / 2] ?? 0;
      const n = chord[idx] ?? chord[0]!;
      tone(g, this.gain, t, { freq: mtof(n), wave: "triangle", dur: BEAT * 0.9, gain: 0.16, attack: 0.006, lowpass: 3200 });
      // A quiet sine an octave up gives it the "felt piano" sheen.
      tone(g, this.gain, t, { freq: mtof(n + 12), wave: "sine", dur: BEAT * 0.5, gain: 0.03, attack: 0.006 });
    }

    // Melody turnaround on bars 7 and 8.
    if (bar >= 6 && inBar % 2 === 0) {
      const m = MELODY_TAIL[(bar - 6) * 8 + inBar / 2] ?? -1;
      if (m > 0) tone(g, this.gain, t, { freq: mtof(m), wave: "triangle", dur: BEAT * 0.8, gain: 0.12, attack: 0.008, lowpass: 3600 });
    }
  }
}
