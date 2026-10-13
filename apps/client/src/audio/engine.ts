/**
 * The TokenValley sound engine. Synthesized sound effects for office events
 * and an optional gentle music loop, all over the Web Audio API with no
 * assets. The AudioContext is created lazily on the first user gesture
 * (autoplay policy) via `resume()`.
 */
import type { Event } from "@tokenvalley/shared";
import { MusicLoop } from "./music";
import { playSfx, SFX_MIN_GAP, type SfxName, type SfxParams } from "./sfx";
import { buildGraph, type Graph } from "./synth";

export type { SfxName } from "./sfx";

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
  /** Logs "[audio] <sound>" to the console for each cue played. */
  debug?: boolean;
  /** Called after a toggle changes so the UI can re-render. */
  onChange?: () => void;
}

const KEY_SFX = "tokenvalley.audio.sfx";
const KEY_MUSIC = "tokenvalley.audio.music";

/** Base pitch of the speech bleeps per role: bosses and builders low, pm/designer high. */
const ROLE_PITCH: Record<string, number> = {
  ceo: 220,
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

/** Maps an event to its cue, or null when the event is silent. */
function cueFor(e: Event): SfxName | null {
  switch (e.type) {
    case "tool_write_file":
      return "keys";
    case "tool_read_file":
      return "tick";
    case "tool_shell":
      return "blip";
    case "handoff":
      return "whoosh";
    case "request_approval":
      return "bell";
    case "approval_resolved":
      return e.approval.status === "approved" ? "tada" : e.approval.status === "rejected" ? "rejected" : null;
    case "task_done":
      return "pop";
    case "company_phase":
      return e.phase === "shipped" ? "applause" : null;
    case "budget_exhausted":
      return "thunk";
    case "budget_warning":
      return "kaching";
    case "build_failed":
      return "alarm";
    case "build_passed":
      return "chime";
    case "idle_timeout":
      return "clunk";
    case "agent_spawned":
      return "doorchime";
    case "agent_retired":
      return "doorclose";
    case "send_message":
    case "post_message":
      return "speech";
    case "call_meeting":
      return "dingdong";
    case "agent_persona_changed":
      return "pageflip";
    default:
      return null;
  }
}

export function createAudio(opts: AudioOptions = {}): AudioEngine {
  let graph: Graph | null = null;
  let music: MusicLoop | null = null;
  let enabled = readFlag(KEY_SFX, opts.defaultEffects ?? true);
  let musicEnabled = readFlag(KEY_MUSIC, false);
  const lastPlayed = new Map<SfxName, number>();

  const ensureGraph = (): Graph | null => {
    if (graph) return graph;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      graph = buildGraph(new Ctor());
      music = new MusicLoop(graph);
    } catch (err) {
      console.warn("[audio] could not create AudioContext", err);
      return null;
    }
    return graph;
  };

  const syncMusic = () => {
    if (!graph || !music) return;
    if (musicEnabled && graph.ctx.state === "running") music.start();
    else if (!musicEnabled) music.stop();
  };

  const play = (name: SfxName, params: SfxParams = {}) => {
    if (!enabled || !graph || graph.ctx.state !== "running") return;
    const now = performance.now();
    const last = lastPlayed.get(name) ?? -Infinity;
    if (now - last < SFX_MIN_GAP[name]) return;
    lastPlayed.set(name, now);
    if (opts.debug) console.log(`[audio] ${name}`);
    playSfx(graph, name, graph.ctx.currentTime + 0.005, params);
  };

  const engine: AudioEngine = {
    get enabled() {
      return enabled;
    },
    get musicEnabled() {
      return musicEnabled;
    },
    get running() {
      return graph?.ctx.state === "running";
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
      const name = cueFor(event);
      if (!name) return;
      if (name === "speech" && "agentId" in event) {
        const role = opts.roleOf?.(event.agentId);
        play(name, { pitch: (role && ROLE_PITCH[role]) || 350 });
      } else play(name);
    },
    update() {
      music?.update();
    },
    resume() {
      const g = ensureGraph();
      if (!g) return;
      if (g.ctx.state !== "running") {
        void g.ctx.resume().then(syncMusic, () => undefined);
      } else syncMusic();
    },
    play,
  };

  return engine;
}
