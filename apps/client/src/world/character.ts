import * as THREE from "three";
import type { Agent, AnimState, ModelTier, RoleId } from "@tokenvalley/shared";
import { spotTile, tileToWorld, type Office, type Tile } from "./office";
import { findPath, nearestWalkable } from "./pathfinding";
import { PASTEL, pastel, toonMat } from "./style";
import { canvasTexture, disposeSprite, makeCanvas, roundRect, wrapText } from "./textures";

/** Pastel outfit per role; also used by the overlay for chat avatars. */
export const ROLE_COLOR: Record<RoleId, number> = {
  ceo: PASTEL.blue,
  pm: PASTEL.peach,
  engineer: PASTEL.teal,
  qa: PASTEL.lavender,
  designer: PASTEL.pink,
  backend: 0x5b8fd6,
  frontend: 0x8fbce8,
  marketing: PASTEL.yellow,
  legal: PASTEL.greyLavender,
  hr: PASTEL.rose,
  it: PASTEL.mint,
  intern: PASTEL.cream,
  cfo: PASTEL.sage,
  receptionist: PASTEL.coral,
};

const MODEL_BADGE: Record<ModelTier, { label: string; color: string }> = {
  opus: { label: "OPUS", color: "#8b5cf6" },
  sonnet: { label: "SONNET", color: "#3b82f6" },
  haiku: { label: "HAIKU", color: "#22c55e" },
};


// ---- looks -------------------------------------------------------------------

export type HairShape = "short" | "side_part" | "centre_part" | "ponytail" | "bob" | "bald" | "fringe" | "curly" | "slicked" | "messy" | "bun" | "long" | "shoulder" | "thin" | "cap";
export type TopKind = "jacket" | "shirt" | "cardigan" | "vest" | "sweater" | "polo" | "warehouse" | "dress";
export type PropKind = "calculator_watch" | "cat_pin" | "crossword" | "mug" | "clipboard" | "badge" | "pen" | null;

/** Everything that makes one cast member read as themselves. Built from primitives; no textures, no text. */
export interface Look {
  skin: number;
  hair: { shape: HairShape; color: number };
  /** 0.9 .. 1.15 */
  height: number;
  /** 0.9 .. 1.3 */
  width: number;
  /** `shirt` is the layer under a jacket, cardigan or vest. */
  top: { kind: TopKind; color: number; shirt?: number };
  bottom: number;
  tie: number | null;
  tieStyle?: "loose" | "skinny";
  glasses: boolean;
  prop: PropKind;
  smile?: "warm" | "big";
  /** Resting head tilt: x nods forward, z leans sideways. */
  headTilt?: { x?: number; z?: number };
  /** Shoulders drop and the arms hang a little lower. */
  slump?: boolean;
}

const SKIN_LIGHT = 0xf6d8c0;
const SKIN_FAIR = 0xf1c27d;
const SKIN_TAN = 0xd9a877;
const SKIN_BROWN = 0xa5693f;
const SKIN_DEEP = 0x6f4426;
const WHITE_SHIRT = 0xf7f5f2;
const INK = PASTEL.ink;

/** The cast, keyed by lowercase first name. Any name not here falls back to the role outfit. */
export const LOOKS: Record<string, Look> = {
  michael: { skin: SKIN_FAIR, hair: { shape: "side_part", color: 0x4a3728 }, height: 1.0, width: 1.0, top: { kind: "jacket", color: 0x4b4a5e, shirt: WHITE_SHIRT }, bottom: 0x3f3e52, tie: 0xd62828, glasses: false, prop: null, smile: "big" },
  jim: { skin: SKIN_LIGHT, hair: { shape: "messy", color: 0x6b4a2f }, height: 1.12, width: 0.95, top: { kind: "shirt", color: WHITE_SHIRT }, bottom: 0x5c6b8a, tie: 0x6b7fa3, tieStyle: "loose", glasses: false, prop: null, smile: "warm" },
  pam: { skin: SKIN_LIGHT, hair: { shape: "ponytail", color: 0x6b4a2f }, height: 0.97, width: 0.92, top: { kind: "cardigan", color: 0xc9b8e8, shirt: 0xfbf1e3 }, bottom: 0x8d99ae, tie: null, glasses: false, prop: null, smile: "warm" },
  dwight: { skin: SKIN_FAIR, hair: { shape: "centre_part", color: 0x6b4a2f }, height: 1.02, width: 1.0, top: { kind: "shirt", color: 0xd9a441 }, bottom: 0x8a6f4d, tie: INK, glasses: true, prop: "calculator_watch" },
  angela: { skin: SKIN_LIGHT, hair: { shape: "bun", color: 0xf0d78c }, height: 0.9, width: 0.9, top: { kind: "shirt", color: 0xd6e8ff }, bottom: 0x6b6b7e, tie: null, glasses: false, prop: "cat_pin" },
  kevin: { skin: SKIN_FAIR, hair: { shape: "fringe", color: 0x7a5a3a }, height: 1.0, width: 1.3, top: { kind: "shirt", color: 0xdde6f2 }, bottom: 0x4f5566, tie: 0x6fa3d8, glasses: false, prop: null, smile: "warm" },
  oscar: { skin: SKIN_TAN, hair: { shape: "short", color: 0x2b1d14 }, height: 1.0, width: 0.95, top: { kind: "vest", color: 0x8fa3bf, shirt: WHITE_SHIRT }, bottom: 0x5c6b8a, tie: null, glasses: false, prop: "pen" },
  stanley: { skin: SKIN_DEEP, hair: { shape: "short", color: 0x5a5a66 }, height: 1.0, width: 1.25, top: { kind: "jacket", color: 0x8d99ae, shirt: WHITE_SHIRT }, bottom: 0x6c7489, tie: 0x7a3b3b, glasses: true, prop: "crossword", headTilt: { x: 0.1 } },
  creed: { skin: 0xe8c6a8, hair: { shape: "short", color: 0xc9c9c9 }, height: 0.98, width: 0.95, top: { kind: "shirt", color: 0xd8d0c0 }, bottom: 0x8b8378, tie: null, glasses: false, prop: null, headTilt: { x: 0.18, z: 0.12 }, slump: true },
  erin: { skin: SKIN_LIGHT, hair: { shape: "shoulder", color: 0xc8572a }, height: 0.98, width: 0.92, top: { kind: "cardigan", color: 0xf7d774, shirt: WHITE_SHIRT }, bottom: 0x9fb4c7, tie: null, glasses: false, prop: null, smile: "big" },
  ryan: { skin: SKIN_FAIR, hair: { shape: "slicked", color: 0x1f1a17 }, height: 1.02, width: 0.9, top: { kind: "shirt", color: 0xd8d8e0 }, bottom: 0x2e2d3a, tie: INK, tieStyle: "skinny", glasses: false, prop: null },
  kelly: { skin: 0xc68e5c, hair: { shape: "long", color: 0x1f1a17 }, height: 0.95, width: 0.92, top: { kind: "shirt", color: 0xf5a3c7 }, bottom: 0x4f5566, tie: null, glasses: false, prop: null, smile: "big" },
  toby: { skin: SKIN_LIGHT, hair: { shape: "thin", color: 0xb08968 }, height: 1.0, width: 1.0, top: { kind: "shirt", color: 0xe3d5bd }, bottom: 0x9c8c7a, tie: null, glasses: false, prop: null, slump: true, headTilt: { x: 0.12 } },
  andy: { skin: SKIN_FAIR, hair: { shape: "short", color: 0xb98f6e }, height: 1.05, width: 1.0, top: { kind: "sweater", color: 0xa8c3a0, shirt: WHITE_SHIRT }, bottom: 0x5c6b8a, tie: 0xd62828, glasses: false, prop: null, smile: "big" },
  meredith: { skin: SKIN_LIGHT, hair: { shape: "curly", color: 0xc0392b }, height: 0.98, width: 1.0, top: { kind: "shirt", color: 0xb48ee0 }, bottom: 0x5c4a6a, tie: null, glasses: false, prop: "mug" },
  phyllis: { skin: SKIN_LIGHT, hair: { shape: "bob", color: 0xb8b8b8 }, height: 0.96, width: 1.2, top: { kind: "cardigan", color: 0xa8c3a0, shirt: 0xe8a0b4 }, bottom: 0x7e6b8f, tie: null, glasses: false, prop: null, smile: "warm" },
  darryl: { skin: SKIN_BROWN, hair: { shape: "cap", color: 0x3b3a4f }, height: 1.08, width: 1.15, top: { kind: "warehouse", color: 0x5b8fd6 }, bottom: 0x4f5566, tie: null, glasses: false, prop: "badge" },
  holly: { skin: SKIN_LIGHT, hair: { shape: "shoulder", color: 0xf0d78c }, height: 1.0, width: 0.95, top: { kind: "jacket", color: 0x6fa3d8, shirt: WHITE_SHIRT }, bottom: 0x5c6b8a, tie: null, glasses: false, prop: null, smile: "warm" },
  jan: { skin: SKIN_LIGHT, hair: { shape: "bob", color: 0x2b1d14 }, height: 1.02, width: 0.92, top: { kind: "jacket", color: 0x2e2d3a, shirt: WHITE_SHIRT }, bottom: 0x2e2d3a, tie: null, glasses: false, prop: null },
  david: { skin: SKIN_LIGHT, hair: { shape: "side_part", color: 0x9a9ba3 }, height: 1.04, width: 1.0, top: { kind: "jacket", color: 0x2f4a6e, shirt: WHITE_SHIRT }, bottom: 0x2f4a6e, tie: 0x7a3b3b, glasses: false, prop: null },
  robert: { skin: SKIN_FAIR, hair: { shape: "slicked", color: 0xc0c0c0 }, height: 1.08, width: 1.0, top: { kind: "jacket", color: 0x2a2a35, shirt: WHITE_SHIRT }, bottom: 0x2a2a35, tie: INK, glasses: false, prop: null },
  nellie: { skin: SKIN_LIGHT, hair: { shape: "shoulder", color: 0x5a3a28 }, height: 1.0, width: 1.0, top: { kind: "jacket", color: 0xb3aec9, shirt: 0xf28b82 }, bottom: 0x4f5566, tie: null, glasses: false, prop: null, smile: "warm" },
  gabe: { skin: 0xf6e0cc, hair: { shape: "short", color: 0x2b1d14 }, height: 1.15, width: 0.9, top: { kind: "jacket", color: 0x8d99ae, shirt: WHITE_SHIRT }, bottom: 0x6c7489, tie: 0x5c6b8a, tieStyle: "skinny", glasses: false, prop: null },
};

/** The look for an agent name ("Michael (CEO)" -> michael), or null when the first name is unknown. */
export function lookFor(name: string): Look | null {
  const first = name.trim().split(/[\s(]/)[0]?.toLowerCase() ?? "";
  return LOOKS[first] ?? null;
}

/** A tapered flat wedge: a 4-sided cylinder turned 45 degrees and squashed. Used for ties, lapels and collars. */
function wedgeGeometry(topW: number, bottomW: number, h: number, depth: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(topW / Math.SQRT2, bottomW / Math.SQRT2, h, 4);
  g.rotateY(Math.PI / 4);
  g.scale(1, 1, depth);
  return g;
}

const SKIN = 0xf1c27d;
const WALK_SPEED = 3.4; // tiles per second at 1x

interface WalkCmd {
  target: Tile;
  then: AnimState;
  face: Tile | null;
  resolve: (arrived: boolean) => void;
}

export type CarryKind = "folder" | null;

/**
 * A capsule-bodied low-poly figure. Movement follows A* paths one tile at a
 * time; a new goTo while walking is queued and takes over at the next tile.
 */
export class Character {
  readonly group = new THREE.Group();
  /** Papers that pile up on the desk with tool_write_file. Lives in the office group. */
  readonly papers = new THREE.Group();
  agent: Agent;
  state: AnimState = "idle";
  tile: Tile;
  removed = false;
  onRemoved: (() => void) | null = null;

  private readonly office: Office;
  private readonly rig = new THREE.Group();
  private readonly headGroup = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly look: Look | null;
  private readonly headBase = { x: 0, z: 0 };
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private nameTag: THREE.Sprite;
  private readonly bubble: THREE.Sprite;
  private readonly alert: THREE.Sprite;
  private readonly cup: THREE.Mesh;
  private readonly folder: THREE.Mesh;
  private cupAlways = false;
  private carrying: CarryKind = null;

  private path: Tile[] = [];
  private progress = 0;
  private current: WalkCmd | null = null;
  private pending: WalkCmd | null = null;
  private faceTile: Tile | null = null;
  private yaw = 0;
  private targetYaw = 0;

  private t = Math.random() * 10;
  private bubbleUntil = 0;
  private celebrateUntil = 0;
  private typingBoostUntil = 0;
  private waveUntil = 0;
  private glanceUntil = 0;
  private nodUntil = 0;
  private fade: { from: number; to: number; elapsed: number; dur: number; done: () => void } | null = null;
  private paperCount = 0;

  constructor(agent: Agent, office: Office, startTile: Tile, opts: { small?: boolean } = {}) {
    this.agent = agent;
    this.office = office;
    this.tile = { ...startTile };
    this.look = agent.kind === "contractor" ? null : lookFor(agent.name);
    if (this.look) this.buildLookBody(this.look);
    else this.buildBody(opts.small === true);
    this.nameTag = this.makeNameTag();
    this.group.add(this.nameTag);
    this.bubble = this.makeBubbleSprite();
    this.bubble.visible = false;
    this.group.add(this.bubble);
    this.alert = this.makeAlertSprite();
    this.alert.visible = false;
    this.group.add(this.alert);
    this.cup = this.makeCup();
    this.folder = this.makeFolder();
    this.cup.visible = false;
    this.folder.visible = false;
    this.group.position.copy(tileToWorld(this.tile));
    if (opts.small) this.group.scale.setScalar(0.62);
    // Taller builds carry their tag, bubble and alert higher.
    const h = this.look?.height ?? 1;
    this.nameTag.position.y = 1.92 * h;
    this.bubble.position.y = 2.65 + (h - 1) * 1.4;
    this.alert.position.y = 1.75 * h;
    this.applyStatePose(0);
  }

  // ---- public API --------------------------------------------------------

  get isMoving(): boolean {
    return this.current !== null;
  }

  /** Instantly places the character on a tile (initial placement on focus). */
  teleport(tile: Tile, face?: Tile | null): void {
    this.current?.resolve(false);
    this.pending?.resolve(false);
    this.current = null;
    this.pending = null;
    this.path = [];
    this.tile = { ...tile };
    this.group.position.copy(tileToWorld(this.tile));
    if (face !== undefined) this.faceTile = face;
    if (this.faceTile) {
      this.lookAt(this.faceTile);
      this.yaw = this.targetYaw;
    }
  }

  /** Replaces the agent record and refreshes the name tag (model badge). */
  setAgent(agent: Agent): void {
    const changed = agent.name !== this.agent.name || agent.model !== this.agent.model;
    this.agent = agent;
    if (changed) this.rebuildNameTag();
  }

  /** Throws away the name tag sprite and draws a fresh one from the current agent record. */
  rebuildNameTag(): void {
    this.group.remove(this.nameTag);
    disposeSprite(this.nameTag);
    this.nameTag = this.makeNameTag();
    this.group.add(this.nameTag);
  }

  say(text: string, seconds = 4): void {
    this.drawBubble(text);
    this.bubble.visible = true;
    this.bubbleUntil = this.t + seconds;
  }

  /** Waves at the camera for `seconds`, then returns to idle (or typing when a task is active). */
  wave(seconds = 4, face?: Tile | null): void {
    this.setState("wave", face);
    this.waveUntil = this.t + seconds;
  }

  /** Sets the animation state immediately (does not interrupt walking). */
  setState(state: AnimState, face?: Tile | null): void {
    this.state = state;
    if (face !== undefined) this.faceTile = face;
    if (state === "celebrate") this.celebrateUntil = this.t + 2;
    if (state === "wave") this.waveUntil = this.t + 4;
    if (!this.current && this.faceTile) this.lookAt(this.faceTile);
    this.alert.visible = state === "blocked";
  }

  /**
   * Walk to a spot id or tile, then switch to `then`. Resolves true on
   * arrival, false if a newer command superseded this one.
   */
  goTo(target: string | Tile, then: AnimState, face?: Tile | null): Promise<boolean> {
    if (this.removed) return Promise.resolve(false);
    let tile: Tile | null = typeof target === "string" ? spotTile(target) : { ...target };
    if (!tile) {
      console.warn(`[character] unknown spot ${String(target)}`);
      tile = this.office.entranceSpot;
    }
    const walkable = nearestWalkable(this.office.grid, tile, 5) ?? this.office.entranceSpot;
    const faceTile = face === undefined ? (typeof target === "string" ? (this.office.faceTiles.get(target) ?? null) : null) : face;
    return new Promise<boolean>((resolve) => {
      const cmd: WalkCmd = { target: walkable, then, face: faceTile, resolve };
      if (this.current) {
        // Finish the current tile step, then switch.
        this.pending?.resolve(false);
        this.pending = cmd;
      } else {
        this.startWalk(cmd);
      }
    });
  }

  /** Walks to the lobby, fades out, and calls onRemoved. */
  async leave(): Promise<void> {
    this.state = "leave";
    this.alert.visible = false;
    await this.goTo(this.office.entranceSpot, "leave");
    await new Promise<void>((done) => {
      this.fade = { from: 1, to: 0, elapsed: 0, dur: 1, done };
    });
    this.removed = true;
    this.onRemoved?.();
  }

  /** Fades out in place (contractors vanish beside their parent), then calls done. */
  fadeOutAndRemove(done: () => void): void {
    this.fade = {
      from: 1,
      to: 0,
      elapsed: 0,
      dur: 0.8,
      done: () => {
        this.removed = true;
        done();
      },
    };
  }

  /** Fade in (used on arrive). */
  fadeIn(): void {
    this.setOpacity(0);
    this.fade = { from: 0, to: 1, elapsed: 0, dur: 0.6, done: () => undefined };
  }

  glance(): void {
    this.glanceUntil = this.t + 1.2;
  }

  nod(): void {
    this.nodUntil = this.t + 1.0;
  }

  typingBoost(seconds = 2): void {
    this.typingBoostUntil = this.t + seconds;
  }

  carry(kind: CarryKind): void {
    this.carrying = kind;
    this.folder.visible = kind === "folder";
  }

  /** Adds a sheet to the paper stack at the character's desk. */
  addPaper(deskTile: Tile | null): void {
    if (!deskTile || this.paperCount >= 12) return;
    const geo = new THREE.BoxGeometry(0.3, 0.025, 0.4);
    const mat = toonMat(0xfffdf8);
    this.geometries.push(geo);
    this.materials.push(mat);
    const sheet = new THREE.Mesh(geo, mat);
    const p = tileToWorld(deskTile, 0.8 + 0.0125 + this.paperCount * 0.025);
    sheet.position.set(p.x - 0.3 + (Math.random() - 0.5) * 0.04, p.y, p.z + 0.25 + (Math.random() - 0.5) * 0.04);
    sheet.rotation.y = (Math.random() - 0.5) * 0.3;
    this.papers.add(sheet);
    this.paperCount++;
  }

  worldPosition(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.group.position);
  }

  update(dt: number): void {
    this.t += dt;
    this.updateWalk(dt);
    if (this.bubble.visible && this.t > this.bubbleUntil) this.bubble.visible = false;
    if (this.state === "celebrate" && this.t > this.celebrateUntil) {
      this.state = this.agent.currentTaskId ? "sit_typing" : "idle";
    }
    if (this.state === "wave" && this.t > this.waveUntil) {
      this.state = this.agent.currentTaskId ? "sit_typing" : "idle";
    }
    // Yaw smoothing (shortest arc).
    let diff = this.targetYaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * Math.min(1, dt * 12);
    this.group.rotation.y = this.yaw;
    this.applyStatePose(dt);
    if (this.fade) {
      this.fade.elapsed += dt;
      const k = Math.min(1, this.fade.elapsed / this.fade.dur);
      this.setOpacity(this.fade.from + (this.fade.to - this.fade.from) * k);
      if (k >= 1) {
        const done = this.fade.done;
        this.fade = null;
        done();
      }
    }
  }

  dispose(): void {
    this.removed = true;
    this.current?.resolve(false);
    this.pending?.resolve(false);
    this.current = null;
    this.pending = null;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    disposeSprite(this.nameTag);
    disposeSprite(this.bubble);
    disposeSprite(this.alert);
    this.group.removeFromParent();
    this.papers.removeFromParent();
  }

  // ---- walking ---------------------------------------------------------------

  private startWalk(cmd: WalkCmd): void {
    const path = findPath(this.office.grid, this.tile, cmd.target);
    if (path === null) {
      console.warn(`[character] ${this.agent.name}: no path from (${this.tile.x},${this.tile.z}) to (${cmd.target.x},${cmd.target.z})`);
      this.arrive(cmd);
      return;
    }
    if (path.length === 0) {
      this.arrive(cmd);
      return;
    }
    this.current = cmd;
    this.path = path;
    this.progress = 0;
    if (this.state !== "arrive" && this.state !== "leave") this.state = "walk";
    this.alert.visible = false;
    this.carryPose();
  }

  private arrive(cmd: WalkCmd): void {
    this.current = null;
    this.path = [];
    this.progress = 0;
    this.group.position.copy(tileToWorld(this.tile));
    this.faceTile = cmd.face;
    if (cmd.face) this.lookAt(cmd.face);
    this.setState(cmd.then);
    cmd.resolve(true);
  }

  private updateWalk(dt: number): void {
    if (!this.current) return;
    const next = this.path[0];
    if (!next) {
      this.arrive(this.current);
      return;
    }
    this.progress += dt * WALK_SPEED;
    const from = tileToWorld(this.tile);
    const to = tileToWorld(next);
    this.targetYaw = Math.atan2(to.x - from.x, to.z - from.z);
    if (this.progress >= 1) {
      this.tile = { ...next };
      this.path.shift();
      this.progress = 0;
      if (this.pending) {
        // Current segment finished: hand over to the queued command.
        const old = this.current;
        const cmd = this.pending;
        this.pending = null;
        this.current = null;
        old.resolve(false);
        this.startWalk(cmd);
        return;
      }
      if (this.path.length === 0) {
        this.arrive(this.current);
        return;
      }
      this.group.position.copy(tileToWorld(this.tile));
      return;
    }
    this.group.position.lerpVectors(from, to, this.progress);
  }

  private lookAt(tile: Tile): void {
    const here = tileToWorld(this.tile);
    const there = tileToWorld(tile);
    const dx = there.x - here.x;
    const dz = there.z - here.z;
    if (Math.abs(dx) + Math.abs(dz) < 1e-3) return;
    this.targetYaw = Math.atan2(dx, dz);
  }

  // ---- posing ------------------------------------------------------------------

  private carryPose(): void {
    this.folder.visible = this.carrying === "folder";
  }

  private applyStatePose(dt: number): void {
    const t = this.t;
    const moving = this.current !== null;
    const rig = this.rig;
    const head = this.headGroup;
    const seated = !moving && (this.state === "sit_typing" || this.state === "meeting");
    const cupVisible = this.cupAlways || this.state === "coffee";
    this.cup.visible = cupVisible;

    rig.position.y = 0;
    head.rotation.set(this.headBase.x, 0, this.headBase.z);
    let armLx = 0;
    let armRx = 0;
    let armRz = 0;
    let legLx = 0;
    let legRx = 0;

    if (moving) {
      const s = Math.sin(t * 11);
      legLx = s * 0.7;
      legRx = -s * 0.7;
      armLx = -s * 0.5;
      armRx = s * 0.5;
      rig.position.y = Math.abs(Math.sin(t * 11)) * 0.04;
      if (this.carrying === "folder") armRx = -1.2;
    } else {
      switch (this.state) {
        case "idle":
        case "arrive":
        case "leave":
        case "walk":
          rig.position.y = Math.sin(t * 2) * 0.03;
          armLx = Math.sin(t * 2) * 0.05;
          armRx = -Math.sin(t * 2) * 0.05;
          break;
        case "sit_typing": {
          rig.position.y = -0.32;
          legLx = legRx = -Math.PI / 2;
          const speed = t < this.typingBoostUntil ? 40 : 18;
          armLx = -1.1 + Math.sin(t * speed) * 0.12;
          armRx = -1.1 + Math.cos(t * speed * 1.3) * 0.12;
          head.rotation.x = 0.15;
          break;
        }
        case "meeting":
          rig.position.y = -0.32;
          legLx = legRx = -Math.PI / 2;
          armLx = armRx = -0.9;
          head.rotation.y = Math.sin(t * 0.9) * 0.4;
          break;
        case "talk":
          head.rotation.x = Math.sin(t * 9) * 0.12;
          armLx = -0.6 + Math.sin(t * 6) * 0.3;
          armRx = -0.4 + Math.cos(t * 5) * 0.3;
          break;
        case "blocked":
          head.rotation.x = 0.55;
          armLx = armRx = 0.15;
          rig.position.y = -0.03;
          break;
        case "celebrate":
          rig.position.y = Math.abs(Math.sin(t * 7)) * 0.5;
          armLx = armRx = Math.PI - 0.2 + Math.sin(t * 14) * 0.2;
          break;
        case "coffee":
          rig.position.y = Math.sin(t * 1.5) * 0.03;
          armRx = -1.4;
          armLx = 0.1;
          head.rotation.x = Math.sin(t * 1.5) > 0.9 ? 0.25 : 0;
          break;
        case "wave":
          // Right arm up and swinging side to side, a small bounce, head cocked.
          rig.position.y = Math.abs(Math.sin(t * 6)) * 0.06;
          armRx = Math.PI - 0.35;
          armRz = Math.sin(t * 9) * 0.45;
          armLx = Math.sin(t * 2) * 0.08;
          head.rotation.z = this.headBase.z + 0.18 + Math.sin(t * 3) * 0.05;
          break;
      }
      if (seated && this.faceTile) this.lookAt(this.faceTile);
    }

    if (t < this.glanceUntil) head.rotation.y = 0.6 * Math.sin((this.glanceUntil - t) * 5);
    if (t < this.nodUntil) head.rotation.x = Math.sin(t * 16) * 0.25;

    const k = Math.min(1, dt * 14);
    this.armL.rotation.x += (armLx - this.armL.rotation.x) * k;
    this.armR.rotation.x += (armRx - this.armR.rotation.x) * k;
    this.armR.rotation.z += (armRz - this.armR.rotation.z) * k;
    this.legL.rotation.x += (legLx - this.legL.rotation.x) * k;
    this.legR.rotation.x += (legRx - this.legR.rotation.x) * k;
    // Alert sits beside the head and bobs.
    if (this.alert.visible) this.alert.position.y = 1.75 + Math.sin(t * 6) * 0.05;
  }

  private setOpacity(o: number): void {
    for (const m of this.materials) {
      m.transparent = o < 1 || m.transparent;
      m.opacity = o;
    }
    for (const s of [this.nameTag, this.bubble, this.alert]) s.material.opacity = o;
  }

  // ---- construction ----------------------------------------------------------

  private mat(color: THREE.ColorRepresentation): THREE.MeshToonMaterial {
    const m = toonMat(color);
    this.materials.push(m);
    return m;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    this.geometries.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    return m;
  }

  private buildBody(small: boolean): void {
    const role = this.agent.role;
    const isContractor = this.agent.kind === "contractor";
    const bodyColor = isContractor ? 0xc3bfd0 : ROLE_COLOR[role];
    const bodyMat = this.mat(bodyColor);
    const skinMat = this.mat(SKIN);
    const darkMat = this.mat(PASTEL.ink);

    // Legs: pivot at the hip, mesh hangs below.
    for (const [grp, x] of [
      [this.legL, -0.11],
      [this.legR, 0.11],
    ] as const) {
      grp.position.set(x, 0.4, 0);
      const leg = this.mesh(new THREE.BoxGeometry(0.16, 0.4, 0.16), darkMat);
      leg.position.y = -0.2;
      grp.add(leg);
      this.rig.add(grp);
    }
    // Body capsule: cylinder plus a rounded top.
    const body = this.mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.62, 10), bodyMat);
    body.position.y = 0.71;
    this.rig.add(body);
    const shoulders = this.mesh(new THREE.SphereGeometry(0.26, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat);
    shoulders.position.y = 1.02;
    this.rig.add(shoulders);
    // Arms: pivot at the shoulder.
    for (const [grp, x] of [
      [this.armL, -0.36],
      [this.armR, 0.36],
    ] as const) {
      grp.position.set(x, 0.98, 0);
      const arm = this.mesh(new THREE.BoxGeometry(0.12, 0.42, 0.12), bodyMat);
      arm.position.y = -0.21;
      grp.add(arm);
      const hand = this.mesh(new THREE.SphereGeometry(0.07, 8, 6), skinMat);
      hand.position.y = -0.44;
      grp.add(hand);
      this.rig.add(grp);
    }
    // Head: pivot at the neck.
    this.headGroup.position.set(0, 1.02, 0);
    const head = this.mesh(new THREE.SphereGeometry(0.24, 12, 10), skinMat);
    head.position.y = 0.26;
    this.headGroup.add(head);
    // Eyes.
    for (const x of [-0.09, 0.09]) {
      const eye = this.mesh(new THREE.SphereGeometry(0.035, 6, 6), darkMat);
      eye.position.set(x, 0.3, 0.21);
      this.headGroup.add(eye);
    }
    this.rig.add(this.headGroup);
    this.group.add(this.rig);

    if (!isContractor) this.addAccessory(role, bodyMat, darkMat);
    else {
      // Contractors wear a plain hard hat so they read as "helper".
      const hat = this.mesh(new THREE.CylinderGeometry(0.2, 0.27, 0.16, 10), this.mat(0xffc300));
      hat.position.set(0, 0.46, 0);
      this.headGroup.add(hat);
    }
    void small;
  }

  /** Builds the figure from a cast Look: build, clothes, hair, face and one prop. */
  private buildLookBody(look: Look): void {
    const kind = look.top.kind;
    const skinMat = this.mat(look.skin);
    const darkMat = this.mat(INK);
    const topMat = this.mat(look.top.color);
    const layered = kind === "jacket" || kind === "cardigan" || kind === "vest";
    const shirtColor = look.top.shirt ?? (layered || kind === "sweater" ? WHITE_SHIRT : look.top.color);
    const shirtMat = this.mat(shirtColor);
    const bottomMat = this.mat(look.bottom);
    // Vests leave the shirt sleeves showing; everything else colours the sleeves with the top.
    const sleeveMat = kind === "vest" ? shirtMat : topMat;
    // The torso cylinder shows the layer under any jacket/cardigan/vest.
    const torsoMat = layered ? shirtMat : topMat;

    this.rig.scale.set(look.width, look.height, look.width);
    const slump = look.slump === true;
    const shoulderY = slump ? 0.96 : 1.02;

    // Legs: pivot at the hip, mesh hangs below.
    for (const [grp, x] of [
      [this.legL, -0.11],
      [this.legR, 0.11],
    ] as const) {
      grp.position.set(x, 0.4, 0);
      const leg = this.mesh(new THREE.BoxGeometry(0.16, 0.4, 0.16), bottomMat);
      leg.position.y = -0.2;
      grp.add(leg);
      this.rig.add(grp);
    }
    // Torso.
    const body = this.mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.62, 10), torsoMat);
    body.position.y = 0.71;
    this.rig.add(body);
    const shoulders = this.mesh(new THREE.SphereGeometry(0.26, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), sleeveMat);
    shoulders.position.y = shoulderY;
    if (slump) shoulders.scale.set(1.05, 0.7, 1.05);
    this.rig.add(shoulders);
    if (kind === "dress") {
      const skirt = this.mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.3, 10), topMat);
      skirt.position.y = 0.42;
      this.rig.add(skirt);
    }
    // Arms: pivot at the shoulder.
    for (const [grp, x] of [
      [this.armL, -0.36],
      [this.armR, 0.36],
    ] as const) {
      grp.position.set(x, shoulderY - 0.04, 0);
      const arm = this.mesh(new THREE.BoxGeometry(0.12, 0.42, 0.12), sleeveMat);
      arm.position.y = -0.21;
      grp.add(arm);
      const hand = this.mesh(new THREE.SphereGeometry(0.07, 8, 6), skinMat);
      hand.position.y = -0.44;
      grp.add(hand);
      this.rig.add(grp);
    }
    // Head and face: pivot at the neck.
    this.headGroup.position.set(0, shoulderY, 0);
    const head = this.mesh(new THREE.SphereGeometry(0.24, 12, 10), skinMat);
    head.position.y = 0.26;
    this.headGroup.add(head);
    for (const x of [-0.09, 0.09]) {
      const eye = this.mesh(new THREE.SphereGeometry(0.035, 6, 6), darkMat);
      eye.position.set(x, 0.3, 0.21);
      this.headGroup.add(eye);
    }
    if (look.smile) {
      const r = look.smile === "big" ? 0.09 : 0.065;
      const mouth = this.mesh(new THREE.TorusGeometry(r, 0.013, 6, 10, Math.PI), darkMat);
      mouth.rotation.z = Math.PI;
      mouth.position.set(0, 0.2, 0.225);
      this.headGroup.add(mouth);
    }
    this.headBase.x = look.headTilt?.x ?? 0;
    this.headBase.z = look.headTilt?.z ?? 0;
    this.rig.add(this.headGroup);
    this.group.add(this.rig);

    this.addClothes(look, topMat, shirtMat, darkMat);
    if (look.tie !== null) this.addTie(look.tie, look.tieStyle, kind === "sweater" || kind === "vest");
    if (look.glasses) this.addGlasses(darkMat);
    this.addHair(look.hair.shape, look.hair.color);
    this.addProp(look.prop, darkMat);
  }

  private addClothes(look: Look, topMat: THREE.Material, shirtMat: THREE.Material, darkMat: THREE.Material): void {
    const rig = this.rig;
    const lighter = (c: number) => this.mat(pastel(c, 0.25));
    switch (look.top.kind) {
      case "jacket": {
        // A slightly wider box than the torso, open at the front so the shirt and tie show.
        const back = this.mesh(new THREE.BoxGeometry(0.66, 0.58, 0.46), topMat);
        back.position.set(0, 0.7, -0.08);
        rig.add(back);
        for (const x of [-0.21, 0.21]) {
          const panel = this.mesh(new THREE.BoxGeometry(0.24, 0.58, 0.18), topMat);
          panel.position.set(x, 0.7, 0.22);
          rig.add(panel);
        }
        // Lapels: two thin wedges folded outward from the opening.
        const lapelMat = lighter(look.top.color);
        for (const side of [-1, 1]) {
          const lapel = this.mesh(wedgeGeometry(0.04, 0.12, 0.3, 0.3), lapelMat);
          lapel.position.set(side * 0.1, 0.86, 0.32);
          lapel.rotation.z = side * 0.35;
          rig.add(lapel);
        }
        break;
      }
      case "cardigan": {
        const back = this.mesh(new THREE.BoxGeometry(0.62, 0.62, 0.44), topMat);
        back.position.set(0, 0.68, -0.08);
        rig.add(back);
        for (const x of [-0.19, 0.19]) {
          const panel = this.mesh(new THREE.BoxGeometry(0.22, 0.62, 0.16), topMat);
          panel.position.set(x, 0.68, 0.22);
          rig.add(panel);
        }
        // Three little buttons down one edge.
        for (let i = 0; i < 3; i++) {
          const button = this.mesh(new THREE.SphereGeometry(0.022, 6, 6), darkMat);
          button.position.set(0.09, 0.9 - i * 0.14, 0.31);
          rig.add(button);
        }
        break;
      }
      case "vest": {
        const vest = this.mesh(new THREE.BoxGeometry(0.56, 0.5, 0.56), topMat);
        vest.position.set(0, 0.66, 0);
        rig.add(vest);
        // A V of shirt collar over the vest's neckline.
        for (const side of [-1, 1]) {
          const collar = this.mesh(wedgeGeometry(0.03, 0.1, 0.2, 0.3), shirtMat);
          collar.position.set(side * 0.07, 0.9, 0.29);
          collar.rotation.z = side * 0.6;
          rig.add(collar);
        }
        break;
      }
      case "sweater": {
        for (const side of [-1, 1]) {
          const collar = this.mesh(wedgeGeometry(0.03, 0.1, 0.18, 0.3), shirtMat);
          collar.position.set(side * 0.07, 0.92, 0.29);
          collar.rotation.z = side * 0.6;
          rig.add(collar);
        }
        break;
      }
      case "polo": {
        const collarMat = lighter(look.top.color);
        for (const side of [-1, 1]) {
          const flap = this.mesh(new THREE.BoxGeometry(0.1, 0.1, 0.03), collarMat);
          flap.position.set(side * 0.08, 0.95, 0.27);
          flap.rotation.z = side * -0.5;
          rig.add(flap);
        }
        break;
      }
      case "warehouse": {
        // Chest pocket and a button placket.
        const pocket = this.mesh(new THREE.BoxGeometry(0.14, 0.12, 0.02), lighter(look.top.color));
        pocket.position.set(-0.12, 0.8, 0.29);
        rig.add(pocket);
        for (let i = 0; i < 3; i++) {
          const button = this.mesh(new THREE.SphereGeometry(0.02, 6, 6), darkMat);
          button.position.set(0, 0.9 - i * 0.14, 0.3);
          rig.add(button);
        }
        break;
      }
      case "dress":
      case "shirt":
        break;
    }
  }

  /** A thin tapered tie: knot plus blade. `short` stops at a sweater or vest neckline. */
  private addTie(color: number, style: Look["tieStyle"], short: boolean): void {
    const mat = this.mat(color);
    const w = style === "skinny" ? 0.6 : 1;
    const knot = this.mesh(new THREE.BoxGeometry(0.08 * w, 0.06, 0.04), mat);
    knot.position.set(0, 0.99, 0.29);
    const bladeH = short ? 0.1 : 0.34;
    const blade = this.mesh(wedgeGeometry(0.05 * w, 0.1 * w, bladeH, 0.4), mat);
    blade.position.set(0, 0.96 - bladeH / 2, 0.3);
    if (style === "loose") {
      knot.position.set(0.03, 0.95, 0.29);
      blade.position.set(0.05, 0.93 - bladeH / 2, 0.3);
      blade.rotation.z = -0.12;
    }
    this.rig.add(knot, blade);
  }

  private addGlasses(darkMat: THREE.Material): void {
    for (const x of [-0.09, 0.09]) {
      const rim = this.mesh(new THREE.TorusGeometry(0.065, 0.012, 6, 12), darkMat);
      rim.position.set(x, 0.3, 0.225);
      this.headGroup.add(rim);
    }
    const bridge = this.mesh(new THREE.BoxGeometry(0.06, 0.015, 0.015), darkMat);
    bridge.position.set(0, 0.31, 0.23);
    this.headGroup.add(bridge);
    for (const x of [-0.16, 0.16]) {
      const arm = this.mesh(new THREE.BoxGeometry(0.015, 0.015, 0.2), darkMat);
      arm.position.set(x, 0.3, 0.12);
      this.headGroup.add(arm);
    }
  }

  private addHair(shape: HairShape, color: number): void {
    const head = this.headGroup;
    const mat = this.mat(color);
    const cap = (radius = 0.255, extent = Math.PI / 2.4, y = 0.27) => {
      const m = this.mesh(new THREE.SphereGeometry(radius, 12, 8, 0, Math.PI * 2, 0, extent), mat);
      m.position.set(0, y, -0.01);
      head.add(m);
      return m;
    };
    switch (shape) {
      case "short":
        cap();
        break;
      case "side_part": {
        cap();
        const swoop = this.mesh(new THREE.BoxGeometry(0.22, 0.07, 0.14), mat);
        swoop.position.set(-0.07, 0.44, 0.15);
        swoop.rotation.z = -0.25;
        head.add(swoop);
        break;
      }
      case "centre_part": {
        cap();
        for (const side of [-1, 1]) {
          const swoop = this.mesh(new THREE.BoxGeometry(0.12, 0.07, 0.14), mat);
          swoop.position.set(side * 0.11, 0.44, 0.15);
          swoop.rotation.z = side * 0.3;
          head.add(swoop);
        }
        break;
      }
      case "ponytail": {
        cap(0.26, Math.PI / 2.1);
        const tail = this.mesh(new THREE.CylinderGeometry(0.05, 0.03, 0.3, 8), mat);
        tail.position.set(0, 0.16, -0.28);
        tail.rotation.x = 0.45;
        head.add(tail);
        const band = this.mesh(new THREE.SphereGeometry(0.06, 8, 6), mat);
        band.position.set(0, 0.3, -0.24);
        head.add(band);
        break;
      }
      case "bob": {
        // A wider cap that comes down over the ears.
        cap(0.285, Math.PI / 1.7, 0.29);
        for (const x of [-0.23, 0.23]) {
          const side = this.mesh(new THREE.BoxGeometry(0.1, 0.24, 0.22), mat);
          side.position.set(x, 0.2, -0.03);
          head.add(side);
        }
        break;
      }
      case "long": {
        cap(0.275, Math.PI / 1.8, 0.29);
        for (const x of [-0.22, 0.22]) {
          const side = this.mesh(new THREE.BoxGeometry(0.1, 0.3, 0.2), mat);
          side.position.set(x, 0.16, -0.06);
          head.add(side);
        }
        const back = this.mesh(new THREE.BoxGeometry(0.4, 0.44, 0.1), mat);
        back.position.set(0, 0.06, -0.21);
        head.add(back);
        break;
      }
      case "shoulder": {
        cap(0.27, Math.PI / 1.9, 0.29);
        for (const x of [-0.22, 0.22]) {
          const side = this.mesh(new THREE.BoxGeometry(0.1, 0.26, 0.18), mat);
          side.position.set(x, 0.18, -0.06);
          head.add(side);
        }
        const back = this.mesh(new THREE.BoxGeometry(0.4, 0.3, 0.1), mat);
        back.position.set(0, 0.12, -0.2);
        head.add(back);
        break;
      }
      case "bun": {
        cap(0.26, Math.PI / 2.2);
        const bun = this.mesh(new THREE.SphereGeometry(0.09, 8, 6), mat);
        bun.position.set(0, 0.42, -0.2);
        head.add(bun);
        break;
      }
      case "bald":
        break;
      case "fringe": {
        // Hair only around the back and sides.
        const ring = this.mesh(new THREE.TorusGeometry(0.22, 0.05, 6, 16, Math.PI), mat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(0, 0.28, 0);
        head.add(ring);
        break;
      }
      case "curly": {
        const spots: [number, number, number][] = [
          [0, 0.5, 0],
          [-0.15, 0.46, 0.08],
          [0.15, 0.46, 0.08],
          [-0.2, 0.38, -0.1],
          [0.2, 0.38, -0.1],
          [0, 0.42, -0.2],
          [-0.12, 0.47, -0.12],
          [0.12, 0.47, -0.12],
        ];
        for (const [x, y, z] of spots) {
          const curl = this.mesh(new THREE.SphereGeometry(0.11, 8, 6), mat);
          curl.position.set(x, y, z);
          head.add(curl);
        }
        break;
      }
      case "slicked": {
        const m = cap(0.26, Math.PI / 2.6, 0.26);
        m.scale.set(1, 0.75, 1.05);
        m.position.z = -0.03;
        break;
      }
      case "messy": {
        cap();
        const bumps: [number, number, number][] = [
          [-0.1, 0.5, 0.05],
          [0.08, 0.52, -0.04],
          [0.16, 0.45, 0.1],
          [-0.17, 0.44, -0.08],
        ];
        for (const [x, y, z] of bumps) {
          const tuft = this.mesh(new THREE.SphereGeometry(0.075, 7, 5), mat);
          tuft.position.set(x, y, z);
          head.add(tuft);
        }
        break;
      }
      case "thin": {
        // A sparse, flat cap that leaves the crown mostly bare.
        const m = cap(0.25, Math.PI / 3.2, 0.26);
        m.scale.set(1.02, 0.55, 1.02);
        m.position.z = -0.05;
        break;
      }
      case "cap": {
        const crown = this.mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.12, 10), mat);
        crown.position.set(0, 0.44, 0);
        const brim = this.mesh(new THREE.BoxGeometry(0.3, 0.03, 0.22), mat);
        brim.position.set(0, 0.39, 0.27);
        head.add(crown, brim);
        break;
      }
    }
  }

  private addProp(prop: PropKind, darkMat: THREE.Material): void {
    switch (prop) {
      case "calculator_watch": {
        const strap = this.mesh(new THREE.BoxGeometry(0.14, 0.05, 0.14), darkMat);
        strap.position.set(0, -0.37, 0);
        const face = this.mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), this.mat(0xb5e48c));
        face.position.set(0, -0.37, 0.075);
        this.armL.add(strap, face);
        break;
      }
      case "cat_pin": {
        const pin = this.mesh(new THREE.SphereGeometry(0.03, 8, 6), this.mat(0xf7d774));
        pin.position.set(0.12, 0.9, 0.3);
        this.rig.add(pin);
        break;
      }
      case "crossword": {
        const paper = this.mesh(new THREE.BoxGeometry(0.2, 0.26, 0.012), this.mat(0xffffff));
        paper.position.set(0, -0.42, 0.1);
        paper.rotation.x = -0.4;
        const grid = this.mesh(new THREE.BoxGeometry(0.12, 0.12, 0.006), this.mat(0xd9d9e3));
        grid.position.set(0, -0.4, 0.11);
        grid.rotation.x = -0.4;
        this.armL.add(paper, grid);
        break;
      }
      case "mug": {
        const mug = this.mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.14, 8), this.mat(0xffffff));
        mug.position.set(0, -0.46, 0.08);
        this.armL.add(mug);
        break;
      }
      case "clipboard": {
        const board = this.mesh(new THREE.BoxGeometry(0.3, 0.38, 0.03), this.mat(0x8d5524));
        board.position.set(0.02, -0.4, 0.12);
        this.armL.add(board);
        break;
      }
      case "badge": {
        const strap = this.mesh(new THREE.BoxGeometry(0.1, 0.22, 0.02), darkMat);
        strap.position.set(-0.08, 0.88, 0.3);
        const card = this.mesh(new THREE.BoxGeometry(0.14, 0.1, 0.02), this.mat(0xffffff));
        card.position.set(-0.08, 0.72, 0.31);
        this.rig.add(strap, card);
        break;
      }
      case "pen": {
        const pen = this.mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6), darkMat);
        pen.position.set(0.16, 0.86, 0.3);
        pen.rotation.z = 0.1;
        this.rig.add(pen);
        break;
      }
      case null:
        break;
    }
  }

  private addAccessory(role: RoleId, bodyMat: THREE.Material, darkMat: THREE.Material): void {
    const head = this.headGroup;
    switch (role) {
      case "ceo": {
        const tie = this.mesh(new THREE.BoxGeometry(0.1, 0.36, 0.03), this.mat(0xd62828));
        tie.position.set(0, 0.84, 0.29);
        this.rig.add(tie);
        break;
      }
      case "pm": {
        const board = this.mesh(new THREE.BoxGeometry(0.3, 0.38, 0.03), this.mat(0x8d5524));
        board.position.set(0.02, -0.4, 0.12);
        const paper = this.mesh(new THREE.BoxGeometry(0.26, 0.32, 0.01), this.mat(0xffffff));
        paper.position.set(0.02, -0.4, 0.135);
        this.armL.add(board, paper);
        break;
      }
      case "engineer": {
        // Hood: back half of a sphere behind the head, plus headphones.
        const hood = this.mesh(new THREE.SphereGeometry(0.29, 10, 8, Math.PI, Math.PI), bodyMat);
        hood.position.set(0, 0.24, -0.02);
        head.add(hood);
        const band = this.mesh(new THREE.TorusGeometry(0.27, 0.035, 6, 14, Math.PI), darkMat);
        band.position.set(0, 0.28, 0);
        head.add(band);
        for (const x of [-0.26, 0.26]) {
          const cupM = this.mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 10), darkMat);
          cupM.rotation.z = Math.PI / 2;
          cupM.position.set(x, 0.24, 0);
          head.add(cupM);
        }
        break;
      }
      case "qa": {
        const ring = this.mesh(new THREE.TorusGeometry(0.12, 0.025, 6, 14), darkMat);
        ring.position.set(0, -0.56, 0.05);
        const handle = this.mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 6), darkMat);
        handle.position.set(0, -0.4, 0.05);
        this.armR.add(ring, handle);
        break;
      }
      case "designer": {
        const beret = this.mesh(new THREE.CylinderGeometry(0.27, 0.2, 0.1, 10), this.mat(0xc1121f));
        beret.position.set(0.05, 0.46, 0);
        beret.rotation.z = -0.3;
        head.add(beret);
        break;
      }
      case "backend":
      case "frontend": {
        const capMat = this.mat(role === "backend" ? 0x0353a4 : 0xd81159);
        const cap = this.mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.12, 10), capMat);
        cap.position.set(0, 0.44, 0);
        const brim = this.mesh(new THREE.BoxGeometry(0.3, 0.03, 0.22), capMat);
        brim.position.set(0, 0.39, 0.27);
        head.add(cap, brim);
        break;
      }
      case "marketing": {
        const horn = this.mesh(new THREE.ConeGeometry(0.14, 0.32, 8), this.mat(0xef233c));
        horn.rotation.x = Math.PI / 2;
        horn.position.set(0, -0.44, 0.2);
        this.armR.add(horn);
        break;
      }
      case "legal": {
        const briefcase = this.mesh(new THREE.BoxGeometry(0.32, 0.26, 0.1), this.mat(0x4a2c2a));
        briefcase.position.set(0, -0.58, 0.02);
        this.armL.add(briefcase);
        break;
      }
      case "hr": {
        const strap = this.mesh(new THREE.BoxGeometry(0.14, 0.3, 0.02), this.mat(0x1d4ed8));
        strap.position.set(0, 0.86, 0.29);
        const card = this.mesh(new THREE.BoxGeometry(0.16, 0.12, 0.02), this.mat(0xffffff));
        card.position.set(0, 0.66, 0.3);
        this.rig.add(strap, card);
        break;
      }
      case "it": {
        const shaft = this.mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.2, 6), this.mat(0xbfc0c0));
        shaft.position.set(0, -0.58, 0.04);
        const handle = this.mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 6), this.mat(0xffd60a));
        handle.position.set(0, -0.44, 0.04);
        this.armR.add(shaft, handle);
        break;
      }
      case "intern":
        this.cupAlways = true;
        break;
      case "cfo": {
        const calc = this.mesh(new THREE.BoxGeometry(0.16, 0.24, 0.03), darkMat);
        calc.position.set(0, -0.44, 0.1);
        const screen = this.mesh(new THREE.BoxGeometry(0.12, 0.06, 0.01), this.mat(0xb5e48c));
        screen.position.set(0, -0.36, 0.12);
        this.armL.add(calc, screen);
        break;
      }
      case "receptionist": {
        const band = this.mesh(new THREE.TorusGeometry(0.27, 0.02, 6, 14, Math.PI), darkMat);
        band.position.set(0, 0.28, 0);
        head.add(band);
        const mic = this.mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 6), darkMat);
        mic.rotation.z = Math.PI / 2;
        mic.rotation.y = 0.5;
        mic.position.set(0.14, 0.18, 0.18);
        head.add(mic);
        break;
      }
    }
  }

  private makeCup(): THREE.Mesh {
    const cup = this.mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.14, 8), this.mat(0xffffff));
    cup.position.set(0, -0.46, 0.08);
    this.armR.add(cup);
    return cup;
  }

  private makeFolder(): THREE.Mesh {
    const folder = this.mesh(new THREE.BoxGeometry(0.34, 0.26, 0.04), this.mat(0xffd166));
    folder.position.set(0, -0.44, 0.12);
    this.armR.add(folder);
    return folder;
  }

  private makeNameTag(): THREE.Sprite {
    const w = 320;
    const h = 72;
    const { canvas, ctx } = makeCanvas(w, h);
    const badge = this.agent.model ? MODEL_BADGE[this.agent.model] : null;
    ctx.fillStyle = "rgba(15, 18, 28, 0.82)";
    roundRect(ctx, 4, 4, w - 8, h - 8, 16);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 28px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    const nameMax = badge ? w - 140 : w - 40;
    const name = this.agent.name;
    let shown = name;
    while (shown.length > 2 && ctx.measureText(shown).width > nameMax) shown = `${shown.slice(0, -2)}`;
    if (shown !== name) shown = `${shown.slice(0, -1)}...`;
    ctx.fillText(shown, 20, h / 2);
    if (badge) {
      ctx.fillStyle = badge.color;
      roundRect(ctx, w - 118, 18, 100, 36, 10);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 20px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(badge.label, w - 68, h / 2 + 1);
    }
    const mat = new THREE.SpriteMaterial({ map: canvasTexture(canvas), transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    const ww = 1.9;
    sprite.scale.set(ww, (ww * h) / w, 1);
    sprite.position.set(0, 1.92, 0);
    return sprite;
  }

  private makeBubbleSprite(): THREE.Sprite {
    const { canvas } = makeCanvas(512, 176);
    const mat = new THREE.SpriteMaterial({ map: canvasTexture(canvas), transparent: true, depthWrite: false, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    const ww = 3.0;
    sprite.scale.set(ww, (ww * 176) / 512, 1);
    sprite.position.set(0, 2.65, 0);
    sprite.renderOrder = 10;
    return sprite;
  }

  private drawBubble(text: string): void {
    const map = this.bubble.material.map;
    if (!(map instanceof THREE.CanvasTexture)) return;
    const canvas = map.image as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, 6, 6, w - 12, h - 40, 22);
    ctx.fill();
    // Tail.
    ctx.beginPath();
    ctx.moveTo(w / 2 - 18, h - 36);
    ctx.lineTo(w / 2 + 18, h - 36);
    ctx.lineTo(w / 2, h - 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#1f2937";
    ctx.font = "28px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lines = wrapText(ctx, text, w - 60, 3);
    const lineH = 34;
    const top = (h - 40) / 2 - ((lines.length - 1) * lineH) / 2 + 6;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, top + i * lineH));
    map.needsUpdate = true;
  }

  private makeAlertSprite(): THREE.Sprite {
    const { canvas, ctx } = makeCanvas(64, 64);
    ctx.fillStyle = "#e63946";
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 44px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("!", 32, 34);
    const mat = new THREE.SpriteMaterial({ map: canvasTexture(canvas), transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.45, 0.45, 1);
    sprite.position.set(0.5, 1.75, 0);
    return sprite;
  }
}
