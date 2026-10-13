/**
 * The office ambience bed: a fluorescent hum, a distant phone now and then,
 * a chair creak, a far-off keyboard. Everything is scheduled up front for a
 * fixed duration, so it renders into an OfflineAudioContext. It draws on the
 * synth module's random source, which the export seeds, so the same episode
 * always gets the same phone calls.
 *
 * Levels are set so the bed is felt rather than heard under a voiceover:
 * the whole bus sits about -30 dBFS after the master.
 */
import { noise, rand, tone, type Graph } from "./synth";

/** Ambience bus level relative to the sfx bus (about -14 dB; the master adds another -14 dB). */
const BED_GAIN = 0.2;

/** Schedules the bed from `t0` for `duration` seconds into the graph's ambience bus. */
export function scheduleAmbience(g: Graph, t0: number, duration: number): void {
  const { ctx } = g;
  const bus = ctx.createGain();
  bus.gain.value = BED_GAIN;
  bus.connect(g.ambience);
  const end = t0 + duration;

  // ---- fluorescent hum: low filtered noise plus a faint 120 Hz with its second harmonic ----
  {
    const src = ctx.createBufferSource();
    src.buffer = g.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 170;
    lp.Q.value = 0.6;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(0.5, t0 + 1.5);
    env.gain.setValueAtTime(0.5, Math.max(t0 + 1.5, end - 1));
    env.gain.linearRampToValueAtTime(0.0001, end);
    src.connect(lp);
    lp.connect(env);
    env.connect(bus);
    src.start(t0);
    src.stop(end + 0.05);

    for (const [f, gain] of [
      [120, 0.09],
      [240, 0.025],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0.0001, t0);
      g2.gain.linearRampToValueAtTime(gain, t0 + 1.5);
      g2.gain.setValueAtTime(gain, Math.max(t0 + 1.5, end - 1));
      g2.gain.linearRampToValueAtTime(0.0001, end);
      osc.connect(g2);
      g2.connect(bus);
      osc.start(t0);
      osc.stop(end + 0.05);
    }
  }

  // ---- distant phone: two short pulses, every 20 to 40 s ----
  for (let t = t0 + rand(8, 18); t < end - 1.2; t += rand(20, 40)) phoneRing(g, bus, t);

  // ---- chair creak now and then ----
  for (let t = t0 + rand(4, 10); t < end - 0.5; t += rand(11, 24)) chairCreak(g, bus, t);

  // ---- a far-off keyboard ----
  for (let t = t0 + rand(2, 6); t < end - 1; t += rand(5, 12)) farKeyboard(g, bus, t);
}

/** One "brr-ring, brr-ring": each pulse is a 25 Hz tremolo over two sine tones, far away through a lowpass. */
function phoneRing(g: Graph, out: AudioNode, t0: number): void {
  for (const pulse of [0, 0.6]) {
    for (let i = 0; i < 9; i++) {
      const t = t0 + pulse + i * 0.04;
      tone(g, out, t, { freq: 1040, dur: 0.028, gain: 0.07, attack: 0.004, lowpass: 1600, linear: true });
      tone(g, out, t, { freq: 1320, dur: 0.028, gain: 0.05, attack: 0.004, lowpass: 1600, linear: true });
    }
  }
}

/** A chair creak: a sagging sawtooth plus a touch of noise. */
function chairCreak(g: Graph, out: AudioNode, t0: number): void {
  const f = rand(140, 200);
  tone(g, out, t0, { freq: f, freqEnd: f * 0.7, wave: "sawtooth", dur: rand(0.22, 0.38), gain: 0.09, attack: 0.03, lowpass: 600, linear: true });
  noise(g, out, t0 + 0.02, { dur: 0.18, gain: 0.04, attack: 0.03, filter: "bandpass", freq: 900, q: 2, linear: true });
}

/** A few muffled keystrokes from the next pod over. */
function farKeyboard(g: Graph, out: AudioNode, t0: number): void {
  const n = 4 + Math.floor(rand(0, 6));
  let t = t0;
  for (let i = 0; i < n; i++) {
    noise(g, out, t, { dur: 0.016, gain: rand(0.05, 0.1), filter: "bandpass", freq: rand(1400, 2400), q: 2 });
    t += rand(0.06, 0.14);
  }
}
