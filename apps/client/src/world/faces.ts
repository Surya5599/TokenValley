import * as THREE from "three";

/**
 * One small canvas face per character: two eyes (dot pupils that can shift
 * toward a look target), eyebrows and a mouth. The texture is redrawn only
 * when something visible changes (expression, blink, talk phase, a pupil
 * step), never every frame.
 */

export type Expression = "neutral" | "smile" | "big_smile" | "frown" | "surprised" | "talking" | "closed" | "smirk";

export const FACE_SIZE = 64;

/** Resting mouth curve for a look: 0 flat, 1 a warm smile, 2 a big grin. */
export type SmileBase = 0 | 1 | 2;

export class Face {
  readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private expression: Expression = "neutral";
  private blink = false;
  private mouthOpen = false;
  /** Pupil offset in canvas pixels, quantized so small drifts do not redraw. */
  private px = 0;
  private py = 0;
  private dirty = true;

  constructor(
    private readonly base: SmileBase,
    private readonly glasses: boolean,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = FACE_SIZE;
    this.canvas.height = FACE_SIZE;
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas context unavailable");
    this.ctx = ctx;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.flush();
  }

  get current(): Expression {
    return this.expression;
  }

  setExpression(e: Expression): void {
    if (e === this.expression) return;
    this.expression = e;
    this.dirty = true;
  }

  setBlink(closed: boolean): void {
    if (closed === this.blink) return;
    this.blink = closed;
    this.dirty = true;
  }

  /** Talking mouths alternate open/closed; only meaningful while the expression is "talking". */
  setMouthOpen(open: boolean): void {
    if (open === this.mouthOpen) return;
    this.mouthOpen = open;
    this.dirty = true;
  }

  /** Pupil shift in -1..1 (x right, y up); quantized to whole pixels. */
  setPupils(x: number, y: number): void {
    const qx = Math.round(THREE.MathUtils.clamp(x, -1, 1) * 3);
    const qy = Math.round(THREE.MathUtils.clamp(y, -1, 1) * 2);
    if (qx === this.px && qy === this.py) return;
    this.px = qx;
    this.py = qy;
    this.dirty = true;
  }

  /** Redraws if anything changed. Call once per frame; it is a no-op most frames. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.draw();
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }

  private draw(): void {
    const ctx = this.ctx;
    const S = FACE_SIZE;
    ctx.clearRect(0, 0, S, S);
    const ink = "#3b3a4f";
    const e = this.expression;
    const closed = this.blink || e === "closed";
    const eyeY = 26;
    const eyeDX = 12;
    const cx = S / 2;

    // Eyes.
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineCap = "round";
    for (const side of [-1, 1]) {
      const x = cx + side * eyeDX;
      if (closed) {
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(x - 4, eyeY + 1);
        ctx.lineTo(x + 4, eyeY + 1);
        ctx.stroke();
        continue;
      }
      const r = e === "surprised" ? 5 : 4;
      if (e === "surprised" || this.glasses) {
        // A white so the pupil reads inside a wide eye or behind glasses.
        ctx.fillStyle = "#fffdf8";
        ctx.beginPath();
        ctx.arc(x, eyeY, r + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = ink;
      }
      ctx.beginPath();
      ctx.arc(x + this.px, eyeY - this.py, e === "surprised" ? 3.5 : 3.6, 0, Math.PI * 2);
      ctx.fill();
      if (e === "smile" || e === "big_smile" || e === "smirk") {
        // Happy eyes: a little lid over the top of the pupil.
        ctx.fillStyle = "rgba(0,0,0,0)";
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath();
        ctx.arc(x + this.px, eyeY - this.py - 5, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = ink;
      }
    }

    // Eyebrows: only drawn when they carry the expression.
    ctx.lineWidth = 2.2;
    if (e === "frown") {
      for (const side of [-1, 1]) {
        const x = cx + side * eyeDX;
        ctx.beginPath();
        ctx.moveTo(x - side * 5, eyeY - 9);
        ctx.lineTo(x + side * 4, eyeY - 6);
        ctx.stroke();
      }
    } else if (e === "surprised") {
      for (const side of [-1, 1]) {
        const x = cx + side * eyeDX;
        ctx.beginPath();
        ctx.arc(x, eyeY - 6, 5, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    } else if (e === "smirk") {
      ctx.beginPath();
      ctx.moveTo(cx + eyeDX - 5, eyeY - 10);
      ctx.lineTo(cx + eyeDX + 4, eyeY - 8);
      ctx.stroke();
    }

    // Mouth.
    const my = 44;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    switch (e) {
      case "talking": {
        if (this.mouthOpen) {
          ctx.fillStyle = ink;
          ctx.ellipse(cx, my, 5, 4, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.moveTo(cx - 5, my);
          ctx.lineTo(cx + 5, my);
          ctx.stroke();
        }
        break;
      }
      case "surprised":
        ctx.fillStyle = ink;
        ctx.ellipse(cx, my + 1, 3.5, 5, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case "frown":
        ctx.arc(cx, my + 7, 7, Math.PI * 1.2, Math.PI * 1.8);
        ctx.stroke();
        break;
      case "big_smile":
        ctx.fillStyle = ink;
        ctx.arc(cx, my - 3, 9, 0.15, Math.PI - 0.15);
        ctx.closePath();
        ctx.fill();
        break;
      case "smile":
        ctx.arc(cx, my - 5, 9, Math.PI * 0.2, Math.PI * 0.8);
        ctx.stroke();
        break;
      case "smirk":
        ctx.moveTo(cx - 4, my + 1);
        ctx.quadraticCurveTo(cx + 3, my + 2, cx + 7, my - 3);
        ctx.stroke();
        break;
      case "neutral":
      case "closed": {
        if (this.base === 2) {
          ctx.arc(cx, my - 4, 8, Math.PI * 0.15, Math.PI * 0.85);
        } else if (this.base === 1) {
          ctx.arc(cx, my - 8, 10, Math.PI * 0.3, Math.PI * 0.7);
        } else {
          ctx.moveTo(cx - 4, my);
          ctx.lineTo(cx + 4, my);
        }
        ctx.stroke();
        break;
      }
    }
  }
}
