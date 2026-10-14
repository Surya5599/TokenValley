import * as THREE from "three";
import type { CameraMode } from "../state/store";
import type { CameraRig } from "../world/camera";
import type { Character, Expression } from "../world/character";
import type { Director } from "../world/director";
import { spotTile, tileToWorld, type Tile } from "../world/office";
import type { AnimState } from "@agentsitcom/shared";

/**
 * The mockumentary camera: handheld sway, snap zooms, whip pans, slow push-ins
 * and the talking-head interview setup. Wraps the rig's primitives so the
 * post-processing look follows the shot (close shots use the follow look,
 * which keeps the tilt-shift almost off) instead of fighting it.
 */

type Target = THREE.Vector3 | (() => THREE.Vector3 | null);

/** Where interviews happen: the lobby couch, camera low, wall behind. */
const COUCH = spotTile("couch") ?? { x: 4, z: 17 };
const COUCH_SEAT: Tile = { x: COUCH.x, z: COUCH.z + 1 };
const COUCH_Y = 0.52;
const HEAD_RADIUS = 4.3;
const HEAD_ELEVATION = 0.14;
const HEAD_AZIMUTH = Math.PI + 0.32;
/** Sprites below this height on a character are the name tag and alert; the speech bubble sits higher. */
const TAG_MAX_Y = 2.4;

interface Interview {
  ch: Character;
  tile: Tile;
  state: AnimState;
  face: Tile | null;
  /** Name tag hidden for the interview (the lower third names them). */
  hidden: THREE.Object3D[];
}

export class Mocku {
  private time = 0;
  private readonly timers: { at: number; fn: () => void }[] = [];
  /** The look the story has asked for; snap zooms borrow "follow" and hand this back. */
  private baseLook: CameraMode = "office";
  private interview: Interview | null = null;

  constructor(
    private readonly rig: CameraRig,
    private readonly director: Director,
    private readonly setLook: (mode: CameraMode) => void,
  ) {
    rig.handheld = true;
  }

  /** Story time, so skipping beats also skips these. */
  update(dt: number): void {
    this.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      if (t && t.at <= this.time) {
        this.timers.splice(i, 1);
        t.fn();
      }
    }
  }

  later(seconds: number, fn: () => void): void {
    this.timers.push({ at: this.time + seconds, fn });
  }

  look(mode: CameraMode): void {
    this.baseLook = mode;
    this.setLook(mode);
  }

  /** Fast push, hold, ease back. The tilt-shift drops to the follow look for the duration. */
  snapZoom(target: Target, factor = 1.35, hold = 1.0, elevation?: number): void {
    const restore = this.baseLook;
    this.setLook("follow");
    this.rig.snapZoom(target, factor, hold, elevation);
    this.later(0.12 + hold + 0.4, () => {
      if (this.baseLook === restore) this.setLook(restore);
    });
  }

  pushIn(target: Target, seconds: number): void {
    this.rig.pushIn(target, seconds);
  }

  whipPan(target: Target, radius?: number, elevation?: number): void {
    this.rig.whipPan(target, radius, elevation);
  }

  /**
   * Cuts to a fixed interview camera on the lobby couch. The character
   * teleports there, sits, says the line and looks down the lens; after
   * `seconds` they are put back where they were. The caller picks the next shot.
   */
  talkingHead(ch: Character, line: string, seconds: number, expression?: Expression, onLine?: (line: string) => void): void {
    if (this.interview) this.endInterview();
    const office = this.director.office;
    const faceTile: Tile = { x: COUCH_SEAT.x, z: COUCH_SEAT.z - 3 };
    const home = ch.agent.home;
    const hidden = ch.group.children.filter((o) => (o as THREE.Sprite).isSprite && o.visible && o.position.y < TAG_MAX_Y);
    for (const o of hidden) o.visible = false;
    this.interview = { ch, tile: { ...ch.tile }, state: ch.state === "walk" ? "idle" : ch.state, face: office?.faceTiles.get(home) ?? null, hidden };
    ch.teleport(COUCH_SEAT, faceTile);
    ch.setState("meeting", faceTile);
    ch.group.position.y = COUCH_Y;
    ch.lookAt("camera");
    if (expression) ch.setExpression(expression, seconds);
    const seat = tileToWorld(COUCH_SEAT, COUCH_Y + 1.05);
    this.look("follow");
    this.rig.cinematicTo(seat, HEAD_RADIUS, HEAD_ELEVATION, HEAD_AZIMUTH, 0);
    this.later(0.6, () => {
      ch.say(line, Math.max(1, seconds - 1));
      onLine?.(line);
    });
    this.later(seconds, () => this.endInterview());
  }

  private endInterview(): void {
    const iv = this.interview;
    if (!iv) return;
    this.interview = null;
    const { ch } = iv;
    if (ch.removed) return;
    ch.lookAt(null);
    for (const o of iv.hidden) o.visible = true;
    ch.group.position.y = 0;
    ch.teleport(iv.tile, iv.face);
    ch.setState(iv.state, iv.face);
  }
}
