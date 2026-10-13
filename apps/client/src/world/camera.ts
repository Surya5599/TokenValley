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

/** A scripted camera move: tweens the orbit framing over a fixed time, then holds (and keeps tracking a live target). */
interface Cinematic {
  from: Framing;
  radius: number;
  elevation: number;
  azimuth: number;
  target: THREE.Vector3 | (() => THREE.Vector3 | null);
  elapsed: number;
  duration: number;
  ease: CineEase;
}

/** `whip` overshoots a little and settles, for "who said that" pans. */
export type CineEase = "smooth" | "linear" | "whip";

/** Handheld micro-jitter: two slow noise channels (pan, tilt), each a sum of incommensurate sines. */
const JITTER_PAN = [
  [0.37, 1.0],
  [0.91, 0.55],
  [1.73, 0.3],
] as const;
const JITTER_TILT = [
  [0.29, 1.0],
  [0.83, 0.5],
  [1.41, 0.35],
] as const;
const JITTER_AMP = 0.0045; // radians at full strength
/** Jitter fades in below this orbit radius (overview shots stay rock steady). */
const JITTER_FAR = 24;
const JITTER_NEAR = 12;

function noise(channels: readonly (readonly [number, number])[], t: number, phase: number): number {
  let v = 0;
  for (const [f, a] of channels) v += Math.sin(t * f * Math.PI * 2 + phase * f) * a;
  return v / channels.length;
}

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
  private cine: Cinematic | null = null;
  /** Mockumentary handheld jitter (story mode only). Applied to close framings. */
  handheld = false;
  private jitterT = 0;
  private readonly jitterPhase = Math.random() * 100;
  /** Camera-owned timers in wall seconds (snap zoom release and the like). */
  private readonly timers: { at: number; fn: () => void }[] = [];
  private wall = 0;
  /** Set while a snap zoom holds the framing, so the release can restore what was there. */
  private snapRestore: { cine: Cinematic | null; framing: Framing } | null = null;

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
    this.cine = null;
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

  /**
   * Scripted move for story mode: tweens from the current framing to the
   * given one over `seconds` (0 snaps), then holds there. A function target
   * keeps being tracked after the tween, like follow mode. Any setMode cancels it.
   */
  cinematicTo(target: THREE.Vector3 | (() => THREE.Vector3 | null), radius: number, elevation: number, azimuth: number, seconds: number, ease: CineEase = "smooth"): void {
    if (this.mode === "firstperson") return;
    // A new move cancels a snap zoom in flight; its release would otherwise yank the camera back.
    this.snapRestore = null;
    this.timers.length = 0;
    const from: Framing = { target: this.current.target.clone(), radius: this.current.radius, elevation: this.current.elevation, azimuth: this.current.azimuth };
    this.cine = { from, radius, elevation, azimuth, target, elapsed: 0, duration: Math.max(0, seconds), ease };
    if (seconds <= 0) this.updateCinematic(0);
  }

  /** Whether a scripted move is driving the camera. */
  get isCinematic(): boolean {
    return this.cine !== null;
  }

  /** Hands the camera back to the current mode's framing. */
  endCinematic(): void {
    this.cine = null;
    this.snapRestore = null;
    this.timers.length = 0;
  }

  /** The orbit framing right now (radius, elevation, azimuth); the target is a copy. */
  get framing(): Framing {
    return { target: this.current.target.clone(), radius: this.current.radius, elevation: this.current.elevation, azimuth: this.current.azimuth };
  }

  // ---- mockumentary moves -------------------------------------------------------

  /**
   * Snap zoom: a 120 ms push toward `target` (radius / factor), a hold, then a
   * 400 ms ease back to whatever framing was there before, tracking included.
   */
  snapZoom(target: THREE.Vector3 | (() => THREE.Vector3 | null), factor = 1.35, hold = 1.0, elevation?: number): void {
    if (this.mode === "firstperson") return;
    const prev = this.snapRestore ?? { cine: this.cine, framing: this.framing };
    const { radius, azimuth } = this.current;
    this.cinematicTo(target, radius / factor, elevation ?? this.current.elevation, azimuth, 0.12, "linear");
    this.snapRestore = prev;
    this.timers.push({
      at: this.wall + 0.12 + hold,
      fn: () => {
        const r = this.snapRestore;
        if (!r) return;
        // Ease back to the old framing, following the old live target if it had one.
        const back = r.cine && typeof r.cine.target === "function" ? r.cine.target : r.framing.target;
        this.cinematicTo(back, r.framing.radius, r.framing.elevation, r.framing.azimuth, 0.4, "smooth");
        this.snapRestore = null;
        if (r.cine) {
          // Hand the tracking cinematic back once the ease lands.
          const c = r.cine;
          this.timers.push({
            at: this.wall + 0.4,
            fn: () => {
              c.elapsed = c.duration;
              this.cine = c;
            },
          });
        } else {
          this.timers.push({ at: this.wall + 0.4, fn: () => (this.cine = null) });
        }
      },
    });
  }

  /** Slow dolly toward `target` over `seconds`, keeping elevation and azimuth. */
  pushIn(target: THREE.Vector3 | (() => THREE.Vector3 | null), seconds: number, factor = 1.6): void {
    const { radius, elevation, azimuth } = this.current;
    this.cinematicTo(target, radius / factor, elevation, azimuth, seconds, "linear");
  }

  /** Whip pan to `target` ("who said that"): a quarter second with a little overshoot. */
  whipPan(target: THREE.Vector3 | (() => THREE.Vector3 | null), radius?: number, elevation?: number): void {
    const { azimuth } = this.current;
    this.cinematicTo(target, radius ?? this.current.radius, elevation ?? this.current.elevation, azimuth, 0.28, "whip");
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
    this.wall += dt;
    this.jitterT += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      if (t && t.at <= this.wall) {
        this.timers.splice(i, 1);
        t.fn();
      }
    }
    if (this.mode === "firstperson") {
      this.walk(dt);
      this.applyFirstPerson();
      return;
    }
    if (this.cine) {
      this.updateCinematic(dt);
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

  private updateCinematic(dt: number): void {
    const c = this.cine;
    if (!c) return;
    c.elapsed += dt;
    const k = c.duration <= 0 ? 1 : Math.min(1, c.elapsed / c.duration);
    const e = c.ease === "linear" ? k : c.ease === "whip" ? 1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2 : k * k * (3 - 2 * k);
    const dest = typeof c.target === "function" ? (c.target() ?? c.from.target) : c.target;
    if (typeof c.target === "function") this.tmp.copy(dest).add(new THREE.Vector3(0, 0.8, 0));
    else this.tmp.copy(dest);
    this.current.target.lerpVectors(c.from.target, this.tmp, e);
    this.current.radius = c.from.radius + (c.radius - c.from.radius) * e;
    this.current.elevation = c.from.elevation + (c.elevation - c.from.elevation) * e;
    let da = c.azimuth - c.from.azimuth;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    this.current.azimuth = c.from.azimuth + da * e;
    // Keep the mode's desired framing in step so ending the cinematic does not snap back.
    this.desired.radius = this.current.radius;
    this.desired.elevation = this.current.elevation;
    this.desired.azimuth = this.current.azimuth;
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
    if (this.handheld) {
      // Operator sway: only on close framings, and fading in as the camera comes down.
      const strength = THREE.MathUtils.clamp((JITTER_FAR - radius) / (JITTER_FAR - JITTER_NEAR), 0, 1);
      if (strength > 0) {
        const amp = JITTER_AMP * strength;
        this.camera.rotation.y += noise(JITTER_PAN, this.jitterT, this.jitterPhase) * amp;
        this.camera.rotation.x += noise(JITTER_TILT, this.jitterT, this.jitterPhase + 7) * amp * 0.7;
      }
    }
  }
}
