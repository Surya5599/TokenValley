/**
 * The AgentSitcom sound engine. Synthesized sound effects for office events
 * and an optional gentle music loop, all over the Web Audio API with no
 * assets. The AudioContext is created lazily on the first user gesture
 * (autoplay policy) via `resume()`.
 *
 * The event -> cue mapping (`cuesForEvent`) and the per-cue rate limit
 * (`CueGate`) are pure so the live engine and the offline episode export
 * (`createCueRecorder`) make exactly the same decisions.
 */
import type { Event } from "@agentsitcom/shared";
import { MusicLoop } from "./music";
import { playSfx, SFX_MIN_GAP, type SfxName, type SfxParams } from "./sfx";
import { buildGraph, type Graph } from "./synth";

export type { SfxName, SfxParams } from "./sfx";

export interface AudioEngine {
  /** Sound effects on. */
  readonly enabled: boolean;
  /** Music loop on. */
  readonly musicEnabled: boolean;
  setEnabled(on: boolean): void;
  setMusic(on: boolean): void;
  /** Plays the cue for an event. Only the focused company makes noise. */
  handleEvent(event: Event, isFocusedCompany: boolean): void;
  /** Call once per frame; drives the music scheduler. */
  update(dt: number): void;
  /** Creates or resumes the AudioContext. Call from a user gesture. */
  resume(): void;
  /** Plays a named cue directly (story cues, incident sign). */
  play(name: SfxName, params?: SfxParams): void;
  /** True once the AudioContext exists and is running. */
  readonly running: boolean;
}

export interface AudioOptions {
  /** Whether sound effects start on when nothing is persisted. */
  defaultEffects?: boolean;
  /** Role lookup for an agent id, used to pitch the speech bleeps. */
  roleOf?: (agentId: string) => string | undefined;
  /** How many tasks of a company are still in progress (after the event was applied); decides the "big" task_done. */
  openTasksOf?: (companyId: string) => number;
  /** Logs "[audio] <sound>" to the console for each cue played. */
  debug?: boolean;
  /** Called after a toggle changes so the UI can re-render. */
  onChange?: () => void;
}

const KEY_SFX = "agentsitcom.audio.sfx";
const KEY_MUSIC = "agentsitcom.audio.music";

/** Base pitch of the speech bleeps per role: bosses and builders low, pm/designer high. */
export const ROLE_PITCH: Record<string, number> = {
  ceo: 200,
  cfo: 240,
  engineer: 260,
  backend: 270,
  frontend: 290,
  it: 280,
  legal: 300,
  qa: 330,
  hr: 380,
  marketing: 400,
  pm: 440,
  receptionist: 460,
  designer: 480,
  intern: 520,
};

/** CEO buzzwords that earn a kazoo. */
const BUZZWORDS = /synergy|all-hands|leverage|circle back/i;

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const v = window.localStorage.getItem(key);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* storage blocked */
  }
  return fallback;
}

function writeFlag(key: string, on: boolean): void {
  try {
    window.localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* storage blocked */
  }
}

/** One cue request: a name, optional params, and an optional delay in seconds after the event. */
export interface CueRequest {
  name: SfxName;
  params?: SfxParams;
  delay?: number;
}

export interface CueLookups {
  roleOf?: (agentId: string) => string | undefined;
  openTasksOf?: (companyId: string) => number;
}

/** Maps an event to its cues (possibly none, possibly several). Pure; shared by live playback and the export. */
export function cuesForEvent(e: Event, look: CueLookups = {}): CueRequest[] {
  switch (e.type) {
    case "tool_write_file":
      return [{ name: "keys" }];
    case "tool_read_file":
      return [{ name: "tick" }];
    case "tool_shell":
      return [{ name: "blip" }];
    case "handoff":
      return [{ name: "whoosh" }];
    case "request_approval":
      return [{ name: "bell" }];
    case "approval_resolved":
      if (e.approval.status === "approved") return [{ name: "tada" }, { name: "boing", delay: 0.35 }];
      if (e.approval.status === "rejected") return [{ name: "sadTrombone" }];
      return [];
    case "task_done": {
      // The last open task of the company is the big one: it gets the spring.
      const open = look.openTasksOf?.(e.companyId);
      return open === 0 ? [{ name: "pop" }, { name: "boing", delay: 0.12 }] : [{ name: "pop" }];
    }
    case "task_created":
      return [{ name: "newtask" }];
    case "task_blocked":
      return [{ name: "doink" }];
    case "company_phase":
      if (e.phase === "shipped") return [{ name: "ding" }, { name: "applause", delay: 0.25 }, { name: "cheer", delay: 0.4 }];
      if (e.phase === "paused") return [{ name: "recordScratch" }];
      return [];
    case "budget_exhausted":
      return [{ name: "womp" }];
    case "budget_warning":
      return [{ name: "cowbell" }];
    case "build_failed":
      return [{ name: "sadTrombone" }];
    case "build_passed":
      return [{ name: "chime" }];
    case "idle_timeout":
      return [{ name: "clunk" }];
    case "agent_spawned":
      return e.agent.role === "receptionist" ? [{ name: "doorchime" }] : [{ name: "slideUp" }];
    case "agent_retired":
      return [{ name: "slideDown" }];
    case "send_message":
    case "post_message": {
      const role = look.roleOf?.(e.agentId);
      const text = e.type === "post_message" ? e.post.text : e.message.text;
      const out: CueRequest[] = [{ name: "speech", params: { pitch: (role && ROLE_PITCH[role]) || 350, role } }];
      if (role === "ceo" && BUZZWORDS.test(text)) out.push({ name: "kazooSynergy", delay: 0.3 });
      return out;
    }
    case "call_meeting":
      return [{ name: "dingdong" }];
    case "agent_persona_changed":
      return [{ name: "pageflip" }];
    default:
      return [];
  }
}

/** Per-cue rate limit: the same cue cannot fire twice within SFX_MIN_GAP. Times are in seconds. */
export class CueGate {
  private readonly last = new Map<SfxName, number>();

  allow(name: SfxName, timeSeconds: number): boolean {
    const last = this.last.get(name) ?? -Infinity;
    if (timeSeconds - last < SFX_MIN_GAP[name] / 1000) return false;
    this.last.set(name, timeSeconds);
    return true;
  }
}

export function createAudio(opts: AudioOptions = {}): AudioEngine {
  let graph: Graph | null = null;
  let live: AudioContext | null = null;
  let music: MusicLoop | null = null;
  let enabled = readFlag(KEY_SFX, opts.defaultEffects ?? true);
  let musicEnabled = readFlag(KEY_MUSIC, false);
  const gate = new CueGate();

  const ensureGraph = (): Graph | null => {
    if (graph) return graph;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      live = new Ctor();
      graph = buildGraph(live);
      music = new MusicLoop(graph);
    } catch (err) {
      console.warn("[audio] could not create AudioContext", err);
      return null;
    }
    return graph;
  };

  const syncMusic = () => {
    if (!live || !music) return;
    if (musicEnabled && live.state === "running") music.start();
    else if (!musicEnabled) music.stop();
  };

  const play = (name: SfxName, params: SfxParams = {}, delay = 0) => {
    if (!enabled || !graph || !live || live.state !== "running") return;
    if (!gate.allow(name, performance.now() / 1000 + delay)) return;
    if (opts.debug) console.log(`[audio] ${name}`);
    playSfx(graph, name, live.currentTime + 0.005 + delay, params);
  };

  const engine: AudioEngine = {
    get enabled() {
      return enabled;
    },
    get musicEnabled() {
      return musicEnabled;
    },
    get running() {
      return live?.state === "running";
    },
    setEnabled(on) {
      if (enabled === on) return;
      enabled = on;
      writeFlag(KEY_SFX, on);
      opts.onChange?.();
    },
    setMusic(on) {
      if (musicEnabled === on) return;
      musicEnabled = on;
      writeFlag(KEY_MUSIC, on);
      if (on) ensureGraph();
      syncMusic();
      opts.onChange?.();
    },
    handleEvent(event, isFocusedCompany) {
      if (!isFocusedCompany || !enabled) return;
      for (const c of cuesForEvent(event, opts)) play(c.name, c.params, c.delay ?? 0);
    },
    update() {
      music?.update();
    },
    resume() {
      const g = ensureGraph();
      if (!g || !live) return;
      if (live.state !== "running") {
        void live.resume().then(syncMusic, () => undefined);
      } else syncMusic();
    },
    play: (name, params) => play(name, params),
  };

  return engine;
}

// ---- capture ----

/** One cue the engine would have played, on the story clock. */
export interface CueRecord {
  time: number;
  name: SfxName;
  params: SfxParams;
}

export interface CueRecorder extends AudioEngine {
  /** Sets the story clock; later cues are stamped with this time. */
  setTime(seconds: number): void;
  readonly cues: CueRecord[];
}

/**
 * An AudioEngine that plays nothing and records what it would have played.
 * Same mapping, same rate limits, so the export matches live playback.
 */
export function createCueRecorder(look: CueLookups = {}): CueRecorder {
  const cues: CueRecord[] = [];
  const gate = new CueGate();
  let now = 0;
  const record = (name: SfxName, params: SfxParams = {}, delay = 0) => {
    const t = now + delay;
    if (!gate.allow(name, t)) return;
    cues.push({ time: t, name, params });
  };
  return {
    enabled: true,
    musicEnabled: false,
    running: true,
    cues,
    setEnabled() {},
    setMusic() {},
    update() {},
    resume() {},
    setTime(seconds) {
      now = seconds;
    },
    handleEvent(event, isFocusedCompany) {
      if (!isFocusedCompany) return;
      for (const c of cuesForEvent(event, look)) record(c.name, c.params, c.delay ?? 0);
      // The office's incident sign resets on a failed build and buzzes; the director does that live.
      if (event.type === "build_failed") record("buzzer", {}, 0.45);
    },
    play: (name, params) => record(name, params),
  };
}
