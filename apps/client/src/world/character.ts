import * as THREE from "three";
import type { Agent, AnimState, ModelTier, RoleId } from "@agentsitcom/shared";
import { Face, type Expression, type SmileBase } from "./faces";
import { spotTile, tileToWorld, type Office, type Tile } from "./office";
import { findPath, nearestWalkable } from "./pathfinding";
import { PASTEL, pastel, toonMat, OVERLAY_LAYER } from "./style";
import { canvasTexture, disposeSprite, makeCanvas, roundRect, wrapText } from "./textures";

export type { Expression } from "./faces";

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
  return LOOKS[firstNameOf(name)] ?? null;
}

function firstNameOf(name: string): string {
  return name.trim().split(/[\s(]/)[0]?.toLowerCase() ?? "";
}

/** A tapered flat wedge: a 4-sided cylinder turned 45 degrees and squashed. Used for ties, lapels and collars. */
function wedgeGeometry(topW: number, bottomW: number, h: number, depth: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(topW / Math.SQRT2, bottomW / Math.SQRT2, h, 4);
  g.rotateY(Math.PI / 4);
  g.scale(1, 1, depth);
  return g;
}

const SKIN = 0xf1c27d;
const WALK_SPEED = 3.4; // world units (tiles) per second at full stride
const STRIDE_LEN = 0.95; // world units per full gait cycle (two steps)
const POSE_BLEND = 0.35; // seconds to ease between base poses
const HIP_Y = 0.4;

/** The camera's world position, captured on render so heads can turn to it. */
const CAMERA_POS = new THREE.Vector3(0, 12, 14);

interface WalkCmd {
  target: Tile;
  then: AnimState;
  face: Tile | null;
  resolve: (arrived: boolean) => void;
}

export type CarryKind = "folder" | null;

/** Something a head (and eyes) can be pointed at. */
export type LookTarget = Character | THREE.Vector3 | "camera";

export type GestureName =
  | "nod"
  | "headShake"
  | "shrug"
  | "point"
  | "facepalm"
  | "thumbsUp"
  | "armsCrossed"
  | "lookAtCamera"
  | "leanIn"
  | "stretch"
  | "lookAround"
  | "lookAroundSlow"
  | "checkWatch"
  | "sip"
  | "tapPen"
  | "rubEyes"
  | "adjustGlasses"
  | "crackKnuckles"
  | "yawn"
  | "straightenTie";

// ---- pose ----------------------------------------------------------------------

const POSE_KEYS = [
  "rigY",
  "leanX",
  "swayZ",
  "twistY",
  "headX",
  "headY",
  "headZ",
  "headBob",
  "armLX",
  "armLY",
  "armLZ",
  "armRX",
  "armRY",
  "armRZ",
  "elbL",
  "elbR",
  "hipL",
  "hipR",
  "kneeL",
  "kneeR",
] as const;
type PoseKey = (typeof POSE_KEYS)[number];
type Pose = Record<PoseKey, number>;

function zeroPose(): Pose {
  const p = {} as Pose;
  for (const k of POSE_KEYS) p[k] = 0;
  return p;
}

function copyPose(dst: Pose, src: Pose): void {
  for (const k of POSE_KEYS) dst[k] = src[k];
}

function easeInOut(x: number): number {
  const k = THREE.MathUtils.clamp(x, 0, 1);
  return k * k * (3 - 2 * k);
}

function smoothstep(a: number, b: number, x: number): number {
  return easeInOut((x - a) / (b - a));
}

interface ActiveGesture {
  name: GestureName;
  start: number;
  dur: number;
  target: LookTarget | null;
  /** Per-gesture scratch: the local yaw a pointing arm aims at. */
  aim: number;
}

interface GestureDef {
  dur: number;
  /** Fraction of the duration spent easing in / out. */
  attack: number;
  release: number;
  /** Adds the gesture's offsets to `out`. `e` is the eased envelope, `p` raw progress 0..1. */
  apply: (out: Pose, e: number, p: number, t: number, g: ActiveGesture) => void;
}

const TAU = Math.PI * 2;
const both = (out: Pose, k: "X" | "Z", v: number) => {
  out[`armL${k}`] += k === "Z" ? -v : v;
  out[`armR${k}`] += v;
};

const GESTURES: Record<GestureName, GestureDef> = {
  nod: { dur: 1.0, attack: 0.15, release: 0.25, apply: (o, e, p) => void (o.headX += Math.sin(p * TAU * 2) * 0.22 * e) },
  headShake: { dur: 1.1, attack: 0.15, release: 0.25, apply: (o, e, p) => void (o.headY += Math.sin(p * TAU * 2.5) * 0.35 * e) },
  shrug: {
    dur: 1.3,
    attack: 0.3,
    release: 0.3,
    apply: (o, e) => {
      both(o, "Z", 0.45 * e);
      o.elbL -= 1.3 * e;
      o.elbR -= 1.3 * e;
      o.rigY += 0.03 * e;
      o.headZ += 0.14 * e;
    },
  },
  point: {
    dur: 1.5,
    attack: 0.25,
    release: 0.3,
    apply: (o, e, _p, _t, g) => {
      o.armRX -= (Math.PI / 2 + 0.1) * e;
      o.armRY += g.aim * e;
      o.headY += THREE.MathUtils.clamp(g.aim, -1, 1) * 0.6 * e;
    },
  },
  facepalm: {
    dur: 1.5,
    attack: 0.25,
    release: 0.3,
    apply: (o, e) => {
      o.armRX -= 2.45 * e;
      o.armRZ -= 0.42 * e;
      o.elbR -= 1.0 * e;
      o.headX += 0.4 * e;
      o.leanX += 0.08 * e;
    },
  },
  thumbsUp: {
    dur: 1.3,
    attack: 0.3,
    release: 0.3,
    apply: (o, e) => {
      o.armRX -= 0.5 * e;
      o.armRZ += 0.1 * e;
      o.elbR -= 1.7 * e;
      o.headZ -= 0.1 * e;
    },
  },
  armsCrossed: {
    dur: 3.2,
    attack: 0.15,
    release: 0.15,
    apply: (o, e) => {
      o.armLX -= 0.45 * e;
      o.armRX -= 0.45 * e;
      o.armLZ += 0.62 * e;
      o.armRZ -= 0.62 * e;
      o.elbL -= 1.95 * e;
      o.elbR -= 1.95 * e;
      o.leanX -= 0.05 * e;
    },
  },
  // The Jim look: the head is steered to the camera by the look system; this only holds the timing.
  lookAtCamera: { dur: 1.6, attack: 0.15, release: 0.2, apply: () => undefined },
  leanIn: {
    dur: 1.5,
    attack: 0.3,
    release: 0.3,
    apply: (o, e) => {
      o.leanX += 0.3 * e;
      o.headX += 0.08 * e;
      o.rigY -= 0.02 * e;
    },
  },
  stretch: {
    dur: 1.6,
    attack: 0.3,
    release: 0.3,
    apply: (o, e, p, t) => {
      both(o, "X", -2.75 * e);
      both(o, "Z", -0.25 * e);
      o.elbL -= 0.3 * e;
      o.elbR -= 0.3 * e;
      o.leanX -= 0.1 * e;
      o.headX -= 0.25 * e;
      o.swayZ += Math.sin(t * 2) * 0.04 * e * (p > 0.3 ? 1 : 0);
    },
  },
  lookAround: { dur: 2.0, attack: 0.2, release: 0.2, apply: (o, e, p) => void (o.headY += Math.sin(p * TAU) * 0.7 * e) },
  lookAroundSlow: {
    dur: 3.4,
    attack: 0.2,
    release: 0.2,
    apply: (o, e, p) => {
      o.headY += Math.sin(p * TAU) * 0.8 * e;
      o.headX -= 0.05 * e;
    },
  },
  checkWatch: {
    dur: 1.5,
    attack: 0.25,
    release: 0.3,
    apply: (o, e) => {
      o.armLX -= 0.35 * e;
      o.armLZ += 0.3 * e;
      o.elbL -= 2.0 * e;
      o.headX += 0.35 * e;
      o.headY -= 0.35 * e;
    },
  },
  sip: {
    dur: 1.5,
    attack: 0.3,
    release: 0.3,
    apply: (o, e) => {
      o.armRX -= 0.25 * e;
      o.armRZ -= 0.2 * e;
      o.elbR -= 2.3 * e;
      o.headX -= 0.18 * e;
    },
  },
  tapPen: {
    dur: 1.3,
    attack: 0.2,
    release: 0.2,
    apply: (o, e, _p, t) => {
      o.elbR -= 1.2 * e;
      o.elbR += Math.sin(t * 26) * 0.08 * e;
    },
  },
  rubEyes: {
    dur: 1.5,
    attack: 0.25,
    release: 0.3,
    apply: (o, e, _p, t) => {
      both(o, "X", -2.4 * e);
      o.armLZ += 0.4 * e;
      o.armRZ -= 0.4 * e;
      o.elbL -= 1.05 * e;
      o.elbR -= 1.05 * e;
      o.headX += 0.25 * e + Math.sin(t * 14) * 0.02 * e;
    },
  },
  adjustGlasses: {
    dur: 1.1,
    attack: 0.3,
    release: 0.3,
    apply: (o, e) => {
      o.armRX -= 2.3 * e;
      o.armRZ -= 0.38 * e;
      o.elbR -= 1.15 * e;
      o.headX -= 0.06 * e;
    },
  },
  crackKnuckles: {
    dur: 1.5,
    attack: 0.25,
    release: 0.25,
    apply: (o, e, _p, t) => {
      both(o, "X", -0.35 * e);
      o.armLZ += 0.25 * e;
      o.armRZ -= 0.25 * e;
      o.elbL -= 1.7 * e;
      o.elbR -= 1.7 * e;
      o.twistY += Math.sin(t * 9) * 0.05 * e;
    },
  },
  yawn: {
    dur: 1.7,
    attack: 0.3,
    release: 0.25,
    apply: (o, e) => {
      o.headX -= 0.3 * e;
      o.armRX -= 2.35 * e;
      o.armRZ -= 0.4 * e;
      o.elbR -= 1.0 * e;
      o.leanX -= 0.06 * e;
    },
  },
  straightenTie: {
    dur: 1.3,
    attack: 0.3,
    release: 0.3,
    apply: (o, e, _p, t) => {
      both(o, "X", -0.5 * e);
      o.armLZ += 0.38 * e;
      o.armRZ -= 0.38 * e;
      o.elbL -= 2.05 * e;
      o.elbR -= 2.05 * e;
      o.headX -= 0.12 * e;
      o.headY += Math.sin(t * 5) * 0.06 * e;
    },
  },
};

/** Fidgets chosen per cast member; anyone else gets a list built from their look. */
const FIDGETS_BY_NAME: Record<string, GestureName[]> = {
  michael: ["straightenTie", "lookAround"],
  dwight: ["adjustGlasses", "checkWatch"],
  kevin: ["yawn", "stretch"],
  angela: ["armsCrossed", "lookAround"],
  creed: ["lookAroundSlow"],
  jim: ["lookAround", "tapPen"],
  pam: ["tapPen", "stretch"],
  stanley: ["rubEyes", "checkWatch"],
  oscar: ["tapPen", "crackKnuckles"],
  meredith: ["sip"],
  toby: ["rubEyes", "lookAround"],
  ryan: ["crackKnuckles", "lookAround"],
  andy: ["stretch", "straightenTie"],
  kelly: ["lookAround", "stretch"],
  phyllis: ["lookAround", "stretch"],
  darryl: ["crackKnuckles", "lookAround"],
  erin: ["lookAround", "stretch"],
};

// ---- secondary motion -----------------------------------------------------------

/**
 * A two-segment pendulum driven by the body's acceleration: the first
 * segment lags the body, the second lags the first. Angles are added on
 * top of each pivot's resting rotation.
 */
class Pendulum {
  private a = 0;
  private va = 0;
  private b = 0;
  private vb = 0;
  private a2 = 0;
  private va2 = 0;
  private b2 = 0;
  private vb2 = 0;

  constructor(
    private readonly p1: THREE.Object3D,
    private readonly p2: THREE.Object3D | null,
    private readonly restX: number,
    private readonly restZ: number,
    private readonly gain: number,
  ) {}

  update(dt: number, accZ: number, accX: number): void {
    const d = Math.min(dt, 0.05);
    const k = 70;
    const c = 7.5;
    const aa = -k * this.a - c * this.va + this.gain * accZ;
    const ab = -k * this.b - c * this.vb - this.gain * accX;
    this.va += aa * d;
    this.vb += ab * d;
    this.a = THREE.MathUtils.clamp(this.a + this.va * d, -0.6, 0.6);
    this.b = THREE.MathUtils.clamp(this.b + this.vb * d, -0.6, 0.6);
    this.p1.rotation.x = this.restX + this.a;
    this.p1.rotation.z = this.restZ + this.b;
    if (this.p2) {
      const aa2 = -k * 1.3 * this.a2 - c * this.va2 - 0.7 * aa;
      const ab2 = -k * 1.3 * this.b2 - c * this.vb2 - 0.7 * ab;
      this.va2 += aa2 * d;
      this.vb2 += ab2 * d;
      this.a2 = THREE.MathUtils.clamp(this.a2 + this.va2 * d, -0.5, 0.5);
      this.b2 = THREE.MathUtils.clamp(this.b2 + this.vb2 * d, -0.5, 0.5);
      this.p2.rotation.x = this.a2;
      this.p2.rotation.z = this.b2;
    }
  }
}

/** A damped spring on one scalar; `kick` adds velocity for an overshoot-and-settle. */
class Spring {
  x = 0;
  v = 0;
  constructor(
    private readonly k: number,
    private readonly c: number,
  ) {}
  kick(v: number): void {
    this.v += v;
  }
  update(dt: number): number {
    const d = Math.min(dt, 0.05);
    this.v += (-this.k * this.x - this.c * this.v) * d;
    this.x += this.v * d;
    return this.x;
  }
}

/**
 * A primitive-built low-poly figure with a jointed rig: hips, torso, head,
 * two-part arms and legs. Movement follows A* paths smoothed into a
 * Catmull-Rom curve; a new goTo while walking is queued and takes over at
 * the next tile. Poses blend over ~0.35 s; gestures and fidgets layer on top.
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
  /** Squash and stretch, pivot at the feet. */
  private readonly squash = new THREE.Group();
  /** Look scale and the body bob. */
  private readonly rig = new THREE.Group();
  /** Pivot at the hips: lean, sway and twist. */
  private readonly torso = new THREE.Group();
  /** Inside the torso, offset so meshes keep their standing coordinates. */
  private readonly upper = new THREE.Group();
  private readonly headGroup = new THREE.Group();
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly elbL = new THREE.Group();
  private readonly elbR = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly kneeL = new THREE.Group();
  private readonly kneeR = new THREE.Group();
  private readonly look: Look | null;
  private readonly headBase = { x: 0, z: 0 };
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly face: Face;
  private nameTag: THREE.Sprite;
  private readonly bubble: THREE.Sprite;
  private readonly alert: THREE.Sprite;
  private readonly cup: THREE.Group;
  private readonly folder: THREE.Mesh;
  private readonly pendulums: Pendulum[] = [];
  private cupAlways = false;
  private carrying: CarryKind = null;
  private readonly fidgets: GestureName[];

  // Walking.
  private path: Tile[] = [];
  private pathArc: number[] = [];
  private pathIndex = 0;
  private curve: THREE.CatmullRomCurve3 | null = null;
  private curveLen = 0;
  private dist = 0;
  private walkTime = 0;
  private speed = 0;
  private stride = 0;
  private current: WalkCmd | null = null;
  private pending: WalkCmd | null = null;
  private faceTile: Tile | null = null;
  private yaw = 0;
  private targetYaw = 0;
  private yawRate = 0;

  // Posing.
  private readonly pose = zeroPose();
  private readonly poseFrom = zeroPose();
  private readonly poseTarget = zeroPose();
  private readonly shown = zeroPose();
  private blendT = 1;
  private lastPoseKey = "";
  private readonly scaleSpring = new Spring(220, 18);
  private readonly leanSpring = new Spring(160, 14);
  private readonly gestures: ActiveGesture[] = [];
  private lookTarget: LookTarget | null = null;
  private lookYaw = 0;
  private lookPitch = 0;
  private readonly prevPos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly acc = new THREE.Vector3();

  // Face.
  private expr: Expression | null = null;
  private exprUntil = 0;
  private nextBlink = 0;
  private blinkUntil = 0;
  private nextMouth = 0;
  private mouthOpen = false;

  private t = Math.random() * 10;
  private bubbleUntil = 0;
  private celebrateStart = -10;
  private celebrateUntil = 0;
  private lastJumpIndex = -1;
  private typingBoostUntil = 0;
  private waveUntil = 0;
  private glanceUntil = 0;
  private nextFidget = 0;
  private fade: { from: number; to: number; elapsed: number; dur: number; done: () => void } | null = null;
  private paperCount = 0;

  constructor(agent: Agent, office: Office, startTile: Tile, opts: { small?: boolean } = {}) {
    this.agent = agent;
    this.office = office;
    this.tile = { ...startTile };
    this.look = agent.kind === "contractor" ? null : lookFor(agent.name);
    this.group.userData.character = true;
    this.group.userData.agentId = agent.id;
    const smileBase: SmileBase = this.look?.smile === "big" ? 2 : this.look?.smile === "warm" ? 1 : 0;
    this.face = new Face(smileBase, this.look?.glasses ?? false);
    this.setupRig();
    if (this.look) this.buildLookBody(this.look);
    else this.buildBody(opts.small === true);
    this.fidgets = this.pickFidgets();
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
    this.prevPos.copy(this.group.position);
    if (opts.small) this.group.scale.setScalar(0.62);
    // Taller builds carry their tag, bubble and alert higher.
    const h = this.look?.height ?? 1;
    this.nameTag.position.y = 1.92 * h;
    this.bubble.position.y = 2.65 + (h - 1) * 1.4;
    this.alert.position.y = 1.75 * h;
    this.nextBlink = this.t + 1 + Math.random() * 4;
    this.nextFidget = this.t + 4 + Math.random() * 5;
    this.computeTarget(0);
    copyPose(this.pose, this.poseTarget);
    copyPose(this.poseFrom, this.poseTarget);
    copyPose(this.shown, this.poseTarget);
    this.applyPose(this.shown);
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
    this.clearPath();
    this.tile = { ...tile };
    this.group.position.copy(tileToWorld(this.tile));
    this.prevPos.copy(this.group.position);
    this.vel.set(0, 0, 0);
    if (face !== undefined) this.faceTile = face;
    if (this.faceTile) {
      this.faceToward(this.faceTile);
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
    const prev = this.state;
    this.state = state;
    if (face !== undefined) this.faceTile = face;
    if (state === "celebrate") {
      if (prev !== "celebrate") {
        this.celebrateStart = this.t;
        this.lastJumpIndex = -1;
      }
      this.celebrateUntil = this.t + 2;
    }
    if (state === "wave") this.waveUntil = this.t + 4;
    if (state === "arrive" && prev !== "arrive") this.scaleSpring.kick(-1.4);
    if (!this.current && this.faceTile) this.faceToward(this.faceTile);
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
    this.gesture("nod");
  }

  typingBoost(seconds = 2): void {
    this.typingBoostUntil = this.t + seconds;
  }

  carry(kind: CarryKind): void {
    this.carrying = kind;
    this.folder.visible = kind === "folder";
  }

  /**
   * Plays an additive gesture over whatever the body is doing. `point` aims
   * the right arm at `target`; `lookAtCamera` turns the head to the camera,
   * holds, and comes back with a smirk.
   */
  gesture(name: GestureName, target?: LookTarget | null): void {
    const def = GESTURES[name];
    const existing = this.gestures.findIndex((g) => g.name === name);
    if (existing >= 0) this.gestures.splice(existing, 1);
    if (this.gestures.length >= 2) this.gestures.shift();
    const g: ActiveGesture = { name, start: this.t, dur: def.dur, target: target ?? null, aim: 0 };
    if (name === "point" && target) g.aim = THREE.MathUtils.clamp(this.localYawTo(target), -1.4, 1.4);
    if (name === "lookAtCamera") this.setExpression("neutral", def.dur * 0.55);
    this.gestures.push(g);
  }

  /** Shows an expression; with `seconds` it reverts afterwards (to talking or neutral). */
  setExpression(name: Expression, seconds?: number): void {
    this.expr = name;
    this.exprUntil = seconds === undefined ? Infinity : this.t + seconds;
  }

  /** Turns the head and eyes toward a character, a world point or the camera; null releases. */
  lookAt(target: LookTarget | null): void {
    this.lookTarget = target;
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
    const t = this.t;
    this.updateWalk(dt);
    if (this.bubble.visible && t > this.bubbleUntil) this.bubble.visible = false;
    if (this.state === "celebrate" && t > this.celebrateUntil) {
      this.state = this.agent.currentTaskId ? "sit_typing" : "idle";
    }
    if (this.state === "wave" && t > this.waveUntil) {
      this.state = this.agent.currentTaskId ? "sit_typing" : "idle";
    }
    // Yaw smoothing (shortest arc), eased so turns never snap.
    let diff = this.targetYaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const yawStep = diff * Math.min(1, dt * (this.current ? 9 : 7));
    this.yawRate = dt > 0 ? yawStep / dt : 0;
    this.yaw += yawStep;
    this.group.rotation.y = this.yaw;

    // Body velocity and acceleration (world), for the pendulums.
    if (dt > 0) {
      const v = this.vel;
      const nv = this.group.position.clone().sub(this.prevPos).divideScalar(dt);
      const na = nv.clone().sub(v).divideScalar(dt);
      v.copy(nv);
      this.acc.lerp(na, Math.min(1, dt * 10));
      this.prevPos.copy(this.group.position);
    }

    this.updateFidgets();
    this.computeTarget(dt);
    this.blendPose(dt);
    this.applyAdditive(dt);
    this.applyPose(this.shown);
    this.updateFace(dt);
    this.updateSecondary(dt);

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
    this.face.dispose();
    disposeSprite(this.nameTag);
    disposeSprite(this.bubble);
    disposeSprite(this.alert);
    this.group.removeFromParent();
    this.papers.removeFromParent();
  }

  // ---- walking ---------------------------------------------------------------

  private clearPath(): void {
    this.path = [];
    this.pathArc = [];
    this.pathIndex = 0;
    this.curve = null;
    this.curveLen = 0;
    this.dist = 0;
    this.speed = 0;
  }

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
    this.pathIndex = 0;
    // A Catmull-Rom through the tile centres from where we actually stand,
    // so corners round off instead of snapping between straight segments.
    const points = [this.group.position.clone(), ...path.map((p) => tileToWorld(p))];
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
    curve.arcLengthDivisions = Math.max(40, points.length * 12);
    const lengths = curve.getLengths();
    this.curveLen = lengths[lengths.length - 1] ?? 0;
    const div = lengths.length - 1;
    this.pathArc = path.map((_p, i) => lengths[Math.round(((i + 1) / (points.length - 1)) * div)] ?? this.curveLen);
    this.curve = curve;
    this.dist = 0;
    this.walkTime = 0;
    if (this.state !== "arrive" && this.state !== "leave") this.state = "walk";
    this.alert.visible = false;
    this.carryPose();
  }

  private arrive(cmd: WalkCmd): void {
    const wasWalking = this.current !== null && this.speed > 0.5;
    this.current = null;
    this.clearPath();
    this.group.position.copy(tileToWorld(this.tile));
    this.faceTile = cmd.face;
    if (cmd.face) this.faceToward(cmd.face);
    this.setState(cmd.then);
    if (wasWalking) {
      this.scaleSpring.kick(-0.7);
      this.leanSpring.kick(0.9);
    }
    cmd.resolve(true);
  }

  private updateWalk(dt: number): void {
    const cmd = this.current;
    const curve = this.curve;
    if (!cmd || !curve) {
      if (cmd) this.arrive(cmd);
      this.speed = 0;
      return;
    }
    this.walkTime += dt;
    // Ease out of the start, slow into the final tile.
    const startRamp = THREE.MathUtils.clamp(0.3 + this.walkTime / 0.3, 0, 1);
    const remaining = this.curveLen - this.dist;
    const endRamp = THREE.MathUtils.clamp(0.3 + remaining / 1.1, 0, 1);
    this.speed = WALK_SPEED * Math.min(startRamp, endRamp);
    this.dist = Math.min(this.curveLen, this.dist + this.speed * dt);
    this.stride += (this.speed / STRIDE_LEN) * TAU * dt;

    // Entering a tile: becomes the current tile; a queued command takes over here.
    while (this.pathIndex < this.path.length) {
      const arc = this.pathArc[this.pathIndex] ?? this.curveLen;
      if (this.dist < arc - 0.5) break;
      const tile = this.path[this.pathIndex];
      if (tile) this.tile = { ...tile };
      this.pathIndex++;
      if (this.pending) {
        const old = cmd;
        const next = this.pending;
        this.pending = null;
        this.current = null;
        old.resolve(false);
        this.startWalk(next);
        return;
      }
    }
    const u = this.curveLen > 0 ? this.dist / this.curveLen : 1;
    if (u >= 1) {
      this.arrive(cmd);
      return;
    }
    const p = curve.getPointAt(u);
    this.group.position.set(p.x, 0, p.z);
    const tan = curve.getTangentAt(u);
    if (Math.abs(tan.x) + Math.abs(tan.z) > 1e-4) this.targetYaw = Math.atan2(tan.x, tan.z);
  }

  private faceToward(tile: Tile): void {
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

  /** Where a look target is right now, in world space. */
  private targetWorld(target: LookTarget, out: THREE.Vector3): THREE.Vector3 {
    if (target === "camera") return out.copy(CAMERA_POS);
    if (target instanceof THREE.Vector3) return out.copy(target);
    const h = target.look?.height ?? 1;
    return out.copy(target.group.position).add(new THREE.Vector3(0, 1.28 * h * target.group.scale.y, 0));
  }

  /** Yaw to a target in this character's local frame (positive = to the right). */
  private localYawTo(target: LookTarget): number {
    const p = this.targetWorld(target, new THREE.Vector3());
    const dx = p.x - this.group.position.x;
    const dz = p.z - this.group.position.z;
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    return Math.atan2(dx * c - dz * s, dx * s + dz * c);
  }

  /** The base pose for the current state (and walk cycle) into poseTarget. */
  private computeTarget(dt: number): void {
    const t = this.t;
    const o = this.poseTarget;
    for (const k of POSE_KEYS) o[k] = 0;
    const moving = this.current !== null;
    const cupVisible = this.cupAlways || this.state === "coffee";
    this.cup.visible = cupVisible;
    let key: string;

    if (moving) {
      key = "walk";
      const f = THREE.MathUtils.clamp(this.speed / WALK_SPEED, 0, 1);
      const amp = 0.35 + 0.65 * Math.sqrt(f);
      const ph = this.stride;
      const s = Math.sin(ph);
      // Legs: hip swing, knee tucks under during the forward swing.
      o.hipL = -0.6 * amp * s;
      o.hipR = 0.6 * amp * s;
      o.kneeL = Math.max(0, -Math.cos(ph)) * 0.95 * amp;
      o.kneeR = Math.max(0, Math.cos(ph)) * 0.95 * amp;
      // Opposite arm swing, elbows a little bent.
      o.armLX = 0.45 * amp * s;
      o.armRX = -0.45 * amp * s;
      o.elbL = -0.35 - Math.max(0, s) * 0.25 * amp;
      o.elbR = -0.35 - Math.max(0, -s) * 0.25 * amp;
      // Hips sway and bob at the step rate; the head bobs at the stride rate.
      o.swayZ = 0.05 * amp * s;
      o.twistY = 0.07 * amp * s;
      o.rigY = 0.03 * amp * (0.5 + 0.5 * Math.cos(2 * ph));
      o.headBob = 0.012 * amp * s;
      o.leanX = 0.14 * f;
      o.swayZ += THREE.MathUtils.clamp(-this.yawRate * 0.03, -0.08, 0.08);
      o.headZ = -THREE.MathUtils.clamp(this.yawRate * 0.02, -0.06, 0.06);
      if (this.carrying === "folder") {
        o.armRX = -0.9;
        o.elbR = -0.9;
      }
    } else {
      key = this.state;
      switch (this.state) {
        case "idle":
        case "arrive":
        case "leave":
        case "walk":
          o.rigY = Math.sin(t * 2) * 0.008;
          o.armLX = Math.sin(t * 2) * 0.04;
          o.armRX = -Math.sin(t * 2) * 0.04;
          o.elbL = o.elbR = -0.12;
          o.swayZ = Math.sin(t * 1.3) * 0.01;
          break;
        case "sit_typing": {
          this.seatedPose(o);
          o.armLX = o.armRX = -0.7;
          o.elbL = o.elbR = -1.15;
          o.headX = 0.14;
          break;
        }
        case "meeting":
          this.seatedPose(o);
          o.armLX = o.armRX = -0.3;
          o.elbL = o.elbR = -0.95;
          o.headY = Math.sin(t * 0.7) * 0.3;
          o.rigY += Math.sin(t * 1.6) * 0.004;
          break;
        case "talk":
          o.headX = Math.sin(t * 9) * 0.06;
          o.headZ = Math.sin(t * 2.3) * 0.05;
          o.armLX = -0.35 + Math.sin(t * 6) * 0.2;
          o.armRX = -0.3 + Math.cos(t * 5) * 0.2;
          o.elbL = -0.9 + Math.sin(t * 6.5) * 0.3;
          o.elbR = -0.8 + Math.cos(t * 5.5) * 0.3;
          o.armLZ = -0.15;
          o.armRZ = 0.15;
          break;
        case "blocked":
          o.headX = 0.5;
          o.armLX = o.armRX = 0.1;
          o.armLZ = -0.12;
          o.armRZ = 0.12;
          o.leanX = 0.08;
          o.rigY = -0.03;
          break;
        case "celebrate":
          o.armLX = o.armRX = Math.PI - 0.25;
          o.armLZ = -0.3 + Math.sin(t * 14) * 0.15;
          o.armRZ = 0.3 - Math.sin(t * 14) * 0.15;
          o.elbL = o.elbR = -0.3;
          o.headX = -0.15;
          break;
        case "coffee":
          o.rigY = Math.sin(t * 1.5) * 0.01;
          o.armRX = -0.3;
          o.armRZ = -0.15;
          o.elbR = -1.9;
          o.armLX = 0.1;
          o.elbL = -0.15;
          o.headX = Math.sin(t * 1.5) > 0.9 ? -0.12 : 0.05;
          o.swayZ = Math.sin(t * 0.9) * 0.015;
          break;
        case "wave":
          // Right arm up and swinging side to side, a small bounce, head cocked.
          o.rigY = Math.abs(Math.sin(t * 6)) * 0.04;
          o.armRX = Math.PI - 0.35;
          o.armRZ = Math.sin(t * 9) * 0.4;
          o.elbR = -0.5 + Math.sin(t * 9) * 0.3;
          o.armLX = Math.sin(t * 2) * 0.08;
          o.elbL = -0.12;
          o.headZ = 0.18 + Math.sin(t * 3) * 0.05;
          break;
      }
      if ((this.state === "sit_typing" || this.state === "meeting") && this.faceTile) this.faceToward(this.faceTile);
    }
    if (t < this.glanceUntil) o.headY += 0.6 * Math.sin((this.glanceUntil - t) * 5);

    if (key !== this.lastPoseKey) {
      // Snapshot what is on screen and ease into the new base pose.
      copyPose(this.poseFrom, this.pose);
      this.blendT = 0;
      if (this.lastPoseKey !== "") {
        this.scaleSpring.kick(key === "celebrate" ? 0 : -0.35);
        this.leanSpring.kick(key === "walk" ? 0.6 : -0.3);
      }
      this.lastPoseKey = key;
    }
    void dt;
  }

  /** Hips back, knees bent, feet forward: the sitting base both seated states share. */
  private seatedPose(o: Pose): void {
    o.rigY = 0.02;
    o.hipL = o.hipR = -1.5;
    o.kneeL = o.kneeR = 1.5;
    o.leanX = -0.07;
  }

  private blendPose(dt: number): void {
    this.blendT += dt;
    const k = easeInOut(this.blendT / POSE_BLEND);
    const from = this.poseFrom;
    const to = this.poseTarget;
    const out = this.pose;
    for (const key of POSE_KEYS) out[key] = from[key] + (to[key] - from[key]) * k;
  }

  /** Layers gestures, head tracking, typing jitter and the celebrate jump on the blended pose. */
  private applyAdditive(dt: number): void {
    const t = this.t;
    const o = this.shown;
    copyPose(o, this.pose);
    const moving = this.current !== null;

    // Gestures.
    for (let i = this.gestures.length - 1; i >= 0; i--) {
      const g = this.gestures[i];
      if (!g) continue;
      const p = (t - g.start) / g.dur;
      if (p >= 1) {
        this.gestures.splice(i, 1);
        continue;
      }
      const def = GESTURES[g.name];
      const e = smoothstep(0, def.attack, p) * (1 - smoothstep(1 - def.release, 1, p));
      def.apply(o, e, p, t, g);
      if (g.name === "lookAtCamera" && p > 0.55 && this.expr !== "smirk") this.setExpression("smirk", g.dur * (1 - p) + 0.6);
    }

    // Head tracking: a gesture to the camera overrides the look target while it runs.
    const camGesture = this.gestures.find((g) => g.name === "lookAtCamera");
    const target: LookTarget | null = camGesture ? "camera" : this.lookTarget;
    let wantYaw = 0;
    let wantPitch = 0;
    if (target && !(target instanceof Character && target.removed)) {
      const p = this.targetWorld(target, new THREE.Vector3());
      const dx = p.x - this.group.position.x;
      const dz = p.z - this.group.position.z;
      const c = Math.cos(this.yaw);
      const s = Math.sin(this.yaw);
      const lx = dx * c - dz * s;
      const lz = dx * s + dz * c;
      const yaw = Math.atan2(lx, lz);
      const horiz = Math.hypot(lx, lz);
      const headY = this.group.position.y + 1.28 * (this.look?.height ?? 1) * this.group.scale.y + this.pose.rigY;
      const pitch = Math.atan2(p.y - headY, Math.max(0.3, horiz));
      if (Math.abs(yaw) < 1.7) {
        wantYaw = THREE.MathUtils.clamp(yaw, -1.15, 1.15);
        wantPitch = THREE.MathUtils.clamp(pitch, -0.5, 0.45);
      }
    }
    const rate = Math.min(1, dt * (camGesture ? 9 : 5));
    this.lookYaw += (wantYaw - this.lookYaw) * rate;
    this.lookPitch += (wantPitch - this.lookPitch) * rate;
    o.headY += this.lookYaw;
    o.headX -= this.lookPitch;
    // Eyes lead the head.
    this.face.setPupils(target ? wantYaw / 0.9 : 0, target ? wantPitch / 0.5 : 0);

    // Typing: hands jitter on the keys.
    if (!moving && this.state === "sit_typing") {
      const speed = t < this.typingBoostUntil ? 40 : 18;
      o.elbL += Math.sin(t * speed) * 0.1;
      o.elbR += Math.cos(t * speed * 1.3) * 0.1;
      o.armLZ += Math.sin(t * speed * 0.7) * 0.03;
      o.armRZ += Math.cos(t * speed * 0.9) * 0.03;
    }

    // Celebrate: a crouch of anticipation, then jumps with stretch up and squash down.
    let extraY = 0;
    let stretch = 0;
    if (!moving && this.state === "celebrate") {
      const el = t - this.celebrateStart;
      if (el < 0.14) {
        extraY = -0.1 * easeInOut(el / 0.14);
        stretch = -0.1 * easeInOut(el / 0.14);
      } else {
        const period = 0.7;
        const air = 0.5;
        const tau = (el - 0.14) % period;
        if (tau < air) {
          const q = tau / air;
          extraY = 0.55 * Math.sin(Math.PI * q);
          stretch = 0.12 * Math.cos(Math.PI * q);
        }
        // Each landing squashes the body, then the spring settles it.
        if (el - 0.14 >= air) {
          const landed = Math.floor((el - 0.14 - air) / period);
          if (landed !== this.lastJumpIndex) {
            this.scaleSpring.kick(-1.6);
            this.lastJumpIndex = landed;
          }
        }
      }
    }

    // Walking: feet plant with a tiny squash of the whole body.
    let plant = 0;
    if (moving) {
      const f = THREE.MathUtils.clamp(this.speed / WALK_SPEED, 0, 1);
      plant = Math.pow(Math.max(0, -Math.cos(2 * this.stride)), 10) * f;
    }

    o.rigY += extraY;
    o.leanX += this.leanSpring.update(dt);
    const sq = this.scaleSpring.update(dt) * 0.8 + stretch - plant * 0.03;
    this.squash.scale.set(1 - sq * 0.5 + plant * 0.015, 1 + sq, 1 - sq * 0.5 + plant * 0.015);
  }

  private applyPose(p: Pose): void {
    const clampArm = (v: number) => THREE.MathUtils.clamp(v, -3.1, 3.1);
    this.rig.position.y = p.rigY;
    this.torso.rotation.set(p.leanX, p.twistY, p.swayZ);
    this.headGroup.rotation.set(this.headBase.x + p.headX, p.headY, this.headBase.z + p.headZ);
    this.headGroup.position.y = this.headGroup.userData.baseY + p.headBob;
    this.armL.rotation.set(clampArm(p.armLX), p.armLY, p.armLZ);
    this.armR.rotation.set(clampArm(p.armRX), p.armRY, p.armRZ);
    this.elbL.rotation.x = THREE.MathUtils.clamp(p.elbL, -2.6, 0.1);
    this.elbR.rotation.x = THREE.MathUtils.clamp(p.elbR, -2.6, 0.1);
    this.legL.rotation.x = p.hipL;
    this.legR.rotation.x = p.hipR;
    this.kneeL.rotation.x = THREE.MathUtils.clamp(p.kneeL, 0, 2.2);
    this.kneeR.rotation.x = THREE.MathUtils.clamp(p.kneeR, 0, 2.2);
    // Alert sits beside the head and bobs.
    if (this.alert.visible) this.alert.position.y = 1.75 * (this.look?.height ?? 1) + Math.sin(this.t * 6) * 0.05;
  }

  private updateFidgets(): void {
    const t = this.t;
    if (t < this.nextFidget) return;
    this.nextFidget = t + 4 + Math.random() * 5;
    if (this.current || this.gestures.length > 0 || this.fidgets.length === 0) return;
    if (!(this.state === "idle" || this.state === "sit_typing" || this.state === "meeting" || this.state === "coffee")) return;
    const pick = this.fidgets[Math.floor(Math.random() * this.fidgets.length)];
    if (!pick) return;
    // Nobody stretches or crosses their arms mid-keystroke.
    if (this.state === "sit_typing" && (pick === "armsCrossed" || pick === "crackKnuckles")) return;
    this.gesture(pick);
    if (pick === "yawn") this.setExpression("surprised", 1.2);
  }

  private pickFidgets(): GestureName[] {
    const named = FIDGETS_BY_NAME[firstNameOf(this.agent.name)];
    if (named) return named;
    const out: GestureName[] = ["lookAround"];
    const look = this.look;
    if (look) {
      if (look.glasses) out.push("adjustGlasses");
      if (look.tie !== null) out.push("straightenTie");
      if (look.prop === "mug") out.push("sip");
      if (look.prop === "pen") out.push("tapPen");
      if (look.prop === "calculator_watch") out.push("checkWatch");
      if (out.length < 3) out.push("stretch");
    } else {
      if (this.agent.role === "intern") out.push("sip");
      else if (this.agent.role === "ceo") out.push("straightenTie");
      else out.push("stretch");
    }
    return out;
  }

  private updateFace(dt: number): void {
    const t = this.t;
    void dt;
    // Blink: every 3 to 6 s, 120 ms closed.
    if (t >= this.nextBlink) {
      this.blinkUntil = t + 0.12;
      this.nextBlink = t + 3 + Math.random() * 3;
    }
    this.face.setBlink(t < this.blinkUntil);
    // Expression: an explicit one wins while it lasts, then the talking mouth, then rest.
    if (this.expr !== null && t > this.exprUntil) this.expr = null;
    const talking = this.state === "talk" && !this.current && this.bubble.visible;
    const e: Expression = this.expr ?? (talking ? "talking" : "neutral");
    this.face.setExpression(e);
    if (e === "talking") {
      if (t >= this.nextMouth) {
        this.mouthOpen = !this.mouthOpen;
        this.nextMouth = t + 0.08 + Math.random() * 0.12;
        this.face.setMouthOpen(this.mouthOpen);
      }
    } else if (this.mouthOpen) {
      this.mouthOpen = false;
      this.face.setMouthOpen(false);
    }
    this.face.flush();
  }

  private updateSecondary(dt: number): void {
    if (this.pendulums.length === 0) return;
    // Body acceleration in the local frame, plus the sideways push of a turn.
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const ax = this.acc.x * c - this.acc.z * s + this.yawRate * this.speed * 0.6;
    const az = this.acc.x * s + this.acc.z * c;
    const accZ = THREE.MathUtils.clamp(az, -12, 12);
    const accX = THREE.MathUtils.clamp(ax, -12, 12);
    for (const p of this.pendulums) p.update(dt, accZ, accX);
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

  /** The joint hierarchy, independent of the look. */
  private setupRig(): void {
    this.group.add(this.squash);
    this.squash.add(this.rig);
    this.torso.position.y = HIP_Y;
    this.upper.position.y = -HIP_Y;
    this.torso.add(this.upper);
    this.rig.add(this.torso);
    for (const g of [this.armL, this.armR, this.headGroup]) g.rotation.order = "YXZ";
    this.armL.add(this.elbL);
    this.armR.add(this.elbR);
    this.elbL.position.y = -0.22;
    this.elbR.position.y = -0.22;
    this.legL.add(this.kneeL);
    this.legR.add(this.kneeR);
    this.kneeL.position.y = -0.2;
    this.kneeR.position.y = -0.2;
  }

  /** Legs hang from the hips: thigh, knee pivot, shin and a small foot. */
  private buildLegs(mat: THREE.Material, footMat: THREE.Material): void {
    for (const [grp, knee, x] of [
      [this.legL, this.kneeL, -0.11],
      [this.legR, this.kneeR, 0.11],
    ] as const) {
      grp.position.set(x, HIP_Y, 0);
      const thigh = this.mesh(new THREE.BoxGeometry(0.16, 0.21, 0.16), mat);
      thigh.position.y = -0.1;
      grp.add(thigh);
      const shin = this.mesh(new THREE.BoxGeometry(0.15, 0.2, 0.15), mat);
      shin.position.y = -0.1;
      knee.add(shin);
      const foot = this.mesh(new THREE.BoxGeometry(0.16, 0.06, 0.22), footMat);
      foot.position.set(0, -0.18, 0.03);
      knee.add(foot);
      this.rig.add(grp);
    }
  }

  /** Arms hang from the shoulders: upper arm, elbow pivot, forearm and hand. */
  private buildArms(sleeveMat: THREE.Material, skinMat: THREE.Material, shoulderY: number): void {
    for (const [grp, elbow, x] of [
      [this.armL, this.elbL, -0.36],
      [this.armR, this.elbR, 0.36],
    ] as const) {
      grp.position.set(x, shoulderY - 0.04, 0);
      const upperArm = this.mesh(new THREE.BoxGeometry(0.12, 0.23, 0.12), sleeveMat);
      upperArm.position.y = -0.11;
      grp.add(upperArm);
      const forearm = this.mesh(new THREE.BoxGeometry(0.11, 0.21, 0.11), sleeveMat);
      forearm.position.y = -0.1;
      elbow.add(forearm);
      const hand = this.mesh(new THREE.SphereGeometry(0.07, 8, 6), skinMat);
      hand.position.y = -0.22;
      elbow.add(hand);
      this.upper.add(grp);
    }
  }

  /** Adds meshes to a forearm using the old whole-arm coordinates (hand at y = -0.44). */
  private onForearm(side: "L" | "R", ...meshes: THREE.Object3D[]): void {
    const elbow = side === "L" ? this.elbL : this.elbR;
    for (const m of meshes) {
      m.position.y += 0.22;
      elbow.add(m);
    }
  }

  private buildHead(skinMat: THREE.Material, y: number): void {
    this.headGroup.position.set(0, y, 0);
    this.headGroup.userData.baseY = y;
    const head = this.mesh(new THREE.SphereGeometry(0.24, 12, 10), skinMat);
    head.position.y = 0.26;
    head.onBeforeRender = (_r, _s, camera) => CAMERA_POS.setFromMatrixPosition(camera.matrixWorld);
    this.headGroup.add(head);
    // The face: a patch of a slightly larger sphere over the front of the head.
    const w = 1.9;
    const faceGeo = new THREE.SphereGeometry(0.247, 16, 12, Math.PI / 2 - w / 2, w, 1.0, 1.15);
    const faceMat = new THREE.MeshBasicMaterial({ map: this.face.texture, transparent: true, alphaTest: 0.05 });
    this.materials.push(faceMat);
    const face = this.mesh(faceGeo, faceMat);
    face.castShadow = false;
    face.position.y = 0.26;
    this.headGroup.add(face);
    this.upper.add(this.headGroup);
  }

  private buildBody(small: boolean): void {
    const role = this.agent.role;
    const isContractor = this.agent.kind === "contractor";
    const bodyColor = isContractor ? 0xc3bfd0 : ROLE_COLOR[role];
    const bodyMat = this.mat(bodyColor);
    const skinMat = this.mat(SKIN);
    const darkMat = this.mat(PASTEL.ink);

    this.buildLegs(darkMat, darkMat);
    // Body capsule: cylinder plus a rounded top.
    const body = this.mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.62, 10), bodyMat);
    body.position.y = 0.71;
    this.upper.add(body);
    const shoulders = this.mesh(new THREE.SphereGeometry(0.26, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat);
    shoulders.position.y = 1.02;
    this.upper.add(shoulders);
    this.buildArms(bodyMat, skinMat, 1.02);
    this.buildHead(skinMat, 1.02);

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

    this.buildLegs(bottomMat, darkMat);
    // Torso.
    const body = this.mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.62, 10), torsoMat);
    body.position.y = 0.71;
    this.upper.add(body);
    const shoulders = this.mesh(new THREE.SphereGeometry(0.26, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), sleeveMat);
    shoulders.position.y = shoulderY;
    if (slump) shoulders.scale.set(1.05, 0.7, 1.05);
    this.upper.add(shoulders);
    if (kind === "dress") {
      const skirt = this.mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.3, 10), topMat);
      skirt.position.y = 0.42;
      this.upper.add(skirt);
    }
    this.buildArms(sleeveMat, skinMat, shoulderY);
    this.buildHead(skinMat, shoulderY);
    this.headBase.x = look.headTilt?.x ?? 0;
    this.headBase.z = look.headTilt?.z ?? 0;

    this.addClothes(look, topMat, shirtMat, darkMat);
    if (look.tie !== null) this.addTie(look.tie, look.tieStyle, kind === "sweater" || kind === "vest");
    if (look.glasses) this.addGlasses(darkMat);
    this.addHair(look.hair.shape, look.hair.color);
    this.addProp(look.prop, darkMat);
  }

  private addClothes(look: Look, topMat: THREE.Material, shirtMat: THREE.Material, darkMat: THREE.Material): void {
    const rig = this.upper;
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

  /** A thin tapered tie: knot plus a two-segment blade that swings. `short` stops at a sweater or vest neckline. */
  private addTie(color: number, style: Look["tieStyle"], short: boolean): void {
    const mat = this.mat(color);
    const w = style === "skinny" ? 0.6 : 1;
    const knot = this.mesh(new THREE.BoxGeometry(0.08 * w, 0.06, 0.04), mat);
    knot.position.set(0, 0.99, 0.29);
    const bladeH = short ? 0.1 : 0.34;
    const half = bladeH / 2;
    const pivot1 = new THREE.Group();
    pivot1.position.set(0, 0.96, 0.3);
    const top = this.mesh(wedgeGeometry(0.05 * w, 0.075 * w, half, 0.4), mat);
    top.position.y = -half / 2;
    pivot1.add(top);
    const pivot2 = new THREE.Group();
    pivot2.position.y = -half;
    const bottom = this.mesh(wedgeGeometry(0.075 * w, 0.1 * w, half, 0.4), mat);
    bottom.position.y = -half / 2;
    pivot2.add(bottom);
    pivot1.add(pivot2);
    let restZ = 0;
    if (style === "loose") {
      knot.position.set(0.03, 0.95, 0.29);
      pivot1.position.set(0.05, 0.93, 0.3);
      restZ = -0.12;
    }
    this.upper.add(knot, pivot1);
    if (!short) this.pendulums.push(new Pendulum(pivot1, pivot2, 0, restZ, 0.7));
  }

  private addGlasses(darkMat: THREE.Material): void {
    for (const x of [-0.09, 0.09]) {
      const rim = this.mesh(new THREE.TorusGeometry(0.065, 0.012, 6, 12), darkMat);
      rim.position.set(x, 0.3, 0.238);
      this.headGroup.add(rim);
    }
    const bridge = this.mesh(new THREE.BoxGeometry(0.06, 0.015, 0.015), darkMat);
    bridge.position.set(0, 0.31, 0.242);
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
        // Band at the back; the tail hangs from it in two swinging segments.
        const band = this.mesh(new THREE.SphereGeometry(0.06, 8, 6), mat);
        band.position.set(0, 0.3, -0.24);
        head.add(band);
        const pivot1 = new THREE.Group();
        pivot1.position.set(0, 0.3, -0.25);
        pivot1.rotation.x = -0.5;
        const upperTail = this.mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.16, 8), mat);
        upperTail.position.y = -0.08;
        pivot1.add(upperTail);
        const pivot2 = new THREE.Group();
        pivot2.position.y = -0.16;
        const lowerTail = this.mesh(new THREE.CylinderGeometry(0.04, 0.025, 0.16, 8), mat);
        lowerTail.position.y = -0.08;
        pivot2.add(lowerTail);
        pivot1.add(pivot2);
        head.add(pivot1);
        this.pendulums.push(new Pendulum(pivot1, pivot2, -0.5, 0, 0.5));
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

  /** A lanyard: a strap hanging from the neck with a card on a second pivot, both swinging. */
  private addLanyard(x: number, strapMat: THREE.Material, cardW: number, cardH: number): void {
    const pivot1 = new THREE.Group();
    pivot1.position.set(x, 0.99, 0.3);
    const strap = this.mesh(new THREE.BoxGeometry(0.1, 0.2, 0.02), strapMat);
    strap.position.y = -0.1;
    pivot1.add(strap);
    const pivot2 = new THREE.Group();
    pivot2.position.y = -0.2;
    const card = this.mesh(new THREE.BoxGeometry(cardW, cardH, 0.02), this.mat(0xffffff));
    card.position.set(0, -cardH / 2 - 0.01, 0.005);
    pivot2.add(card);
    pivot1.add(pivot2);
    this.upper.add(pivot1);
    this.pendulums.push(new Pendulum(pivot1, pivot2, 0, 0, 0.6));
  }

  private addProp(prop: PropKind, darkMat: THREE.Material): void {
    switch (prop) {
      case "calculator_watch": {
        const strap = this.mesh(new THREE.BoxGeometry(0.14, 0.05, 0.14), darkMat);
        strap.position.set(0, -0.37, 0);
        const face = this.mesh(new THREE.BoxGeometry(0.06, 0.06, 0.02), this.mat(0xb5e48c));
        face.position.set(0, -0.37, 0.075);
        this.onForearm("L", strap, face);
        break;
      }
      case "cat_pin": {
        const pin = this.mesh(new THREE.SphereGeometry(0.03, 8, 6), this.mat(0xf7d774));
        pin.position.set(0.12, 0.9, 0.3);
        this.upper.add(pin);
        break;
      }
      case "crossword": {
        const paper = this.mesh(new THREE.BoxGeometry(0.2, 0.26, 0.012), this.mat(0xffffff));
        paper.position.set(0, -0.42, 0.1);
        paper.rotation.x = -0.4;
        const grid = this.mesh(new THREE.BoxGeometry(0.12, 0.12, 0.006), this.mat(0xd9d9e3));
        grid.position.set(0, -0.4, 0.11);
        grid.rotation.x = -0.4;
        this.onForearm("L", paper, grid);
        break;
      }
      case "mug": {
        const mug = this.mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.14, 8), this.mat(0xffffff));
        mug.position.set(0, -0.46, 0.08);
        this.onForearm("L", mug);
        break;
      }
      case "clipboard": {
        const board = this.mesh(new THREE.BoxGeometry(0.3, 0.38, 0.03), this.mat(0x8d5524));
        board.position.set(0.02, -0.4, 0.12);
        this.onForearm("L", board);
        break;
      }
      case "badge":
        this.addLanyard(-0.08, darkMat, 0.14, 0.1);
        break;
      case "pen": {
        const pen = this.mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6), darkMat);
        pen.position.set(0.16, 0.86, 0.3);
        pen.rotation.z = 0.1;
        this.upper.add(pen);
        break;
      }
      case null:
        break;
    }
  }

  private addAccessory(role: RoleId, bodyMat: THREE.Material, darkMat: THREE.Material): void {
    const head = this.headGroup;
    switch (role) {
      case "ceo":
        this.addTie(0xd62828, undefined, false);
        break;
      case "pm": {
        const board = this.mesh(new THREE.BoxGeometry(0.3, 0.38, 0.03), this.mat(0x8d5524));
        board.position.set(0.02, -0.4, 0.12);
        const paper = this.mesh(new THREE.BoxGeometry(0.26, 0.32, 0.01), this.mat(0xffffff));
        paper.position.set(0.02, -0.4, 0.135);
        this.onForearm("L", board, paper);
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
        this.onForearm("R", ring, handle);
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
        this.onForearm("R", horn);
        break;
      }
      case "legal": {
        const briefcase = this.mesh(new THREE.BoxGeometry(0.32, 0.26, 0.1), this.mat(0x4a2c2a));
        briefcase.position.set(0, -0.58, 0.02);
        this.onForearm("L", briefcase);
        break;
      }
      case "hr":
        this.addLanyard(0, this.mat(0x1d4ed8), 0.16, 0.12);
        break;
      case "it": {
        const shaft = this.mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.2, 6), this.mat(0xbfc0c0));
        shaft.position.set(0, -0.58, 0.04);
        const handle = this.mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 6), this.mat(0xffd60a));
        handle.position.set(0, -0.44, 0.04);
        this.onForearm("R", shaft, handle);
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
        this.onForearm("L", calc, screen);
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

  /** The coffee cup hangs from the right hand on its own pivot so it swings a little. */
  private makeCup(): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(0, -0.2, 0.06);
    const cup = this.mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.14, 8), this.mat(0xffffff));
    cup.position.set(0, -0.04, 0.02);
    pivot.add(cup);
    this.elbR.add(pivot);
    this.pendulums.push(new Pendulum(pivot, null, 0, 0, 0.35));
    return pivot;
  }

  private makeFolder(): THREE.Mesh {
    const folder = this.mesh(new THREE.BoxGeometry(0.34, 0.26, 0.04), this.mat(0xffd166));
    folder.position.set(0, -0.44, 0.12);
    this.onForearm("R", folder);
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
    const mat = new THREE.SpriteMaterial({ map: canvasTexture(canvas), transparent: true, depthWrite: false, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.layers.set(OVERLAY_LAYER);
    const ww = 1.9;
    sprite.scale.set(ww, (ww * h) / w, 1);
    sprite.position.set(0, 1.92, 0);
    return sprite;
  }

  private makeBubbleSprite(): THREE.Sprite {
    const { canvas } = makeCanvas(512, 176);
    const mat = new THREE.SpriteMaterial({ map: canvasTexture(canvas), transparent: true, depthWrite: false, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.layers.set(OVERLAY_LAYER);
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
    const mat = new THREE.SpriteMaterial({ map: canvasTexture(canvas), transparent: true, depthWrite: false, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.layers.set(OVERLAY_LAYER);
    sprite.scale.set(0.45, 0.45, 1);
    sprite.position.set(0.5, 1.75, 0);
    return sprite;
  }
}
