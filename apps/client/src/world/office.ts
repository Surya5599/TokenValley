import * as THREE from "three";
import { HOME_SPOTS, OFFICE_DEPTH, OFFICE_ROOMS, OFFICE_WIDTH, type Palette, type Room } from "@tokenvalley/shared";
import { isWalkable, reachableFrom, type ObstacleGrid, type Tile } from "./pathfinding";
import { canvasTexture, makeCanvas, wrapText } from "./textures";

export type { Tile } from "./pathfinding";

const W = OFFICE_WIDTH;
const D = OFFICE_DEPTH;

/** Tile -> world position (tile centres, floor at y = 0). */
export function tileToWorld(t: Tile, y = 0): THREE.Vector3 {
  return new THREE.Vector3(t.x - W / 2 + 0.5, y, t.z - D / 2 + 0.5);
}

export function spotTile(spotId: string): Tile | null {
  const s = HOME_SPOTS[spotId];
  return s ? { x: s.x, z: s.z } : null;
}

const SEAT_H = 0.42;
const DESK_H = 0.8;
const ROOM_WALL_H = 1.3;

function lambert(color: THREE.ColorRepresentation): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

type Canvas = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture };

/**
 * One open-plan floor built from OFFICE_ROOMS (walls, doors, labels) and
 * HOME_SPOTS (where furniture goes). Same plan for every company; palette,
 * sign and props differentiate it. Produces the obstacle grid used by A*.
 */
export class Office {
  readonly group = new THREE.Group();
  readonly grid: ObstacleGrid;
  readonly meetingSeats: Tile[] = [];
  /** Idle/coffee destinations in the break room and the kitchen. */
  readonly breakSpots: Tile[] = [];
  readonly kitchenSpots: Tile[] = [];
  readonly entranceSpot: Tile;
  readonly bellSpot: Tile;
  readonly closetSpot: Tile;
  meetingCenter: THREE.Vector3 = tileToWorld(spotTile("meeting_room") ?? { x: 14, z: 5 }, 0.5);
  /** Tile each spot faces when a character stands/sits there. */
  readonly faceTiles = new Map<string, Tile>();
  /** The founder's marker in the lobby; hidden while walking in first person. */
  visitorMarker: THREE.Mesh | null = null;

  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly monitors = new Map<string, { mat: THREE.MeshLambertMaterial; until: number }>();
  private readonly rackLeds: THREE.MeshBasicMaterial[] = [];
  private alarmLight: THREE.PointLight | null = null;
  private alarmMat: THREE.MeshBasicMaterial | null = null;
  private alarmUntil = 0;
  private bell: THREE.Group | null = null;
  private bellRingUntil = 0;
  private signCanvas: Canvas | null = null;
  private boardCanvas: Canvas | null = null;
  private incidentDays = -1;
  private taskTitles: string[] = [];
  private time = 0;

  // Shared materials.
  private readonly deskMat: THREE.Material;
  private readonly accentMat: THREE.Material;
  private readonly darkMat: THREE.Material;
  private readonly woodMat: THREE.Material;
  private readonly whiteMat: THREE.Material;
  private readonly plantMat: THREE.Material;
  private readonly potMat: THREE.Material;
  private readonly metalMat: THREE.Material;

  constructor(
    readonly palette: Palette,
    readonly companyName = "",
  ) {
    this.grid = Array.from({ length: D }, () => Array.from({ length: W }, () => false));
    this.entranceSpot = spotTile("entrance") ?? spotTile("lobby") ?? { x: 1, z: 14 };
    this.bellSpot = spotTile("bell") ?? this.entranceSpot;
    this.closetSpot = spotTile("server_closet") ?? this.entranceSpot;

    this.deskMat = lambert(palette.secondary);
    this.accentMat = lambert(palette.accent);
    this.darkMat = lambert(0x2f3542);
    this.woodMat = lambert(0x9c6b3c);
    this.whiteMat = lambert(0xf1f2f6);
    this.plantMat = lambert(0x2ecc71);
    this.potMat = lambert(0x8e5a3a);
    this.metalMat = lambert(0x9aa5b1);
    this.materials.push(this.deskMat, this.accentMat, this.darkMat, this.woodMat, this.whiteMat, this.plantMat, this.potMat, this.metalMat);

    this.buildFloorAndPerimeter();
    this.buildRooms();
    for (const room of OFFICE_ROOMS) this.furnishRoom(room);
    this.furnishBullpen();

    this.setIncidentDays(0);
    this.setTasks([]);
    this.verifyLayout();
  }

  // ---- public API --------------------------------------------------------

  /** Updates the task whiteboard (first 8 titles). */
  setTasks(titles: string[]): void {
    if (titles.length === this.taskTitles.length && titles.every((t, i) => t === this.taskTitles[i])) return;
    this.taskTitles = titles.slice(0, 8);
    if (!this.boardCanvas) return;
    const { ctx, canvas, tex } = this.boardCanvas;
    this.drawBoardBase(ctx, canvas.width, canvas.height, "TASKS");
    ctx.font = "22px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    this.taskTitles.forEach((t, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 20 + col * (canvas.width / 2);
      const y = 56 + row * 34;
      ctx.fillStyle = ["#ffd166", "#ef476f", "#06d6a0", "#118ab2"][i % 4] ?? "#ffd166";
      ctx.fillRect(x, y + 4, 14, 14);
      ctx.fillStyle = "#1e2a3a";
      const line = wrapText(ctx, t, canvas.width / 2 - 50, 1)[0] ?? "";
      ctx.fillText(line, x + 22, y);
    });
    tex.needsUpdate = true;
  }

  setIncidentDays(days: number): void {
    const d = Math.max(0, Math.floor(days));
    if (d === this.incidentDays || !this.signCanvas) return;
    this.incidentDays = d;
    const { ctx, canvas, tex } = this.signCanvas;
    ctx.fillStyle = "#f8f3e6";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#b03a2e";
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
    ctx.fillStyle = "#333";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.fillText("DAYS WITHOUT INCIDENT", canvas.width / 2, 34);
    ctx.fillStyle = "#b03a2e";
    ctx.font = "bold 72px system-ui, sans-serif";
    ctx.fillText(String(d), canvas.width / 2, 96);
    tex.needsUpdate = true;
  }

  /** Red alarm in the IT closet for a few seconds. */
  flashAlarm(seconds = 3): void {
    this.alarmUntil = this.time + seconds;
  }

  ringBell(): void {
    this.bellRingUntil = this.time + 1.2;
  }

  /** Green terminal glow on the monitor at a spot. */
  glowMonitor(spotId: string, seconds = 1.5): void {
    const m = this.monitors.get(spotId);
    if (m) m.until = this.time + seconds;
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    this.rackLeds.forEach((led, i) => {
      const on = Math.sin(t * (3 + (i % 5)) + i) > 0.3;
      led.color.setHex(on ? (i % 3 === 0 ? 0xff9f1c : 0x2ec4b6) : 0x1b1b1b);
    });
    if (this.alarmMat && this.alarmLight) {
      if (t < this.alarmUntil) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 14);
        this.alarmMat.color.setHex(pulse > 0.5 ? 0xff2a2a : 0x550000);
        this.alarmLight.intensity = pulse * 6;
      } else {
        this.alarmMat.color.setHex(0x550000);
        this.alarmLight.intensity = 0;
      }
    }
    if (this.bell) this.bell.rotation.z = t < this.bellRingUntil ? Math.sin(t * 30) * 0.25 : 0;
    for (const m of this.monitors.values()) m.mat.emissive.setHex(t < m.until ? 0x1f7a3f : 0x0b2a44);
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.signCanvas?.tex.dispose();
    this.boardCanvas?.tex.dispose();
    this.group.removeFromParent();
  }

  isWalkable(t: Tile): boolean {
    return isWalkable(this.grid, t.x, t.z);
  }

  /** World-space (x, z) -> tile. */
  worldToTile(x: number, z: number): Tile {
    return { x: Math.floor(x + W / 2), z: Math.floor(z + D / 2) };
  }

  /** True when a world-space point is blocked or off the floor. */
  blockedAt(x: number, z: number): boolean {
    const t = this.worldToTile(x, z);
    if (t.x < 0 || t.z < 0 || t.x >= W || t.z >= D) return true;
    return !this.isWalkable(t);
  }

  // ---- structure -----------------------------------------------------------

  private buildFloorAndPerimeter(): void {
    const floorGeo = new THREE.PlaneGeometry(W, D);
    const floorMat = lambert(this.palette.floor);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.track(floorGeo, floorMat);
    this.group.add(floor);

    const wallMat = lambert(this.palette.wall);
    this.materials.push(wallMat);
    // Back (north) and left (west) walls are tall; front and right are cut away.
    this.wallBox(0, 0, W - 1, 0, 2.4, wallMat);
    this.wallBox(0, 1, 0, D - 1, 2.4, wallMat);
    this.wallBox(1, D - 1, W - 1, D - 1, 0.5, wallMat);
    this.wallBox(W - 1, 1, W - 1, D - 2, 0.5, wallMat);
    // Front door panel on the outer wall next to the entrance spot.
    const e = this.entranceSpot;
    const doorGeo = new THREE.BoxGeometry(0.25, 2.2, 1.1);
    this.track(doorGeo);
    const door = new THREE.Mesh(doorGeo, this.accentMat);
    door.position.copy(tileToWorld({ x: e.x - 1, z: e.z }, 1.1)).add(new THREE.Vector3(0.3, 0, 0));
    this.group.add(door);
  }

  /** Walls for every room with gaps at doors and at HOME_SPOT tiles. */
  private buildRooms(): void {
    const partMat = lambert(new THREE.Color(this.palette.wall).multiplyScalar(0.92));
    this.materials.push(partMat);
    const spotKeys = new Set(Object.values(HOME_SPOTS).map((s) => `${s.x},${s.z}`));
    const doorKeys = new Set<string>();
    const wallOwner = new Map<string, Room>();
    for (const room of OFFICE_ROOMS) {
      for (const d of room.doors) doorKeys.add(`${d.x},${d.z}`);
      for (let x = room.x0; x <= room.x1; x++) {
        wallOwner.set(`${x},${room.z0}`, room);
        wallOwner.set(`${x},${room.z1}`, room);
      }
      for (let z = room.z0; z <= room.z1; z++) {
        wallOwner.set(`${room.x0},${z}`, room);
        wallOwner.set(`${room.x1},${z}`, room);
      }
    }
    // A door that opens straight onto another room's wall carves that wall
    // tile too (e.g. the manager's office opens into reception).
    const carved = new Set<string>();
    for (const room of OFFICE_ROOMS) {
      for (const d of room.doors) {
        for (const [dx, dz] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const k = `${d.x + dx},${d.z + dz}`;
          const owner = wallOwner.get(k);
          if (owner && owner !== room && !doorKeys.has(k)) carved.add(k);
        }
      }
    }
    const isGap = (x: number, z: number) => {
      const k = `${x},${z}`;
      return doorKeys.has(k) || spotKeys.has(k) || carved.has(k);
    };
    // Draw each wall as contiguous runs between gaps so it reads as one wall.
    const drawn = new Set<string>();
    const run = (tiles: Tile[]) => {
      let start: Tile | null = null;
      let prev: Tile | null = null;
      const flush = () => {
        if (start && prev) {
          this.wallBox(start.x, start.z, prev.x, prev.z, ROOM_WALL_H, partMat);
          start = null;
          prev = null;
        }
      };
      for (const t of tiles) {
        const k = `${t.x},${t.z}`;
        if (isGap(t.x, t.z)) {
          flush();
          continue;
        }
        if (drawn.has(k)) {
          // Shared with a wall already drawn: block it but don't double-draw.
          this.block(t.x, t.z, t.x, t.z);
          flush();
          continue;
        }
        drawn.add(k);
        if (!start) start = t;
        prev = t;
      }
      flush();
    };
    for (const room of OFFICE_ROOMS) {
      if (room.id === "restrooms") {
        // Drawn as a solid box in furnishRoom; its last column stays a corridor.
        this.roomLabel(room);
        continue;
      }
      const top: Tile[] = [];
      const bottom: Tile[] = [];
      const left: Tile[] = [];
      const right: Tile[] = [];
      for (let x = room.x0; x <= room.x1; x++) {
        top.push({ x, z: room.z0 });
        bottom.push({ x, z: room.z1 });
      }
      for (let z = room.z0 + 1; z <= room.z1 - 1; z++) {
        left.push({ x: room.x0, z });
        right.push({ x: room.x1, z });
      }
      run(top);
      run(bottom);
      run(left);
      run(right);
      this.roomLabel(room);
    }
  }

  private roomLabel(room: Room): void {
    const { canvas, ctx } = makeCanvas(256, 64);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(room.label.toUpperCase(), 128, 32, 240);
    const tex = canvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const geo = new THREE.PlaneGeometry(3.2, 0.8);
    this.track(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    // Centre of the room, nudged towards the front wall so furniture rarely covers it.
    const cx = (room.x0 + room.x1) / 2;
    const cz = room.z1 - 1.2;
    mesh.position.set(cx - W / 2 + 0.5, 0.02, cz - D / 2 + 0.5);
    this.group.add(mesh);
  }

  // ---- furnishing -------------------------------------------------------------

  private furnishRoom(room: Room): void {
    const s = (id: string) => spotTile(id);
    switch (room.id) {
      case "ceo_office": {
        const spot = s("ceo_office") ?? { x: 4, z: 4 };
        this.desk(spot.x - 1, spot.z - 1, spot.x + 1, spot.z - 1, this.woodMat, "ceo_office");
        this.faceTiles.set("ceo_office", { x: spot.x, z: spot.z - 1 });
        this.chair(spot.x - 1, spot.z + 1);
        this.chair(spot.x + 1, spot.z + 1);
        this.box(room.x1 - 2, room.z0 + 1, room.x1 - 1, room.z0 + 1, 1.6, this.woodMat); // bookshelf
        this.plant(room.x0 + 1, room.z1 - 1);
        break;
      }
      case "meeting_room": {
        const spot = s("meeting_room") ?? { x: 14, z: 5 };
        const tz = spot.z - 1;
        this.box(spot.x - 2, tz, spot.x + 2, tz, DESK_H, this.woodMat); // long table
        for (let x = spot.x - 2; x <= spot.x + 2; x++) {
          for (const z of [tz - 1, tz + 1]) {
            this.meetingSeats.push({ x, z });
            this.chair(x, z);
            this.faceTiles.set(`seat_${x}_${z}`, { x, z: tz });
          }
        }
        this.faceTiles.set("meeting_room", { x: spot.x, z: tz });
        this.makeBoard(spot.x - 2, room.z0 + 1, spot.x + 2, room.z0 + 1, "", true); // projector screen
        this.meetingCenter = tileToWorld({ x: spot.x, z: tz }, 0.5);
        break;
      }
      case "kitchen": {
        const spot = s("kitchen") ?? { x: 22, z: 4 };
        this.box(room.x0 + 1, room.z0 + 1, room.x1 - 1, room.z0 + 1, 0.9, this.whiteMat); // counter
        this.coffeeMachine(room.x0 + 2, room.z0 + 1);
        this.box(room.x1 - 1, room.z0 + 2, room.x1 - 1, room.z0 + 2, 1.8, this.metalMat); // fridge
        this.box(room.x0 + 1, room.z1 - 1, room.x0 + 1, room.z1 - 1, 0.7, this.woodMat); // small table
        this.faceTiles.set("kitchen", { x: spot.x, z: room.z0 + 1 });
        for (const t of [spot, { x: spot.x + 1, z: spot.z }, { x: spot.x, z: spot.z + 1 }, { x: spot.x + 1, z: spot.z + 1 }]) this.kitchenSpots.push(t);
        break;
      }
      case "hallway": {
        // Stairs: three rising steps against the back wall.
        for (let i = 0; i < 3; i++) this.box(room.x0 + 1, room.z0 + 1 + i, room.x1 - 1, room.z0 + 1 + i, 0.9 - i * 0.3, this.metalMat);
        break;
      }
      case "break_room": {
        const spot = s("break_room") ?? { x: 35, z: 4 };
        const vend = s("vending") ?? { x: 37, z: 2 };
        this.vending(vend.x, vend.z + 1);
        this.vending(vend.x, vend.z + 2);
        this.faceTiles.set("vending", { x: vend.x, z: vend.z + 1 });
        this.roundTable(room.x0 + 2, room.z0 + 2);
        this.roundTable(room.x0 + 2, room.z1 - 1);
        this.roundTable(room.x1 - 2, room.z1 - 1);
        this.makeBoard(room.x0 + 2, room.z0 + 1, room.x0 + 3, room.z0 + 1, "", false, false, 0x0b1020); // TV
        this.faceTiles.set("break_room", { x: spot.x, z: spot.z - 1 });
        for (const t of [spot, { x: spot.x - 1, z: spot.z }, { x: spot.x, z: spot.z + 1 }, { x: spot.x + 1, z: spot.z }, { x: spot.x - 1, z: spot.z + 1 }]) this.breakSpots.push(t);
        break;
      }
      case "annex": {
        for (const id of ["floating_1", "floating_2", "floating_3"]) {
          const spot = s(id);
          if (!spot) continue;
          this.desk(spot.x - 2, spot.z, spot.x - 1, spot.z, this.deskMat, id, "east");
          this.faceTiles.set(id, { x: spot.x - 1, z: spot.z });
        }
        this.cabinet(room.x1 - 1, room.z0 + 1);
        this.plant(room.x1 - 1, room.z1 - 1);
        break;
      }
      case "server_closet": {
        const spot = s("server_closet") ?? { x: 35, z: 25 };
        this.rack(room.x1 - 2, room.z0 + 1, room.x1 - 1, room.z0 + 2);
        this.rack(room.x1 - 2, room.z1 - 3, room.x1 - 1, room.z1 - 2);
        this.fan(room.x0 + 2, room.z1 - 1);
        this.faceTiles.set("server_closet", { x: spot.x + 1, z: spot.z });
        const alarmGeo = new THREE.SphereGeometry(0.18, 10, 8);
        this.alarmMat = new THREE.MeshBasicMaterial({ color: 0x550000 });
        const alarm = new THREE.Mesh(alarmGeo, this.alarmMat);
        alarm.position.copy(tileToWorld({ x: spot.x, z: room.z0 + 1 }, 1.9));
        this.track(alarmGeo, this.alarmMat);
        this.group.add(alarm);
        this.alarmLight = new THREE.PointLight(0xff2020, 0, 9);
        this.alarmLight.position.copy(alarm.position);
        this.group.add(this.alarmLight);
        break;
      }
      case "restrooms": {
        // A closed box nobody enters. The last column stays open as a corridor
        // so the neighbouring closet door is reachable.
        const x1 = room.x1 - 1;
        this.block(room.x0, room.z0, x1, room.z1);
        const geo = new THREE.BoxGeometry(x1 - room.x0 + 1 - 0.2, 2.0, room.z1 - room.z0 + 1 - 0.2);
        this.track(geo);
        const mesh = new THREE.Mesh(geo, this.whiteMat);
        mesh.position.set((room.x0 + x1) / 2 - W / 2 + 0.5, 1.0, (room.z0 + room.z1) / 2 - D / 2 + 0.5);
        this.group.add(mesh);
        for (const dz of [2, 6]) {
          const dGeo = new THREE.BoxGeometry(0.12, 1.6, 0.9);
          this.track(dGeo);
          const d = new THREE.Mesh(dGeo, this.darkMat);
          d.position.copy(tileToWorld({ x: room.x0, z: room.z0 + dz }, 0.8)).add(new THREE.Vector3(-0.5, 0, 0));
          this.group.add(d);
        }
        break;
      }
      case "accounting": {
        const spot = s("cfo_desk") ?? { x: 5, z: 24 };
        this.desk(spot.x - 1, spot.z - 1, spot.x + 1, spot.z - 1, this.deskMat, "cfo_desk");
        this.faceTiles.set("cfo_desk", { x: spot.x, z: spot.z - 1 });
        this.jar(spot.x + 1, spot.z - 1);
        this.calculator(spot.x - 1, spot.z - 1);
        this.desk(room.x1 - 3, room.z0 + 2, room.x1 - 2, room.z0 + 2, this.deskMat, "acct_1");
        this.chair(room.x1 - 2, room.z0 + 3);
        this.desk(room.x1 - 3, room.z1 - 2, room.x1 - 2, room.z1 - 2, this.deskMat, "acct_2");
        this.chair(room.x1 - 2, room.z1 - 1);
        this.cabinet(room.x0 + 1, room.z0 + 1);
        this.cabinet(room.x0 + 1, room.z0 + 2);
        break;
      }
      case "lobby": {
        const rec = s("reception") ?? { x: 6, z: 11 };
        const bell = s("bell") ?? { x: 7, z: 12 };
        const couch = s("couch") ?? { x: 4, z: 17 };
        this.receptionDesk(rec.x - 2, rec.z + 1, rec.x, rec.z + 1);
        this.faceTiles.set("reception", { x: rec.x, z: rec.z + 1 });
        this.faceTiles.set("lobby", { x: rec.x, z: rec.z + 1 });
        this.faceTiles.set("entrance", { x: this.entranceSpot.x + 1, z: this.entranceSpot.z });
        this.bell = this.makeBell({ x: rec.x, z: rec.z + 1 });
        this.faceTiles.set("bell", { x: rec.x, z: rec.z + 1 });
        void bell;
        this.box(couch.x - 1, couch.z + 1, couch.x + 1, couch.z + 1, 0.6, this.accentMat); // couch
        this.box(couch.x - 1, couch.z + 1, couch.x + 1, couch.z + 1, 1.0, this.accentMat, 0.35); // couch back
        this.faceTiles.set("couch", { x: couch.x, z: couch.z - 1 });
        this.plant(room.x0 + 1, room.z1 - 1);
        this.plant(room.x1 - 1, room.z1 - 1);
        this.companySign(room.x0 + 1, room.z0, room.x0 + 4, room.z0);
        // Founder's visitor marker: a glowing disc in the waiting area (not blocking).
        const lobby = s("lobby") ?? { x: 5, z: 14 };
        const markerGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 16);
        const markerMat = new THREE.MeshBasicMaterial({ color: this.palette.accent, transparent: true, opacity: 0.6 });
        this.track(markerGeo, markerMat);
        this.visitorMarker = new THREE.Mesh(markerGeo, markerMat);
        this.visitorMarker.position.copy(tileToWorld({ x: lobby.x, z: lobby.z + 1 }, 0.04));
        this.group.add(this.visitorMarker);
        break;
      }
    }
  }

  /** The open bullpen between the rooms: PM + whiteboard, dev cluster, copier, front desks. */
  private furnishBullpen(): void {
    const s = (id: string) => spotTile(id);
    const wb = s("whiteboard");
    if (wb) {
      this.boardCanvas = this.makeBoard(wb.x - 1, wb.z - 1, wb.x + 1, wb.z - 1, "TASKS");
      this.faceTiles.set("whiteboard", { x: wb.x, z: wb.z - 1 });
    }
    const pm = s("pm_desk");
    if (pm) {
      this.desk(pm.x - 1, pm.z - 1, pm.x + 1, pm.z - 1, this.deskMat, "pm_desk");
      this.faceTiles.set("pm_desk", { x: pm.x, z: pm.z - 1 });
    }
    // Dev cluster: pods 1/2 face south, pods 3/4 face north, desks back to back.
    for (const [id, dir] of [
      ["dev_pod_1", 1],
      ["dev_pod_2", 1],
      ["dev_pod_3", -1],
      ["dev_pod_4", -1],
    ] as const) {
      const p = s(id);
      if (!p) continue;
      this.desk(p.x - 1, p.z + dir, p.x + 1, p.z + dir, this.deskMat, id, dir === 1 ? "south" : "north");
      this.faceTiles.set(id, { x: p.x, z: p.z + dir });
      this.can(p.x + 1, p.z + dir);
    }
    const copier = s("copier");
    if (copier) {
      this.box(copier.x, copier.z + 1, copier.x, copier.z + 1, 1.1, this.metalMat);
      const trayGeo = new THREE.BoxGeometry(0.6, 0.05, 0.4);
      this.track(trayGeo);
      const tray = new THREE.Mesh(trayGeo, this.whiteMat);
      tray.position.copy(tileToWorld({ x: copier.x, z: copier.z + 1 }, 0.9)).add(new THREE.Vector3(0, 0, -0.5));
      this.group.add(tray);
      this.faceTiles.set("copier", { x: copier.x, z: copier.z + 1 });
    }
    for (const id of ["design_corner", "qa_bench"]) {
      const p = s(id);
      if (!p) continue;
      this.desk(p.x - 1, p.z - 1, p.x + 1, p.z - 1, id === "qa_bench" ? this.woodMat : this.deskMat, id);
      this.faceTiles.set(id, { x: p.x, z: p.z - 1 });
      if (id === "qa_bench") this.jar(p.x + 1, p.z - 1);
    }
    // Filing cabinets, plants and the incident sign along the front wall.
    const front = D - 2;
    this.cabinet(13, front);
    this.cabinet(14, front);
    this.cabinet(24, front);
    this.cabinet(25, front);
    this.plant(13, 21);
    this.plant(25, 21);
    this.signCanvas = this.makeIncidentSign(19, front, 22, front);
  }

  // ---- builders ---------------------------------------------------------------

  private track(geo: THREE.BufferGeometry, mat?: THREE.Material): void {
    this.geometries.push(geo);
    if (mat) this.materials.push(mat);
  }

  private block(x0: number, z0: number, x1: number, z1: number): void {
    for (let z = z0; z <= z1; z++) {
      const row = this.grid[z];
      if (!row) continue;
      for (let x = x0; x <= x1; x++) if (x >= 0 && x < W) row[x] = true;
    }
  }

  /** A box covering the tile rectangle, blocking it. */
  private box(x0: number, z0: number, x1: number, z1: number, h: number, mat: THREE.Material, zShift = 0, inset = 0.08): THREE.Mesh {
    const w = x1 - x0 + 1 - inset * 2;
    const d = z1 - z0 + 1 - inset * 2;
    const geo = new THREE.BoxGeometry(w, h, d);
    this.track(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x0 + x1) / 2 - W / 2 + 0.5, h / 2, (z0 + z1) / 2 - D / 2 + 0.5 + zShift);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.block(x0, z0, x1, z1);
    return mesh;
  }

  private wallBox(x0: number, z0: number, x1: number, z1: number, h: number, mat: THREE.Material): void {
    this.box(x0, z0, x1, z1, h, mat, 0, 0.3);
  }

  /** A desk with a monitor on its middle tile; `facing` is the side the user sits on. */
  private desk(x0: number, z0: number, x1: number, z1: number, mat: THREE.Material, spotId: string, facing: "north" | "south" | "east" = "north"): void {
    this.box(x0, z0, x1, z1, DESK_H, mat);
    const mx = Math.floor((x0 + x1) / 2);
    const mz = Math.floor((z0 + z1) / 2);
    const standGeo = new THREE.BoxGeometry(0.1, 0.2, 0.1);
    const screenGeo = new THREE.BoxGeometry(0.7, 0.45, 0.06);
    this.track(standGeo);
    this.track(screenGeo);
    const stand = new THREE.Mesh(standGeo, this.darkMat);
    const screenMat = new THREE.MeshLambertMaterial({ color: 0x0f172a, emissive: 0x0b2a44 });
    this.materials.push(screenMat);
    const screen = new THREE.Mesh(screenGeo, screenMat);
    const base = tileToWorld({ x: mx, z: mz }, DESK_H);
    // Monitor sits on the far edge from the user.
    const off = facing === "north" ? new THREE.Vector3(0, 0, -0.2) : facing === "south" ? new THREE.Vector3(0, 0, 0.2) : new THREE.Vector3(-0.2, 0, 0);
    stand.position.copy(base).add(off).add(new THREE.Vector3(0, 0.1, 0));
    screen.position.copy(base).add(off).add(new THREE.Vector3(0, 0.42, 0));
    if (facing === "south") screen.rotation.y = Math.PI;
    if (facing === "east") screen.rotation.y = Math.PI / 2;
    this.group.add(stand, screen);
    this.monitors.set(spotId, { mat: screenMat, until: 0 });
  }

  /** A chair that does not block (characters sit on it). */
  private chair(x: number, z: number): void {
    const seatGeo = new THREE.BoxGeometry(0.6, 0.1, 0.6);
    const legGeo = new THREE.CylinderGeometry(0.05, 0.05, SEAT_H, 6);
    this.track(seatGeo);
    this.track(legGeo);
    const p = tileToWorld({ x, z });
    const seat = new THREE.Mesh(seatGeo, this.darkMat);
    seat.position.set(p.x, SEAT_H, p.z);
    const leg = new THREE.Mesh(legGeo, this.darkMat);
    leg.position.set(p.x, SEAT_H / 2, p.z);
    this.group.add(seat, leg);
  }

  private roundTable(x: number, z: number): void {
    const geo = new THREE.CylinderGeometry(0.5, 0.1, 0.75, 12);
    this.track(geo);
    const m = new THREE.Mesh(geo, this.woodMat);
    m.position.copy(tileToWorld({ x, z }, 0.375));
    this.group.add(m);
    this.block(x, z, x, z);
    this.chair(x - 1, z);
    this.chair(x + 1, z);
  }

  private plant(x: number, z: number): void {
    const potGeo = new THREE.CylinderGeometry(0.22, 0.18, 0.4, 8);
    const leafGeo = new THREE.ConeGeometry(0.4, 0.9, 6);
    this.track(potGeo);
    this.track(leafGeo);
    const p = tileToWorld({ x, z });
    const potMesh = new THREE.Mesh(potGeo, this.potMat);
    potMesh.position.set(p.x, 0.2, p.z);
    const leafMesh = new THREE.Mesh(leafGeo, this.plantMat);
    leafMesh.position.set(p.x, 0.85, p.z);
    this.group.add(potMesh, leafMesh);
    this.block(x, z, x, z);
  }

  private cabinet(x: number, z: number): void {
    const m = this.box(x, z, x, z, 1.2, this.metalMat, 0, 0.15);
    const hGeo = new THREE.BoxGeometry(0.3, 0.04, 0.05);
    this.track(hGeo);
    for (const y of [0.4, 0.8]) {
      const h = new THREE.Mesh(hGeo, this.darkMat);
      h.position.set(m.position.x, y, m.position.z - 0.38);
      this.group.add(h);
    }
  }

  private can(x: number, z: number): void {
    const geo = new THREE.CylinderGeometry(0.08, 0.08, 0.26, 8);
    this.track(geo);
    const m = new THREE.Mesh(geo, this.accentMat);
    const p = tileToWorld({ x, z }, DESK_H + 0.13);
    m.position.set(p.x + 0.25, p.y, p.z + 0.2);
    this.group.add(m);
  }

  private jar(x: number, z: number): void {
    const geo = new THREE.CylinderGeometry(0.16, 0.16, 0.3, 8);
    this.track(geo);
    const m = new THREE.Mesh(geo, this.whiteMat);
    const p = tileToWorld({ x, z }, DESK_H + 0.15);
    m.position.set(p.x + 0.2, p.y, p.z + 0.2);
    this.group.add(m);
  }

  private calculator(x: number, z: number): void {
    const geo = new THREE.BoxGeometry(0.22, 0.04, 0.3);
    this.track(geo);
    const m = new THREE.Mesh(geo, this.darkMat);
    const p = tileToWorld({ x, z }, DESK_H + 0.02);
    m.position.set(p.x - 0.1, p.y, p.z + 0.15);
    this.group.add(m);
  }

  /** Reception desk: a straight run plus a quarter-round end, so it reads as curved. */
  private receptionDesk(x0: number, z: number, x1: number, zEnd: number): void {
    this.box(x0, z, x1, zEnd, DESK_H, this.deskMat);
    const endGeo = new THREE.CylinderGeometry(0.5, 0.5, DESK_H, 12, 1, false, 0, Math.PI / 2);
    this.track(endGeo);
    const end = new THREE.Mesh(endGeo, this.deskMat);
    end.position.copy(tileToWorld({ x: x1, z }, DESK_H / 2)).add(new THREE.Vector3(0.45, 0, 0.45));
    end.rotation.y = Math.PI;
    this.group.add(end);
  }

  private makeBell(onTile: Tile): THREE.Group {
    const g = new THREE.Group();
    const baseGeo = new THREE.CylinderGeometry(0.16, 0.18, 0.05, 10);
    const bellGeo = new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    this.track(baseGeo);
    this.track(bellGeo);
    const base = new THREE.Mesh(baseGeo, this.darkMat);
    const bell = new THREE.Mesh(bellGeo, this.accentMat);
    bell.position.y = 0.05;
    g.add(base, bell);
    g.position.copy(tileToWorld(onTile, DESK_H + 0.03)).add(new THREE.Vector3(0.25, 0, 0));
    this.group.add(g);
    return g;
  }

  private drawBoardBase(ctx: CanvasRenderingContext2D, w: number, h: number, title: string): void {
    ctx.fillStyle = "#f7f7f2";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#8d99ae";
    ctx.lineWidth = 8;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    if (title) {
      ctx.fillStyle = "#2b2d42";
      ctx.font = "bold 28px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(title, 20, 14);
    }
  }

  /** A wall-mounted board facing +z. Returns its canvas so text can be redrawn. */
  private makeBoard(x0: number, z0: number, x1: number, z1: number, title: string, stickies = false, vertical = false, fill?: number): Canvas {
    const { canvas, ctx } = makeCanvas(512, 256);
    if (fill !== undefined) {
      ctx.fillStyle = `#${fill.toString(16).padStart(6, "0")}`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else this.drawBoardBase(ctx, canvas.width, canvas.height, title);
    if (stickies) {
      const colors = ["#ffd166", "#ff8fab", "#9bf6ff", "#caffbf"];
      for (let i = 0; i < 7; i++) {
        ctx.fillStyle = colors[i % colors.length] ?? "#ffd166";
        ctx.fillRect(40 + i * 62, 80 + (i % 3) * 40, 44, 44);
      }
    }
    const tex = canvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    this.materials.push(mat);
    const len = vertical ? z1 - z0 + 1 : x1 - x0 + 1;
    const geo = new THREE.BoxGeometry(vertical ? 0.15 : len - 0.2, 1.1, vertical ? len - 0.2 : 0.15);
    this.track(geo);
    const frame = lambert(0x6c757d);
    this.materials.push(frame);
    // Box material order: +x, -x, +y, -y, +z, -z
    const mats = vertical ? [frame, mat, frame, frame, frame, frame] : [frame, frame, frame, frame, mat, frame];
    const mesh = new THREE.Mesh(geo, mats);
    mesh.position.set((x0 + x1) / 2 - W / 2 + 0.5, 1.5, (z0 + z1) / 2 - D / 2 + 0.5);
    this.group.add(mesh);
    this.block(x0, z0, x1, z1);
    return { canvas, ctx, tex };
  }

  private makeIncidentSign(x0: number, z0: number, x1: number, z1: number): Canvas {
    const { canvas, ctx } = makeCanvas(512, 160);
    const tex = canvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    this.materials.push(mat);
    const geo = new THREE.BoxGeometry(x1 - x0 + 1 - 0.3, 1.0, 0.12);
    this.track(geo);
    const frame = lambert(0x6c757d);
    this.materials.push(frame);
    // Faces north (-z), into the room.
    const mesh = new THREE.Mesh(geo, [frame, frame, frame, frame, frame, mat]);
    mesh.position.set((x0 + x1) / 2 - W / 2 + 0.5, 1.3, (z0 + z1) / 2 - D / 2 + 0.5);
    this.group.add(mesh);
    this.block(x0, z0, x1, z1);
    return { canvas, ctx, tex };
  }

  /** Company name on the reception back wall, facing into the lobby (+z). */
  private companySign(x0: number, z0: number, x1: number, z1: number): void {
    const { canvas, ctx } = makeCanvas(512, 128);
    ctx.fillStyle = this.palette.primary;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const c = new THREE.Color(this.palette.primary);
    const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    ctx.fillStyle = lum > 0.5 ? "#1b1f2a" : "#ffffff";
    ctx.font = "bold 48px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(this.companyName || "TokenValley", canvas.width / 2, canvas.height / 2, canvas.width - 40);
    const tex = canvasTexture(canvas);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    this.materials.push(mat);
    const geo = new THREE.PlaneGeometry(x1 - x0 + 1 - 0.2, 0.9);
    this.track(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((x0 + x1) / 2 - W / 2 + 0.5, 1.9, z0 - D / 2 + 0.5 + 0.36);
    this.group.add(mesh);
    void z1;
  }

  private rack(x0: number, z0: number, x1: number, z1: number): void {
    this.box(x0, z0, x1, z1, 2.0, this.darkMat);
    for (let i = 0; i < 6; i++) {
      const ledGeo = new THREE.BoxGeometry(0.05, 0.1, 0.1);
      this.track(ledGeo);
      const ledMat = new THREE.MeshBasicMaterial({ color: 0x2ec4b6 });
      this.materials.push(ledMat);
      this.rackLeds.push(ledMat);
      const led = new THREE.Mesh(ledGeo, ledMat);
      const base = tileToWorld({ x: x0, z: z0 });
      led.position.set(base.x - 0.5, 0.4 + i * 0.26, base.z + 0.2 + (i % 2) * 0.5);
      this.group.add(led);
    }
  }

  private fan(x: number, z: number): void {
    const geo = new THREE.CylinderGeometry(0.35, 0.35, 0.1, 10);
    this.track(geo);
    const m = new THREE.Mesh(geo, this.darkMat);
    m.rotation.x = Math.PI / 2;
    m.position.copy(tileToWorld({ x, z }, 0.6));
    this.group.add(m);
    this.block(x, z, x, z);
  }

  private coffeeMachine(x: number, z: number): void {
    const geo = new THREE.BoxGeometry(0.5, 0.6, 0.5);
    this.track(geo);
    const m = new THREE.Mesh(geo, this.darkMat);
    m.position.copy(tileToWorld({ x, z }, 0.9 + 0.3));
    this.group.add(m);
    const potGeo = new THREE.CylinderGeometry(0.1, 0.12, 0.2, 8);
    this.track(potGeo);
    const pot = new THREE.Mesh(potGeo, this.accentMat);
    pot.position.copy(tileToWorld({ x: x + 1, z }, 1.0));
    this.group.add(pot);
  }

  private vending(x: number, z: number): void {
    this.box(x, z, x, z, 1.9, this.darkMat);
    const g = new THREE.BoxGeometry(0.05, 1.2, 0.6);
    this.track(g);
    const panel = new THREE.Mesh(g, this.accentMat);
    const p = tileToWorld({ x, z }, 1.1);
    panel.position.set(p.x - 0.5, p.y, p.z);
    this.group.add(panel);
  }

  // ---- verification ---------------------------------------------------------

  /** Every HOME_SPOT, door, meeting seat and idle spot must be walkable and reachable from the entrance. */
  private verifyLayout(): void {
    const reach = reachableFrom(this.grid, this.entranceSpot);
    const check = (name: string, t: Tile) => {
      if (!this.isWalkable(t)) console.warn(`[office] ${name} (${t.x},${t.z}) is blocked by furniture`);
      else if (!reach.has(`${t.x},${t.z}`)) console.warn(`[office] ${name} (${t.x},${t.z}) is not reachable from the entrance`);
    };
    for (const [id, s] of Object.entries(HOME_SPOTS)) check(`spot ${id}`, { x: s.x, z: s.z });
    for (const room of OFFICE_ROOMS) {
      if (room.id === "restrooms") continue;
      room.doors.forEach((d, i) => check(`${room.id} door ${i}`, d));
    }
    this.meetingSeats.forEach((t, i) => check(`meeting seat ${i}`, t));
    this.breakSpots.forEach((t, i) => check(`break spot ${i}`, t));
    this.kitchenSpots.forEach((t, i) => check(`kitchen spot ${i}`, t));
  }
}
