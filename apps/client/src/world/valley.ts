import * as THREE from "three";
import type { Company } from "@tokenvalley/shared";
import type { CompanyStatus, Store } from "../state/store";
import { disposeSprite, textSprite } from "./textures";

const PLOT_COLS = 4;
const PLOT_SPACING = 18;

const STATUS_COLOR: Record<CompanyStatus, number> = {
  working: 0x000000, // replaced by the palette accent
  blocked: 0xff8c00,
  waiting_on_founder: 0xffd60a,
  done: 0x2dc653,
  out_of_budget: 0xe63946,
  paused: 0x8d99ae,
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

/** Plot index -> world position of the plot centre. */
export function plotPosition(plot: number): THREE.Vector3 {
  const col = plot % PLOT_COLS;
  const row = Math.floor(plot / PLOT_COLS);
  const x = (col - (PLOT_COLS - 1) / 2) * PLOT_SPACING;
  const z = (row - 0.5) * PLOT_SPACING;
  return new THREE.Vector3(x, 0, z);
}

/**
 * The valley map: a green ground, a road, trees, and one low-poly building
 * per company with a sign and a status glow ring.
 */
export class Valley {
  readonly group = new THREE.Group();
  private readonly buildings = new Map<string, Building>();
  private readonly sharedDisposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  private readonly pickables: THREE.Object3D[] = [];
  private time = 0;

  constructor() {
    const groundGeo = new THREE.PlaneGeometry(160, 120);
    const groundMat = new THREE.MeshLambertMaterial({ color: 0x5fa85c });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    this.group.add(ground);
    this.sharedDisposables.push(groundGeo, groundMat);

    // A road between the two plot rows.
    const roadGeo = new THREE.PlaneGeometry(PLOT_COLS * PLOT_SPACING + 10, 3);
    const roadMat = new THREE.MeshLambertMaterial({ color: 0x5a5f6b });
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.0;
    this.group.add(road);
    this.sharedDisposables.push(roadGeo, roadMat);

    // Hills on the horizon and scattered trees for a valley feel.
    const hillMat = new THREE.MeshLambertMaterial({ color: 0x4e8f4a });
    const hillGeo = new THREE.ConeGeometry(18, 10, 7);
    this.sharedDisposables.push(hillMat, hillGeo);
    const hillSpots: [number, number, number][] = [
      [-60, -45, 1.2],
      [-20, -52, 0.9],
      [25, -50, 1.1],
      [62, -42, 1.0],
      [-70, 30, 0.8],
      [70, 32, 0.9],
    ];
    for (const [x, z, s] of hillSpots) {
      const hill = new THREE.Mesh(hillGeo, hillMat);
      hill.position.set(x, -0.5, z);
      hill.scale.set(s, s, s);
      this.group.add(hill);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.25, 1, 6);
    const leafGeo = new THREE.ConeGeometry(1.1, 2.4, 6);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a4f2a });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x2e8b57 });
    this.sharedDisposables.push(trunkGeo, leafGeo, trunkMat, leafMat);
    let seed = 7;
    const rand = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 60; i++) {
      const x = (rand() - 0.5) * 150;
      const z = (rand() - 0.5) * 110;
      // Keep the plot area clear.
      if (Math.abs(x) < PLOT_COLS * PLOT_SPACING * 0.55 && Math.abs(z) < PLOT_SPACING * 1.1) continue;
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(x, 0.5, z);
      const leaves = new THREE.Mesh(leafGeo, leafMat);
      leaves.position.set(x, 2.1, z);
      leaves.castShadow = true;
      this.group.add(trunk, leaves);
    }
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
        b.ringMat.color.setHex(status === "working" ? new THREE.Color(c.palette.accent).getHex() : STATUS_COLOR[status]);
      }
      b.group.visible = true;
      // Highlight the focused company's plot with a slightly bigger ring.
      const focused = store.focusedCompanyId === c.id;
      b.ring.scale.setScalar(focused ? 1.15 : 1);
    }
    for (const id of [...this.buildings.keys()]) if (!seen.has(id)) this.removeBuilding(id);
  }

  update(dt: number): void {
    this.time += dt;
    for (const b of this.buildings.values()) {
      if (b.status === "waiting_on_founder") {
        b.ringMat.opacity = 0.45 + 0.45 * (0.5 + 0.5 * Math.sin(this.time * 5));
      } else {
        b.ringMat.opacity = 0.85;
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

  dispose(): void {
    for (const id of [...this.buildings.keys()]) this.removeBuilding(id);
    for (const d of this.sharedDisposables) d.dispose();
    this.group.removeFromParent();
  }

  private makeBuilding(c: Company): Building {
    const group = new THREE.Group();
    group.userData.companyId = c.id;
    group.position.copy(plotPosition(c.plot));
    const disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
    const mat = (color: THREE.ColorRepresentation) => {
      const m = new THREE.MeshLambertMaterial({ color });
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
    // Plot pad.
    const pad = mesh(new THREE.BoxGeometry(13, 0.2, 13), mat(c.palette.floor));
    pad.position.y = 0.1;
    // Main block with a two-step profile.
    const base = mesh(new THREE.BoxGeometry(8, 4, 7), mat(c.palette.primary));
    base.position.y = 2.2;
    const upper = mesh(new THREE.BoxGeometry(6, 2.4, 5), mat(c.palette.secondary));
    upper.position.y = 5.4;
    const roof = mesh(new THREE.ConeGeometry(4.4, 2, 4), mat(c.palette.accent));
    roof.position.y = 7.6;
    roof.rotation.y = Math.PI / 4;
    // Door and windows on the front (+z).
    const door = mesh(new THREE.BoxGeometry(1.4, 2.2, 0.2), mat(c.palette.accent));
    door.position.set(0, 1.3, 3.55);
    const winMat = mat(0xbde0fe);
    for (const x of [-2.6, 2.6]) {
      const win = mesh(new THREE.BoxGeometry(1.4, 1.2, 0.2), winMat);
      win.position.set(x, 2.6, 3.55);
    }
    // Status ring on the ground.
    const ringGeo = new THREE.RingGeometry(6.0, 6.9, 40);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    disposables.push(ringGeo, ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.25;
    group.add(ring);
    // Sign on a post.
    const post = mesh(new THREE.CylinderGeometry(0.12, 0.12, 3, 6), mat(0x6c584c));
    post.position.set(5.2, 1.5, 4.5);
    // Dark text on light accents, white on dark ones.
    const accent = new THREE.Color(c.palette.accent);
    const luminance = 0.2126 * accent.r + 0.7152 * accent.g + 0.0722 * accent.b;
    const sign = textSprite(c.name, {
      width: 512,
      height: 112,
      background: c.palette.accent,
      color: luminance > 0.5 ? "#1b1f2a" : "#ffffff",
      font: "bold 44px system-ui, sans-serif",
      worldWidth: 7,
    });
    sign.position.set(5.2, 3.6, 4.5);
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
