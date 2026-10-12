import * as THREE from "three";
import type { CameraMode } from "../state/store";

export type { CameraMode } from "../state/store";

interface Framing {
  target: THREE.Vector3;
  radius: number;
  /** Elevation above the ground plane in radians (0 = horizon, PI/2 = top-down). */
  elevation: number;
  /** Azimuth around the Y axis. */
  azimuth: number;
}

type OrbitMode = Exclude<CameraMode, "firstperson">;

const PRESETS: Record<OrbitMode, Omit<Framing, "target">> = {
  valley: { radius: 125, elevation: 0.78, azimuth: 0.6 },
  office: { radius: 40, elevation: 0.9, azimuth: 0.62 },
  follow: { radius: 9, elevation: 0.62, azimuth: 0.62 },
  meeting: { radius: 15, elevation: 0.85, azimuth: 0.62 },
};

const EYE_HEIGHT = 1.6;
const WALK_SPEED = 4.2; // world units per second
const BODY_RADIUS = 0.3;

/** Collision and probing hooks for first-person walking. */
export interface FirstPersonWorld {
  /** True when a world-space (x, z) position is blocked or outside the floor. */
  blocked: (x: number, z: number) => boolean;
  /** Called each frame with the walker's position (e.g. to detect a building door). */
  probe?: (x: number, z: number) => void;
}

/**
 * Hand-rolled camera: four framed orbit modes with smooth transitions, plus
 * a first-person mode with pointer-lock mouse look and WASD walking that
 * collides with the obstacle grid.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = "valley";
  /** Provides the target for follow mode; null falls back to office framing. */
  followTarget: (() => THREE.Vector3 | null) | null = null;
  meetingCenter = new THREE.Vector3();
  /** Fired when pointer lock is lost while in first-person (Esc). */
  onPointerUnlock: (() => void) | null = null;

  private readonly current: Framing = { target: new THREE.Vector3(), ...PRESETS.valley };
  private readonly desired: Framing = { target: new THREE.Vector3(), ...PRESETS.valley };
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private dragDistance = 0;
  private readonly tmp = new THREE.Vector3();
  private el: HTMLElement | null = null;

  // First person state.
  private readonly fpPos = new THREE.Vector3();
  private fpYaw = 0;
  private fpPitch = 0;
  private readonly keys = new Set<string>();
  private fpWorld: FirstPersonWorld | null = null;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 500);
    this.camera.rotation.order = "YXZ";
    this.setMode("valley", true);
  }

  setMode(mode: CameraMode, snap = false): void {
    const wasFp = this.mode === "firstperson";
    this.mode = mode;
    if (mode === "firstperson") return;
    if (wasFp && document.pointerLockElement === this.el) document.exitPointerLock();
    const p = PRESETS[mode];
    this.desired.radius = p.radius;
    this.desired.elevation = p.elevation;
    this.desired.azimuth = p.azimuth;
    this.updateTarget();
    if (snap || wasFp) {
      // Leaving first person: jump the orbit so the tween does not sweep across the map.
      this.current.target.copy(this.desired.target);
      this.current.radius = this.desired.radius;
      this.current.elevation = this.desired.elevation;
      this.current.azimuth = this.desired.azimuth;
      this.apply();
    }
  }

  /** Enters first-person at a world position with a yaw (0 looks down -z). */
  enterFirstPerson(start: THREE.Vector3, yaw: number, world: FirstPersonWorld): void {
    this.fpPos.set(start.x, 0, start.z);
    this.fpYaw = yaw;
    this.fpPitch = 0;
    this.fpWorld = world;
    // Keep held keys when hopping between worlds (valley door -> office).
    if (this.mode !== "firstperson") this.keys.clear();
    this.mode = "firstperson";
    this.applyFirstPerson();
  }

  requestPointerLock(): void {
    if (this.mode === "firstperson" && this.el && document.pointerLockElement !== this.el) {
      this.el.requestPointerLock();
    }
  }

  firstPersonPosition(): THREE.Vector3 {
    return this.fpPos.clone();
  }

  /** Was the last pointer interaction a click rather than a drag? */
  consumeClick(): boolean {
    const wasClick = this.dragDistance < 6;
    this.dragDistance = 0;
    return wasClick;
  }

  attach(el: HTMLElement): void {
    this.el = el;
    el.addEventListener("pointerdown", (e) => {
      if (this.mode === "firstperson") {
        this.requestPointerLock();
        return;
      }
      if (e.button !== 0 && e.button !== 2) return;
      this.dragging = true;
      this.dragDistance = 0;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (this.mode === "firstperson") {
        if (document.pointerLockElement === el) {
          this.fpYaw -= e.movementX * 0.0025;
          this.fpPitch = THREE.MathUtils.clamp(this.fpPitch - e.movementY * 0.0025, -1.3, 1.3);
        }
        return;
      }
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.dragDistance += Math.abs(dx) + Math.abs(dy);
      this.desired.azimuth -= dx * 0.006;
      this.desired.elevation = THREE.MathUtils.clamp(this.desired.elevation + dy * 0.005, 0.2, 1.45);
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        if (this.mode === "firstperson") return;
        const f = Math.exp(e.deltaY * 0.0012);
        this.desired.radius = THREE.MathUtils.clamp(this.desired.radius * f, 4, 180);
      },
      { passive: false },
    );
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("pointerlockchange", () => {
      if (this.mode === "firstperson" && document.pointerLockElement !== el) {
        this.keys.clear();
        this.onPointerUnlock?.();
      }
    });
    window.addEventListener("keydown", (e) => {
      if (this.mode !== "firstperson") return;
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(k)) {
        this.keys.add(k);
        e.preventDefault();
      }
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    if (this.mode === "firstperson") {
      this.walk(dt);
      this.applyFirstPerson();
      return;
    }
    this.updateTarget();
    // Exponential smoothing gives a soft tween regardless of frame rate.
    const k = 1 - Math.exp(-dt * 4.5);
    this.current.target.lerp(this.desired.target, k);
    this.current.radius += (this.desired.radius - this.current.radius) * k;
    this.current.elevation += (this.desired.elevation - this.current.elevation) * k;
    let da = this.desired.azimuth - this.current.azimuth;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    this.current.azimuth += da * k;
    this.apply();
  }

  // ---- first person -----------------------------------------------------------

  private walk(dt: number): void {
    const keys = this.keys;
    let fwd = 0;
    let strafe = 0;
    if (keys.has("w") || keys.has("arrowup")) fwd += 1;
    if (keys.has("s") || keys.has("arrowdown")) fwd -= 1;
    if (keys.has("d") || keys.has("arrowright")) strafe += 1;
    if (keys.has("a") || keys.has("arrowleft")) strafe -= 1;
    if (fwd === 0 && strafe === 0) return;
    const len = Math.hypot(fwd, strafe);
    const speed = WALK_SPEED * (keys.has("shift") ? 1.8 : 1) * dt;
    // Forward is -z rotated by yaw; right is +x rotated by yaw.
    const fx = -Math.sin(this.fpYaw);
    const fz = -Math.cos(this.fpYaw);
    const rx = Math.cos(this.fpYaw);
    const rz = -Math.sin(this.fpYaw);
    const dx = ((fx * fwd + rx * strafe) / len) * speed;
    const dz = ((fz * fwd + rz * strafe) / len) * speed;
    // Move on each axis separately so the walker slides along walls.
    if (!this.collides(this.fpPos.x + dx, this.fpPos.z)) this.fpPos.x += dx;
    if (!this.collides(this.fpPos.x, this.fpPos.z + dz)) this.fpPos.z += dz;
    this.fpWorld?.probe?.(this.fpPos.x, this.fpPos.z);
  }

  private collides(x: number, z: number): boolean {
    const w = this.fpWorld;
    if (!w) return false;
    const r = BODY_RADIUS;
    return w.blocked(x - r, z - r) || w.blocked(x + r, z - r) || w.blocked(x - r, z + r) || w.blocked(x + r, z + r);
  }

  private applyFirstPerson(): void {
    this.camera.position.set(this.fpPos.x, EYE_HEIGHT, this.fpPos.z);
    this.camera.rotation.set(this.fpPitch, this.fpYaw, 0, "YXZ");
  }

  // ---- orbit ------------------------------------------------------------------------

  private updateTarget(): void {
    switch (this.mode) {
      case "valley":
        this.desired.target.set(0, 0, 0);
        break;
      case "office":
        this.desired.target.set(0, 0, 1);
        break;
      case "meeting":
        this.desired.target.copy(this.meetingCenter);
        break;
      case "follow": {
        const p = this.followTarget?.() ?? null;
        if (p) this.desired.target.copy(p).add(this.tmp.set(0, 0.8, 0));
        else this.desired.target.set(0, 0, 1);
        break;
      }
      case "firstperson":
        break;
    }
  }

  private apply(): void {
    const { target, radius, elevation, azimuth } = this.current;
    const y = Math.sin(elevation) * radius;
    const r = Math.cos(elevation) * radius;
    this.camera.position.set(target.x + Math.sin(azimuth) * r, target.y + y, target.z + Math.cos(azimuth) * r);
    this.camera.lookAt(target);
  }
}
