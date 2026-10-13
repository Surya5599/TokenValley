import * as THREE from "three";

/**
 * The pastel, toy-city look shared by the valley, the office, and the
 * characters: a fixed palette, a 3-step toon gradient, and small canvas
 * textures (window grids, floor tiles) so detail is painted, not modelled.
 */

/** Objects on this layer (name tags, speech bubbles, signs) are drawn after post-processing so they stay sharp. */
export const OVERLAY_LAYER = 1;

export const PASTEL = {
  ground: 0xf3c6d3,
  mint: 0x9fd8c9,
  teal: 0x2f9e8f,
  road: 0xe9b6c8,
  roadEdge: 0xfffaf5,
  white: 0xf7f5f2,
  cream: 0xfbf1e3,
  peach: 0xf6b79c,
  lavender: 0xc9b8e8,
  blue: 0x6fa3d8,
  paleBlue: 0xd6e8ff,
  sage: 0xa8c3a0,
  coral: 0xf28b82,
  rose: 0xe8a0b4,
  pink: 0xf5a3c7,
  yellow: 0xf7d774,
  greyLavender: 0xb3aec9,
  ink: 0x3b3a4f,
  trunk: 0xb98f6e,
  window: 0x4a5872,
} as const;

let gradient: THREE.DataTexture | null = null;

/** A 3-step gradient map so toon shading reads as flat, soft bands. */
export function toonGradient(): THREE.DataTexture {
  if (gradient) return gradient;
  const steps = [168, 214, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  gradient = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  gradient.minFilter = THREE.NearestFilter;
  gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false;
  gradient.needsUpdate = true;
  return gradient;
}

export function toonMat(color: THREE.ColorRepresentation, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });
}

/** Mixes a colour toward white. Saturated palette colours get the full mix; already-light ones only a touch. */
export function pastel(color: THREE.ColorRepresentation, amount = 0.45): THREE.Color {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const k = hsl.l > 0.78 ? amount * 0.3 : amount;
  return c.lerp(new THREE.Color(0xffffff), k);
}

export function hex(color: THREE.ColorRepresentation): string {
  return `#${new THREE.Color(color).getHexString()}`;
}

/** Writes a constant vertex colour so geometries with different colours can be merged into one mesh. */
export function tint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = geo.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Scale, rotate about Y, then translate a geometry in place. */
export function place(geo: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, sx = 1, sy = sx, sz = sx): THREE.BufferGeometry {
  if (sx !== 1 || sy !== 1 || sz !== 1) geo.scale(sx, sy, sz);
  if (ry !== 0) geo.rotateY(ry);
  geo.translate(x, y, z);
  return geo;
}

let windowTex: THREE.CanvasTexture | null = null;

/** One window per tile: a dark rounded rectangle on white, repeated across a facade. */
export function windowTexture(): THREE.CanvasTexture {
  if (windowTex) return windowTex;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = hex(PASTEL.window);
  ctx.beginPath();
  ctx.roundRect(36, 28, 56, 68, 10);
  ctx.fill();
  // A soft sill line under each window.
  ctx.fillStyle = "#e6e2dd";
  ctx.fillRect(32, 98, 64, 6);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  windowTex = tex;
  return tex;
}

export const STOREY = 1.2;

/**
 * A box whose side faces repeat the window texture once per unit of width
 * and once per storey; top and bottom sample a plain corner of the tile.
 */
export function facadeBoxGeometry(w: number, h: number, d: number, storeys: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z; four vertices each.
  for (let i = 0; i < uv.count; i++) {
    const face = Math.floor(i / 4);
    let u = uv.getX(i);
    let v = uv.getY(i);
    if (face === 2 || face === 3) {
      u = 0.03;
      v = 0.03;
    } else {
      const len = face < 2 ? d : w;
      u *= Math.max(1, Math.round(len));
      v *= Math.max(1, Math.round(storeys));
    }
    uv.setXY(i, u, v);
  }
  return geo;
}

/** A subtle two-tone tile floor, one tile per world unit when repeated W/2 x D/2. */
export function floorTileTexture(w: number, d: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  const a = "#fbf1e6";
  const b = "#f8e6e6";
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? a : b;
      ctx.fillRect(x * 64, y * 64, 64, 64);
    }
  }
  ctx.strokeStyle = "rgba(220, 190, 200, 0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 126, 126);
  ctx.beginPath();
  ctx.moveTo(64, 0);
  ctx.lineTo(64, 128);
  ctx.moveTo(0, 64);
  ctx.lineTo(128, 64);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(w / 2, d / 2);
  tex.anisotropy = 4;
  return tex;
}

/** A vertical pale-blue to cream gradient used as the scene background. */
export function skyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#eef6ff");
  g.addColorStop(0.55, "#f7f4f6");
  g.addColorStop(1, "#fff4ec");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}
