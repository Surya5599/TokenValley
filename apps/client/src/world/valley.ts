import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Company } from "@tokenvalley/shared";
import type { CompanyStatus, Store } from "../state/store";
import { PASTEL, STOREY, facadeBoxGeometry, hex, pastel, place, tint, toonMat, windowTexture } from "./style";
import { disposeSprite, textSprite } from "./textures";

const PLOT_COLS = 4;
const PLOT_SPACING = 18;

// City grid: 8 x 6 cells of 18 units with roads between them. Company plots
// occupy the middle four columns of the two centre rows.
const CELL = 18;
const GRID_COLS = 8;
const GRID_ROWS = 6;
const ROAD_W = 3.6;
const SLAB = CELL - ROAD_W;
const SLAB_H = 0.15;
const GROUND_W = 180;
const GROUND_D = 140;
const PLOT_COL0 = 2;
const PLOT_ROW0 = 2;

// Per cell: P park, H houses, O offices, L landmark, . reserved company plot.
const LAYOUT = ["PHOHHOHP", "HOLHHLOH", "OH....HO", "HO....OH", "HLOHHOLH", "PHOHHOHP"];

const STATUS_COLOR: Record<CompanyStatus, number> = {
  working: 0x000000, // replaced by the palette accent
  blocked: 0xff9a4d,
  waiting_on_founder: 0xffd84a,
  done: 0x5cd27d,
  out_of_budget: 0xf06a70,
  paused: 0xb8bfd0,
};

interface Building {
  group: THREE.Group;
  ring: THREE.Mesh;
  ringMat: THREE.MeshBasicMaterial;
  sign: THREE.Sprite;
  status: CompanyStatus;
  disposables: (THREE.BufferGeometry | THREE.Material)[];
  name: string;
}

interface TreeSpot {
  x: number;
  z: number;
  s: number;
  ry: number;
  tone: number;
}

interface Box2 {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Plot index -> world position of the plot centre. */
export function plotPosition(plot: number): THREE.Vector3 {
  const col = plot % PLOT_COLS;
  const row = Math.floor(plot / PLOT_COLS);
  const x = (col - (PLOT_COLS - 1) / 2) * PLOT_SPACING;
  const z = (row - 0.5) * PLOT_SPACING;
  return new THREE.Vector3(x, 0, z);
}

function cellCenter(col: number, row: number): { x: number; z: number } {
  return { x: (col - (GRID_COLS - 1) / 2) * CELL, z: (row - (GRID_ROWS - 1) / 2) * CELL };
}

/**
 * The valley map: a pastel toy city. Pink ground with a road grid, filler
 * blocks of houses, white office towers, parks and landmark props, and one
 * little HQ per company with a sign and a status ring.
 */
export class Valley {
  readonly group = new THREE.Group();
  private readonly buildings = new Map<string, Building>();
  private readonly sharedDisposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private readonly pickables: THREE.Object3D[] = [];
  /** Footprints of filler buildings and props for first-person collision. */
  private readonly solids: Box2[] = [];
  private time = 0;
  private seed = 11;

  // Geometry collected during construction and merged into a few meshes.
  private readonly flat: THREE.BufferGeometry[] = [];
  private readonly facades: THREE.BufferGeometry[] = [];
  private readonly coneTrees: TreeSpot[] = [];
  private readonly roundTrees: TreeSpot[] = [];

  constructor() {
    this.buildGround();
    this.buildCity();
    this.buildMargins();
    this.commitMerged();
  }

  /** Adds, removes, and recolours buildings to match the store. */
  sync(store: Store): void {
    const seen = new Set<string>();
    for (const c of store.companies.values()) {
      seen.add(c.id);
      let b = this.buildings.get(c.id);
      if (!b) {
        b = this.makeBuilding(c);
        this.buildings.set(c.id, b);
      } else if (b.name !== c.name) {
        this.removeBuilding(c.id);
        b = this.makeBuilding(c);
        this.buildings.set(c.id, b);
      }
      const status = store.statusOf(c.id);
      if (status !== b.status) {
        b.status = status;
        b.ringMat.color.setHex(status === "working" ? pastel(c.palette.accent, 0.15).getHex() : STATUS_COLOR[status]);
      }
      b.group.visible = true;
      // Highlight the focused company's plot with a slightly bigger ring.
      const focused = store.focusedCompanyId === c.id;
      b.ring.scale.setScalar(focused ? 1.1 : 1);
    }
    for (const id of [...this.buildings.keys()]) if (!seen.has(id)) this.removeBuilding(id);
  }

  update(dt: number): void {
    this.time += dt;
    for (const b of this.buildings.values()) {
      if (b.status === "waiting_on_founder") {
        b.ringMat.opacity = 0.45 + 0.45 * (0.5 + 0.5 * Math.sin(this.time * 5));
      } else {
        b.ringMat.opacity = 0.9;
      }
    }
  }

  /** Returns the company id under the ray, if any. */
  pick(raycaster: THREE.Raycaster): string | null {
    const hits = raycaster.intersectObjects(this.pickables, true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        const id = o.userData.companyId as string | undefined;
        if (id) return id;
        o = o.parent;
      }
    }
    return null;
  }

  buildingPosition(companyId: string): THREE.Vector3 | null {
    const b = this.buildings.get(companyId);
    return b ? b.group.position.clone() : null;
  }

  /** True when a world-space point is inside a filler building or prop. */
  blockedAt(x: number, z: number): boolean {
    for (const s of this.solids) if (x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1) return true;
    return false;
  }

  dispose(): void {
    for (const id of [...this.buildings.keys()]) this.removeBuilding(id);
    for (const d of this.sharedDisposables) d.dispose();
    this.group.removeFromParent();
  }

  // ---- ground and roads --------------------------------------------------------

  private rand(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  private pick1<T>(arr: readonly T[]): T {
    const v = arr[Math.floor(this.rand() * arr.length)];
    if (v === undefined) throw new Error("empty");
    return v;
  }

  /** The ground is one textured plane: pink base, lavender roads with cream edges and crosswalks. */
  private buildGround(): void {
    const S = 12; // px per world unit
    const canvas = document.createElement("canvas");
    canvas.width = GROUND_W * S;
    canvas.height = GROUND_D * S;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas context unavailable");
    const px = (x: number) => (x + GROUND_W / 2) * S;
    const pz = (z: number) => (z + GROUND_D / 2) * S;
    const rect = (x: number, z: number, w: number, d: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(px(x), pz(z), w * S, d * S);
    };
    rect(-GROUND_W / 2, -GROUND_D / 2, GROUND_W, GROUND_D, hex(PASTEL.ground));

    const xs: number[] = [];
    const zs: number[] = [];
    for (let c = 0; c <= GRID_COLS; c++) xs.push((c - GRID_COLS / 2) * CELL);
    for (let r = 0; r <= GRID_ROWS; r++) zs.push((r - GRID_ROWS / 2) * CELL);
    const x0 = xs[0] ?? 0;
    const x1 = xs[xs.length - 1] ?? 0;
    const z0 = zs[0] ?? 0;
    const z1 = zs[zs.length - 1] ?? 0;
    const half = ROAD_W / 2;
    const edge = 0.3;
    const road = hex(PASTEL.road);
    const line = hex(PASTEL.roadEdge);
    for (const x of xs) {
      rect(x - half, z0 - half, ROAD_W, z1 - z0 + ROAD_W, road);
      rect(x - half, z0 - half, edge, z1 - z0 + ROAD_W, line);
      rect(x + half - edge, z0 - half, edge, z1 - z0 + ROAD_W, line);
    }
    for (const z of zs) {
      rect(x0 - half, z - half, x1 - x0 + ROAD_W, ROAD_W, road);
      rect(x0 - half, z - half, x1 - x0 + ROAD_W, edge, line);
      rect(x0 - half, z + half - edge, x1 - x0 + ROAD_W, edge, line);
    }
    // Intersections: clear the edge lines, then paint zebra crossings on each arm.
    for (const x of xs) {
      for (const z of zs) {
        rect(x - half, z - half, ROAD_W, ROAD_W, road);
        const stripes = 5;
        const sw = 0.32;
        const gap = (ROAD_W - 0.6 - stripes * sw) / (stripes - 1);
        for (let i = 0; i < stripes; i++) {
          const o = -half + 0.3 + i * (sw + gap);
          if (z > z0) rect(x + o, z - half - 1.5, sw, 1.1, line); // north arm
          if (z < z1) rect(x + o, z + half + 0.4, sw, 1.1, line); // south arm
          if (x > x0) rect(x - half - 1.5, z + o, 1.1, sw, line); // west arm
          if (x < x1) rect(x + half + 0.4, z + o, 1.1, sw, line); // east arm
        }
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const geo = new THREE.PlaneGeometry(GROUND_W, GROUND_D);
    const mat = toonMat(0xffffff, { map: tex });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.group.add(ground);
    this.sharedDisposables.push(geo, mat, tex);
  }

  // ---- city blocks ------------------------------------------------------------------

  private buildCity(): void {
    let landmark = 0;
    for (let row = 0; row < GRID_ROWS; row++) {
      const line = LAYOUT[row] ?? "";
      for (let col = 0; col < GRID_COLS; col++) {
        const kind = line[col] ?? "P";
        const { x, z } = cellCenter(col, row);
        switch (kind) {
          case ".":
            // Reserved company plot: a lawn with trees in the corners the HQ and its sign leave free.
            this.slab(x, z, PASTEL.mint);
            this.tree(x - 6.3, z - 6.3, 0.9);
            this.tree(x + 6.3, z - 6.3, 0.8);
            this.tree(x - 6.3, z + 6.3, 0.7, true);
            this.tree(x - 6.3, z, 0.6);
            this.tree(x + 6.3, z - 2, 0.6, true);
            break;
          case "H":
            this.slab(x, z, PASTEL.mint);
            this.housesBlock(x, z);
            break;
          case "O":
            this.slab(x, z, PASTEL.cream);
            this.officesBlock(x, z);
            break;
          case "P":
            this.slab(x, z, PASTEL.mint);
            this.parkBlock(x, z);
            break;
          case "L":
            this.slab(x, z, landmark % 2 === 0 ? PASTEL.cream : PASTEL.mint);
            this.landmarkBlock(x, z, landmark++);
            break;
        }
      }
    }
  }

  private slab(x: number, z: number, color: number): void {
    this.flat.push(tint(place(new THREE.BoxGeometry(SLAB, SLAB_H, SLAB), x, SLAB_H / 2, z), color));
  }

  private tree(x: number, z: number, s = 1, round = false): void {
    const t = { x, z, s, ry: this.rand() * Math.PI * 2, tone: 0.9 + this.rand() * 0.1 };
    if (round) this.roundTrees.push(t);
    else this.coneTrees.push(t);
  }

  private solid(x: number, z: number, w: number, d: number): void {
    this.solids.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 });
  }

  private house(x: number, z: number, ry: number): void {
    const w = 4.2;
    const d = 3.4;
    const storeys = this.rand() < 0.35 ? 2 : 1;
    const h = storeys * STOREY + 0.2;
    const body = this.pick1([PASTEL.white, PASTEL.white, PASTEL.cream, PASTEL.peach, PASTEL.lavender, PASTEL.blue, PASTEL.mint]);
    const roof = this.pick1([PASTEL.teal, PASTEL.blue, PASTEL.white, PASTEL.peach, PASTEL.teal]);
    this.flat.push(tint(place(new THREE.BoxGeometry(w, h, d), x, SLAB_H + h / 2, z, ry), body));
    // Hipped roof: a four-sided cone squashed to the footprint.
    const roofGeo = new THREE.ConeGeometry(1, 1.1, 4);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.scale((w + 0.5) / Math.SQRT2, 1, (d + 0.5) / Math.SQRT2);
    this.flat.push(tint(place(roofGeo, x, SLAB_H + h + 0.55, z, ry), roof));
    // Door on the long side.
    const door = place(new THREE.BoxGeometry(0.7, 1.0, 0.12), 0.8, SLAB_H + 0.5, d / 2);
    this.flat.push(tint(place(door, x, 0, z, ry), roof));
    const rot = Math.abs(Math.sin(ry)) > 0.5;
    this.solid(x, z, rot ? d : w, rot ? w : d);
  }

  private housesBlock(x: number, z: number): void {
    const o = 3.6;
    for (const [dx, dz] of [
      [-o, -o],
      [o, -o],
      [-o, o],
      [o, o],
    ] as const) {
      if (this.rand() < 0.12) {
        this.tree(x + dx, z + dz, 1.1, true);
        continue;
      }
      this.house(x + dx, z + dz, this.rand() < 0.5 ? 0 : Math.PI / 2);
    }
    const n = 2 + Math.floor(this.rand() * 3);
    for (let i = 0; i < n; i++) {
      const side = Math.floor(this.rand() * 4);
      const t = (this.rand() - 0.5) * 12;
      const e = 6.5;
      const [tx, tz] = side === 0 ? [t, -e] : side === 1 ? [t, e] : side === 2 ? [-e, t] : [e, t];
      this.tree(x + tx, z + tz, 0.7 + this.rand() * 0.5);
    }
  }

  private tower(x: number, z: number, w: number, d: number, storeys: number, color: number): void {
    const h = storeys * STOREY;
    this.facades.push(tint(place(facadeBoxGeometry(w, h, d, storeys), x, SLAB_H + h / 2, z), color));
    // Parapet and a rooftop box.
    this.flat.push(tint(place(new THREE.BoxGeometry(w + 0.3, 0.25, d + 0.3), x, SLAB_H + h + 0.1, z), PASTEL.white));
    if (this.rand() < 0.6) {
      const bw = 0.3 * w;
      this.flat.push(tint(place(new THREE.BoxGeometry(bw, 0.7, 0.3 * d), x + (this.rand() - 0.5) * 0.3 * w, SLAB_H + h + 0.55, z + (this.rand() - 0.5) * 0.3 * d), PASTEL.white));
    }
    this.solid(x, z, w, d);
  }

  private officesBlock(x: number, z: number): void {
    const colors = [PASTEL.white, PASTEL.white, PASTEL.white, PASTEL.cream, 0xbfe3dc, PASTEL.blue, PASTEL.lavender, PASTEL.peach];
    const n = 1 + Math.floor(this.rand() * 3);
    const storeys = () => 2 + Math.floor(this.rand() * 5);
    if (n === 1) {
      this.tower(x, z, 8, 8, storeys(), this.pick1(colors));
    } else if (n === 2) {
      this.tower(x - 3.2, z, 5, 7, storeys(), this.pick1(colors));
      this.tower(x + 3.4, z + 0.5, 5, 5, storeys(), this.pick1(colors));
    } else {
      this.tower(x - 3.2, z - 3, 5, 5, storeys(), this.pick1(colors));
      this.tower(x + 3.2, z - 3, 5, 5, storeys(), this.pick1(colors));
      this.tower(x, z + 3.5, 7, 4, 1 + Math.floor(this.rand() * 3), this.pick1(colors));
    }
    const m = 1 + Math.floor(this.rand() * 3);
    for (let i = 0; i < m; i++) {
      const cx = this.pick1([-6.3, 6.3]);
      this.tree(x + cx, z + (this.rand() - 0.5) * 11, 0.7 + this.rand() * 0.4, this.rand() < 0.3);
    }
  }

  private bench(x: number, z: number, ry: number): void {
    const seat = place(new THREE.BoxGeometry(1.6, 0.1, 0.5), 0, 0.45, 0);
    const back = place(new THREE.BoxGeometry(1.6, 0.4, 0.08), 0, 0.7, -0.22);
    const legL = place(new THREE.BoxGeometry(0.1, 0.4, 0.45), -0.65, 0.2, 0);
    const legR = place(new THREE.BoxGeometry(0.1, 0.4, 0.45), 0.65, 0.2, 0);
    for (const [geo, c] of [
      [seat, PASTEL.peach],
      [back, PASTEL.peach],
      [legL, PASTEL.blue],
      [legR, PASTEL.blue],
    ] as const) {
      this.flat.push(tint(place(geo, x, SLAB_H, z, ry), c));
    }
  }

  private parkBlock(x: number, z: number): void {
    const n = 7 + Math.floor(this.rand() * 4);
    const cx = x + (this.rand() - 0.5) * 6;
    const cz = z + (this.rand() - 0.5) * 6;
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = 1.5 + this.rand() * 4.5;
      const tx = THREE.MathUtils.clamp(cx + Math.cos(a) * r, x - 6.5, x + 6.5);
      const tz = THREE.MathUtils.clamp(cz + Math.sin(a) * r, z - 6.5, z + 6.5);
      this.tree(tx, tz, 0.8 + this.rand() * 0.6, this.rand() < 0.3);
    }
    if (this.rand() < 0.5) {
      const pond = new THREE.CylinderGeometry(2.2, 2.2, 0.08, 18);
      this.flat.push(tint(place(pond, x - cx > 0 ? x + 3.5 : x - 3.5, SLAB_H + 0.04, z - cz > 0 ? z + 3 : z - 3), PASTEL.paleBlue));
    }
    this.bench(x + (this.rand() - 0.5) * 8, z + 5.5, Math.PI);
  }

  private landmarkBlock(x: number, z: number, which: number): void {
    const push = (geo: THREE.BufferGeometry, color: number) => this.flat.push(tint(place(geo, x, SLAB_H, z), color));
    switch (which % 4) {
      case 0: {
        // Water tower: a tank on four legs with a cone cap.
        for (const [dx, dz] of [
          [-1.1, -1.1],
          [1.1, -1.1],
          [-1.1, 1.1],
          [1.1, 1.1],
        ] as const) {
          push(place(new THREE.CylinderGeometry(0.12, 0.14, 5.5, 6), dx, 2.75, dz), PASTEL.greyLavender);
        }
        push(place(new THREE.BoxGeometry(2.9, 0.2, 2.9), 0, 5.4, 0), PASTEL.greyLavender);
        push(place(new THREE.CylinderGeometry(1.7, 1.5, 2.4, 14), 0, 6.7, 0), PASTEL.white);
        push(place(new THREE.ConeGeometry(1.85, 1.1, 14), 0, 8.45, 0), PASTEL.teal);
        push(place(new THREE.CylinderGeometry(0.08, 0.08, 1.2, 5), 0, 9.5, 0), PASTEL.greyLavender);
        this.solid(x, z, 3.6, 3.6);
        break;
      }
      case 1: {
        // Tall spire tower.
        push(place(new THREE.BoxGeometry(5, 2.4, 5), 0, 1.2, 0), PASTEL.cream);
        this.facades.push(tint(place(facadeBoxGeometry(3.4, 7 * STOREY, 3.4, 7), x, SLAB_H + 2.4 + 3.5 * STOREY, z), PASTEL.white));
        push(place(new THREE.BoxGeometry(3.8, 0.3, 3.8), 0, 2.4 + 7 * STOREY + 0.1, 0), PASTEL.white);
        const taper = new THREE.CylinderGeometry(0.9, 1.6, 1.6, 4);
        taper.rotateY(Math.PI / 4);
        push(place(taper, 0, 2.4 + 7 * STOREY + 1.0, 0), PASTEL.cream);
        push(place(new THREE.ConeGeometry(0.9, 4.5, 4), 0, 2.4 + 7 * STOREY + 4.0, 0, Math.PI / 4), PASTEL.peach);
        this.solid(x, z, 5, 5);
        break;
      }
      case 2: {
        // Round observation tower with a dish.
        push(place(new THREE.CylinderGeometry(1.0, 1.3, 9, 12), 0, 4.5, 0), PASTEL.white);
        push(place(new THREE.CylinderGeometry(3.2, 2.4, 1.4, 16), 0, 9.6, 0), PASTEL.teal);
        push(place(new THREE.CylinderGeometry(2.3, 2.3, 1.6, 16), 0, 11.1, 0), PASTEL.white);
        push(place(new THREE.CylinderGeometry(2.5, 2.5, 0.25, 16), 0, 12.0, 0), PASTEL.teal);
        push(place(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 5), 0.8, 12.7, 0), PASTEL.greyLavender);
        const dish = new THREE.ConeGeometry(1.0, 0.45, 12, 1, true);
        dish.rotateX(-0.9);
        push(place(dish, 0.8, 13.3, 0.2), PASTEL.white);
        this.solid(x, z, 2.6, 2.6);
        break;
      }
      default: {
        // A small arch flanked by two pillars.
        push(place(new THREE.TorusGeometry(2.4, 0.45, 8, 24, Math.PI), 0, 1.6, 0), PASTEL.peach);
        push(place(new THREE.BoxGeometry(1.1, 1.6, 1.1), -2.4, 0.8, 0), PASTEL.white);
        push(place(new THREE.BoxGeometry(1.1, 1.6, 1.1), 2.4, 0.8, 0), PASTEL.white);
        this.solid(x - 2.4, z, 1.1, 1.1);
        this.solid(x + 2.4, z, 1.1, 1.1);
        break;
      }
    }
    const n = 3 + Math.floor(this.rand() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rand();
      this.tree(x + Math.cos(a) * 5.5, z + Math.sin(a) * 5.5, 0.8 + this.rand() * 0.5, i % 3 === 0);
    }
    if (which % 2 === 1) this.bench(x + 4.5, z + 3, Math.PI * 1.5);
  }

  /** Tree clumps beyond the road grid so the map does not end abruptly. */
  private buildMargins(): void {
    const gx = (GRID_COLS / 2) * CELL + ROAD_W / 2;
    const gz = (GRID_ROWS / 2) * CELL + ROAD_W / 2;
    for (let i = 0; i < 90; i++) {
      const x = (this.rand() - 0.5) * (GROUND_W - 4);
      const z = (this.rand() - 0.5) * (GROUND_D - 4);
      if (Math.abs(x) < gx && Math.abs(z) < gz) continue;
      this.tree(x, z, 0.8 + this.rand() * 0.7, this.rand() < 0.25);
    }
  }

  /** Merges collected geometry into a handful of meshes and builds the tree instances. */
  private commitMerged(): void {
    const flatMat = toonMat(0xffffff, { vertexColors: true });
    const facadeMat = toonMat(0xffffff, { vertexColors: true, map: windowTexture() });
    this.sharedDisposables.push(flatMat, facadeMat);
    const addMerged = (parts: THREE.BufferGeometry[], mat: THREE.Material) => {
      if (parts.length === 0) return;
      const merged = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      if (!merged) return;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.sharedDisposables.push(merged);
    };
    addMerged(this.flat, flatMat);
    addMerged(this.facades, facadeMat);
    this.flat.length = 0;
    this.facades.length = 0;

    // Cone tree: trunk plus two stacked cones. Round tree: trunk plus a faceted ball.
    const cone = mergeGeometries([
      tint(place(new THREE.CylinderGeometry(0.13, 0.17, 0.7, 6), 0, 0.35, 0), PASTEL.trunk),
      tint(place(new THREE.ConeGeometry(1.0, 1.9, 7), 0, 1.55, 0), PASTEL.teal),
      tint(place(new THREE.ConeGeometry(0.7, 1.5, 7), 0, 2.6, 0), PASTEL.teal),
    ]);
    // Polyhedra are non-indexed, so the trunk is converted to match before merging.
    const ball = mergeGeometries([
      tint(place(new THREE.CylinderGeometry(0.13, 0.17, 0.9, 6), 0, 0.45, 0), PASTEL.trunk).toNonIndexed(),
      tint(place(new THREE.IcosahedronGeometry(1.05, 1), 0, 1.8, 0), PASTEL.mint),
    ]);
    const treeMat = toonMat(0xffffff, { vertexColors: true });
    this.sharedDisposables.push(treeMat);
    const instanced = (geo: THREE.BufferGeometry | null, list: TreeSpot[]) => {
      if (!geo || list.length === 0) return;
      const mesh = new THREE.InstancedMesh(geo, treeMat, list.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const c = new THREE.Color();
      list.forEach((t, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.ry);
        m.compose(new THREE.Vector3(t.x, SLAB_H, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c.setScalar(t.tone));
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.sharedDisposables.push(geo);
    };
    instanced(cone, this.coneTrees);
    instanced(ball, this.roundTrees);
  }

  // ---- company HQs -------------------------------------------------------------------

  private makeBuilding(c: Company): Building {
    const group = new THREE.Group();
    group.userData.companyId = c.id;
    group.position.copy(plotPosition(c.plot));
    const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
    const mat = (color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}) => {
      const m = toonMat(color, extra);
      disposables.push(m);
      return m;
    };
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material) => {
      disposables.push(g);
      const me = new THREE.Mesh(g, m);
      me.castShadow = true;
      me.receiveShadow = true;
      group.add(me);
      return me;
    };
    const primary = pastel(c.palette.primary);
    const accent = pastel(c.palette.accent, 0.25);
    const trim = pastel(c.palette.secondary, 0.5);
    const white = mat(PASTEL.white);

    // Plot pad in a very light tint of the company colour.
    const pad = mesh(new THREE.BoxGeometry(12.4, 0.08, 12.4), mat(pastel(c.palette.primary, 0.8)));
    pad.position.y = SLAB_H + 0.04;

    // Main block: 3 to 5 storeys with a painted window grid, a parapet, and a door with a canopy.
    const storeys = 3 + (c.plot % 3);
    const h = storeys * STOREY;
    const body = mesh(facadeBoxGeometry(8, h, 7, storeys), mat(primary, { map: windowTexture() }));
    body.position.y = SLAB_H + h / 2;
    const parapet = mesh(new THREE.BoxGeometry(8.4, 0.3, 7.4), white);
    parapet.position.y = SLAB_H + h + 0.1;
    const door = mesh(new THREE.BoxGeometry(1.7, 2.1, 0.3), mat(accent));
    door.position.set(0, SLAB_H + 1.05, 3.55);
    const canopy = mesh(new THREE.BoxGeometry(2.8, 0.18, 1.1), mat(trim));
    canopy.position.set(0, SLAB_H + 2.35, 3.9);
    const step = mesh(new THREE.BoxGeometry(2.6, 0.12, 1.2), white);
    step.position.set(0, SLAB_H + 0.06, 4.1);

    // Rooftop detail: AC unit, antenna, or a small sign, by plot.
    switch (c.plot % 3) {
      case 0: {
        const ac = mesh(new THREE.BoxGeometry(1.6, 0.9, 1.2), white);
        ac.position.set(-2, SLAB_H + h + 0.7, -1.5);
        const fan = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 12), mat(PASTEL.blue));
        fan.position.set(-2, SLAB_H + h + 1.2, -1.5);
        break;
      }
      case 1: {
        const mast = mesh(new THREE.CylinderGeometry(0.07, 0.1, 3, 6), mat(PASTEL.greyLavender));
        mast.position.set(2.2, SLAB_H + h + 1.5, -1.8);
        const tip = mesh(new THREE.SphereGeometry(0.22, 8, 6), mat(accent));
        tip.position.set(2.2, SLAB_H + h + 3.1, -1.8);
        break;
      }
      default: {
        const board = mesh(new THREE.BoxGeometry(3.4, 0.9, 0.2), mat(accent));
        board.position.set(0, SLAB_H + h + 1.0, -2.6);
        const legs = mesh(new THREE.BoxGeometry(3.0, 0.5, 0.12), mat(PASTEL.greyLavender));
        legs.position.set(0, SLAB_H + h + 0.35, -2.6);
        break;
      }
    }

    // Status ring on the pad.
    const ringGeo = new THREE.RingGeometry(6.2, 6.8, 48);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
    disposables.push(ringGeo, ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = SLAB_H + 0.1;
    group.add(ring);

    // Sign on a post by the front path.
    const post = mesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 6), mat(PASTEL.greyLavender));
    post.position.set(5.2, SLAB_H + 1.5, 4.5);
    const sign = textSprite(c.name, {
      width: 512,
      height: 112,
      background: "#fffaf5",
      border: hex(accent),
      color: hex(PASTEL.ink),
      font: "bold 44px system-ui, sans-serif",
      worldWidth: 7,
    });
    sign.position.set(5.2, SLAB_H + 3.6, 4.5);
    group.add(sign);
    this.group.add(group);
    this.pickables.push(group);
    return { group, ring, ringMat, sign, status: "paused", disposables, name: c.name };
  }

  private removeBuilding(id: string): void {
    const b = this.buildings.get(id);
    if (!b) return;
    for (const d of b.disposables) d.dispose();
    disposeSprite(b.sign);
    b.group.removeFromParent();
    const i = this.pickables.indexOf(b.group);
    if (i >= 0) this.pickables.splice(i, 1);
    this.buildings.delete(id);
  }
}
