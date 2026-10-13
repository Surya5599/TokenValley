import * as THREE from "three";

/** Small canvas helpers shared by signs, name tags, and speech bubbles. */

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas context unavailable");
  return { canvas, ctx };
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/** Greedy word wrap limited to maxLines; the last line is cut with an ellipsis. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let line = "";
  let overflow = false;
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (ctx.measureText(candidate).width <= maxWidth || line.length === 0) {
      line = candidate;
    } else {
      if (lines.length === maxLines - 1) {
        overflow = true;
        break;
      }
      lines.push(line);
      line = word;
    }
  }
  if (!overflow && line.length > 0) lines.push(line);
  if (overflow) {
    let trimmed = line;
    while (trimmed.length > 1 && ctx.measureText(`${trimmed}...`).width > maxWidth) trimmed = trimmed.slice(0, -1);
    lines.push(`${trimmed}...`);
  }
  return lines;
}

export function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

export interface SpriteOptions {
  width?: number; // canvas px
  height?: number;
  font?: string;
  color?: string;
  background?: string;
  border?: string;
  /** World-space width of the sprite; height follows the canvas aspect. */
  worldWidth?: number;
}

/** A sprite showing a single line of text on a rounded background. */
export function textSprite(text: string, opts: SpriteOptions = {}): THREE.Sprite {
  const w = opts.width ?? 256;
  const h = opts.height ?? 64;
  const { canvas, ctx } = makeCanvas(w, h);
  if (opts.background) {
    ctx.fillStyle = opts.background;
    roundRect(ctx, 2, 2, w - 4, h - 4, 12);
    ctx.fill();
  }
  if (opts.border) {
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = 4;
    roundRect(ctx, 3, 3, w - 6, h - 6, 12);
    ctx.stroke();
  }
  ctx.fillStyle = opts.color ?? "#ffffff";
  ctx.font = opts.font ?? "bold 28px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2, w - 16);
  const mat = new THREE.SpriteMaterial({ map: canvasTexture(canvas), transparent: true, depthWrite: false, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.layers.set(1); // overlay layer: drawn after post-processing, always sharp
  const ww = opts.worldWidth ?? 2;
  sprite.scale.set(ww, (ww * h) / w, 1);
  return sprite;
}

export function disposeSprite(sprite: THREE.Sprite): void {
  const mat = sprite.material;
  mat.map?.dispose();
  mat.dispose();
}
