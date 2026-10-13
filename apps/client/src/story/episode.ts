import type * as THREE from "three";
import type { Agent, AnimState, Approval, Event, RoleId, Task } from "@tokenvalley/shared";
import type { AudioEngine } from "../audio/engine";
import type { CameraMode, Store } from "../state/store";
import type { Overlay } from "../ui/overlay";
import type { CameraRig } from "../world/camera";
import type { Character, Expression, GestureName } from "../world/character";
import type { Director } from "../world/director";
import type { Tile } from "../world/office";
import type { Valley } from "../world/valley";
import type { Mocku } from "./mocku";

/** What main.ts hands the story runtime. */
export interface StoryHost {
  store: Store;
  director: Director;
  rig: CameraRig;
  overlay: Overlay;
  valley: Valley;
  overlayRoot: HTMLElement;
  audio: AudioEngine;
  handleMessage: (m: import("@tokenvalley/shared").ServerMessage) => void;
  setCamera: (mode: CameraMode) => void;
  /** Post-processing look and lens for a camera mode, without moving the camera (snap zooms, talking heads). */
  setLook: (mode: CameraMode) => void;
}

export interface Beat {
  at: number;
  run: () => void;
}

/** One deterministic storyline. Beats are built once per run from the shared setup. */
export interface Episode {
  id: string;
  title: string;
  tagline: string;
  durationSeconds: number;
  /** Name cards (lower thirds) on by default. The pilot keeps them off for clean voiceover takes. */
  nameCards: boolean;
  beats: (ctx: EpisodeContext) => Beat[];
}

export type CastName = "michael" | "jim" | "dwight" | "pam" | "angela" | "oscar" | "erin" | "kevin" | "creed";

export interface EpisodeContext {
  store: Store;
  director: Director;
  rig: CameraRig;
  valley: Valley;
  audio: AudioEngine;
  mocku: Mocku;
  companyId: string;
  cast: Record<CastName, Agent>;
  /** Walking the real pipeline: store, director, audio, overlay. */
  send: (e: Event) => void;
  base: () => { id: string; companyId: string; timestamp: number };
  post: (from: Agent, channel: string, text: string) => Event;
  dm: (from: string, to: string, text: string, taskId?: string | null) => Event;
  task: (id: string, title: string, ownerRole: RoleId | null, ownerAgentId: string | null, status: Task["status"], createdBy?: string) => Task;
  approval: (id: string, summary: string) => Approval;
  /** Sends the snapshot and puts the office on screen (or the valley, for the pilot's opening). */
  boot: (camera: "office" | "valley") => void;
  character: (a: Agent) => Character | null;
  homeSpotId: (a: Agent) => string;
  /** World position of a named spot (tile centre, y = 0). */
  spot: (id: string, y?: number) => THREE.Vector3;
  /** Camera: a tracking close-up on a character, the office overview, or the meeting table. */
  follow: (a: Agent, seconds: number) => void;
  overview: (seconds: number) => void;
  meeting: (seconds: number) => void;
  /** Post-processing look for a camera mode (tilt-shift strength, lens). */
  look: (mode: CameraMode) => void;
  /** Gesture / expression shorthands that tolerate a missing character. */
  gesture: (a: Agent, name: GestureName) => void;
  expression: (a: Agent, e: Expression, seconds?: number) => void;
  state: (a: Agent, s: AnimState, face?: Tile | null) => void;
  say: (a: Agent, text: string, seconds?: number) => void;
  /** Story-only crowd moves. */
  gatherInLobby: () => void;
  everyoneWaves: (seconds: number) => void;
  everyoneToDesks: () => void;
  everyoneCheers: () => void;
  /** A lower-third for an agent (on the first speech it is automatic). */
  nameCard: (a: Agent) => void;
  /** The closing deliverable card and wordmark used by the pilot and shipping day. */
  showDeliverable: () => void;
  showWordmark: () => void;
  /** Mockumentary shots. */
  snapZoom: (target: Agent | THREE.Vector3, factor?: number, hold?: number, elevation?: number) => void;
  /** A snap zoom to an absolute radius (tiny props: the bug jar, the chili). */
  snapTo: (target: Agent | THREE.Vector3, radius: number, hold?: number, elevation?: number) => void;
  whipPan: (target: Agent | THREE.Vector3, radius?: number, elevation?: number) => void;
  pushIn: (target: Agent | THREE.Vector3, seconds: number) => void;
  talkingHead: (a: Agent, line: string, seconds: number, expression?: Expression) => void;
  /** Ends the episode: freezes the clock. Added automatically at the duration. */
  setCamera: (mode: CameraMode) => void;
}
