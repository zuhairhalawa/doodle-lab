/**
 * Lifts the user's own pencil lines off the photo. For every moving body we
 * copy its patch of the photo into a sprite (paper made transparent, graphite
 * kept), and paint the spot it came from with the colour of the paper around
 * it. Ropes and springs between moving things are erased too and redrawn live.
 */
import { boxCorners } from '../scene/geometry.ts';
import type { Body, Scene } from '../scene/types.ts';

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Body centre inside the sprite canvas. */
  cx: number;
  cy: number;
}

export interface Cutouts {
  background: HTMLCanvasElement;
  sprites: Map<string, Sprite>;
  /** Average pencil colour, used to redraw ropes and springs. */
  ink: string;
  paper: string;
}

type RGB = [number, number, number];
const lum = ([r, g, b]: RGB) => 0.299 * r + 0.587 * g + 0.114 * b;

function median(values: number[]): number {
  const s = values.sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 255;
}

/** Median colour of the photo in a ring around (x, y). */
function ringColour(data: ImageData, x: number, y: number, r0: number, r1: number): RGB {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  for (let k = 0; k < 160; k++) {
    const a = (k / 160) * Math.PI * 2;
    for (const rr of [r0, (r0 + r1) / 2, r1]) {
      const px = Math.round(x + Math.cos(a) * rr);
      const py = Math.round(y + Math.sin(a) * rr);
      if (px < 0 || py < 0 || px >= data.width || py >= data.height) continue;
      const i = (py * data.width + px) * 4;
      rs.push(data.data[i]!);
      gs.push(data.data[i + 1]!);
      bs.push(data.data[i + 2]!);
    }
  }
  // The brightest half is the paper; the darker half may be lines and labels.
  const pick = (xs: number[]) => median(xs.sort((a, b) => a - b).slice(Math.floor(xs.length / 3)));
  return [pick(rs), pick(gs), pick(bs)];
}

const css = ([r, g, b]: RGB) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

/** Where the body is drawn on the photo (the checker may have nudged the simulated one). */
const drawn = (b: Body): Body => ({ ...b, x: b.drawnX, y: b.drawnY });

function shapePath(ctx: CanvasRenderingContext2D, b: Body, grow: number) {
  ctx.beginPath();
  if (b.kind === 'ball') ctx.arc(b.x, b.y, b.r + grow, 0, Math.PI * 2);
  else {
    const cs = boxCorners({ ...b, w: b.w + grow * 2, h: b.h + grow * 2 });
    ctx.moveTo(cs[0]!.x, cs[0]!.y);
    for (const c of cs.slice(1)) ctx.lineTo(c.x, c.y);
    ctx.closePath();
  }
}

export function cutOut(photo: HTMLCanvasElement, scene: Scene): Cutouts {
  const W = photo.width;
  const H = photo.height;
  const pctx = photo.getContext('2d', { willReadFrequently: true })!;
  const data = pctx.getImageData(0, 0, W, H);
  const background = document.createElement('canvas');
  background.width = W;
  background.height = H;
  const bg = background.getContext('2d')!;
  bg.drawImage(photo, 0, 0);
  const sprites = new Map<string, Sprite>();
  const grow = Math.max(4, Math.min(W, H) * 0.008);
  const inks: number[] = [];
  let paperAll: RGB = [245, 245, 240];

  const movers = scene.bodies.filter((b) => b.dynamic && (b.kind === 'ball' || b.kind === 'box')).map(drawn);
  for (const b of movers) {
    const reach = b.kind === 'ball' ? b.r : Math.hypot(b.w, b.h) / 2;
    const paper = ringColour(data, b.x, b.y, reach + grow * 2, reach + grow * 4);
    paperAll = paper;
    const pl = lum(paper);
    // Sprite: the patch, clipped to the shape, with the paper turned transparent.
    const size = Math.ceil((reach + grow * 2) * 2);
    const sc = document.createElement('canvas');
    sc.width = size;
    sc.height = size;
    const s = sc.getContext('2d', { willReadFrequently: true })!;
    s.save();
    s.translate(size / 2 - b.x, size / 2 - b.y);
    shapePath(s, b, grow);
    s.clip();
    s.drawImage(photo, 0, 0);
    s.restore();
    const img = s.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] === 0) continue;
      const l = lum([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!]);
      const a = Math.max(0, Math.min(1, (pl - l) / (pl * 0.45) - 0.08));
      if (a > 0.5) inks.push(l);
      img.data[i + 3] = Math.round(a * 255);
    }
    s.putImageData(img, 0, 0);
    sprites.set(b.id, { canvas: sc, cx: size / 2, cy: size / 2 });
    // Erase it from the page.
    bg.save();
    bg.fillStyle = css(paper);
    shapePath(bg, b, grow * 1.6);
    bg.fill();
    bg.restore();
  }

  // Erase drawn ropes, rods and springs; they are redrawn as they move.
  for (const j of scene.joints) {
    if (j.kind === 'pin') continue;
    const mid = { x: (j.aPoint.x + j.bPoint.x) / 2, y: (j.aPoint.y + j.bPoint.y) / 2 };
    const len = Math.hypot(j.bPoint.x - j.aPoint.x, j.bPoint.y - j.aPoint.y);
    const paper = ringColour(data, mid.x, mid.y, j.kind === 'spring' ? 30 : 12, j.kind === 'spring' ? 40 : 20);
    bg.save();
    bg.strokeStyle = css(paper);
    bg.lineCap = 'round';
    bg.lineWidth = j.kind === 'spring' ? Math.max(34, len * 0.02 + 30) : grow * 2.2;
    bg.beginPath();
    // Stop just short of a fixed end so the ceiling or wall line stays.
    const ux = (j.bPoint.x - j.aPoint.x) / (len || 1);
    const uy = (j.bPoint.y - j.aPoint.y) / (len || 1);
    const inset = j.a ? 0 : grow * 1.5;
    bg.moveTo(j.aPoint.x + ux * inset, j.aPoint.y + uy * inset);
    bg.lineTo(j.bPoint.x, j.bPoint.y);
    bg.stroke();
    bg.restore();
  }

  const inkL = inks.length ? median(inks) : 70;
  const ink = `rgba(${inkL * 0.9}, ${inkL * 0.9}, ${inkL}, 0.9)`;
  // Erasing a block also erases the bit of ramp or floor under it. Put those lines
  // back, but only where the original photo really had a dark line, so a surface the
  // reader placed a little off never shows up as a stray stroke.
  const darkAt = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= W || yi >= H) return false;
    let best = 255;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const i = (Math.min(H - 1, Math.max(0, yi + dy)) * W + Math.min(W - 1, Math.max(0, xi + dx))) * 4;
        best = Math.min(best, lum([data.data[i]!, data.data[i + 1]!, data.data[i + 2]!]));
      }
    return best < lum(paperAll) * 0.72;
  };
  bg.save();
  bg.beginPath();
  for (const b of movers) {
    if (b.kind === 'ball') {
      bg.moveTo(b.x + b.r + grow * 1.6, b.y);
      bg.arc(b.x, b.y, b.r + grow * 1.6, 0, Math.PI * 2);
    } else {
      const cs = boxCorners({ ...b, w: b.w + grow * 3.2, h: b.h + grow * 3.2 });
      bg.moveTo(cs[0]!.x, cs[0]!.y);
      for (const c of cs.slice(1)) bg.lineTo(c.x, c.y);
      bg.closePath();
    }
  }
  bg.clip();
  bg.strokeStyle = ink;
  bg.lineWidth = Math.max(1.6, Math.min(W, H) / 380);
  bg.lineCap = 'round';
  for (const s of scene.bodies) {
    if (s.kind !== 'surface') continue;
    for (let i = 1; i < s.points.length; i++) {
      const a = s.points[i - 1]!;
      const b = s.points[i]!;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 3));
      for (let k = 0; k < n; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
        const q = { x: a.x + ((b.x - a.x) * (k + 1)) / n, y: a.y + ((b.y - a.y) * (k + 1)) / n };
        if (!darkAt(p.x, p.y) || !darkAt(q.x, q.y)) continue;
        bg.beginPath();
        bg.moveTo(p.x, p.y);
        bg.lineTo(q.x, q.y);
        bg.stroke();
      }
    }
  }
  bg.restore();
  return { background, sprites, ink, paper: css(paperAll) };
}
