/**
 * Pixel refinement: the AI says what is drawn and roughly where; this snaps
 * each circle, box, line and rope to the pencil marks actually in the photo.
 * It only moves a shape when the new position sits clearly better on the ink,
 * and it never adds or removes anything.
 *
 * Pure functions over a grey image, so the browser and the eval share them.
 */
import type { Reading, YX } from './schema.ts';

export interface InkMap {
  w: number;
  h: number;
  /** 0 = paper, 1 = a dark pencil line. Slightly blurred so searches are smooth. */
  ink: Float32Array;
}

export interface Refined {
  reading: Reading;
  /** What was moved, for the "what the checker changed" list. */
  moved: { id: string; by: number }[];
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  // Separable running-sum blur with clamped edges.
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += src[row + Math.min(w - 1, x + r + 1)]! - src[row + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}

/** Ink map from 8-bit grey pixels: darkness relative to the local paper brightness. */
export function inkMap(grey: Uint8Array | Uint8ClampedArray, w: number, h: number): InkMap {
  const g = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = grey[i]!;
  // Local paper brightness: a wide blur of a "lightened" image (lines removed by a max-ish pass).
  const light = new Float32Array(g);
  const r0 = Math.max(2, Math.round(Math.min(w, h) / 300));
  // Grey-level closing approximation: blur, then take the brighter of blur and pixel.
  const b1 = boxBlur(g, w, h, r0 * 3);
  for (let i = 0; i < g.length; i++) light[i] = Math.max(g[i]!, b1[i]!);
  const paper = boxBlur(light, w, h, r0 * 12);
  const ink = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) {
    const p = Math.max(40, paper[i]!);
    ink[i] = Math.max(0, Math.min(1, ((p - g[i]!) / p) * 3.2 - 0.12));
  }
  return { w, h, ink: boxBlur(ink, w, h, Math.max(1, Math.round(r0 * 0.75))) };
}

function at(m: InkMap, x: number, y: number): number {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= m.w || yi >= m.h) return 0;
  return m.ink[yi * m.w + xi]!;
}

function circleScore(m: InkMap, cx: number, cy: number, r: number): number {
  let s = 0;
  const n = 72;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    s += at(m, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return s / n;
}

function segScore(m: InkMap, ax: number, ay: number, bx: number, by: number): number {
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(6, Math.round(len / 4));
  let s = 0;
  // Skip the very ends: corners are shared with other lines.
  for (let k = 1; k < n; k++) s += at(m, ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
  return s / (n - 1);
}

function rectScore(m: InkMap, p: { cx: number; cy: number; w: number; h: number; a: number }): number {
  const c = Math.cos(p.a);
  const s = Math.sin(p.a);
  const pts = [
    [-p.w / 2, -p.h / 2],
    [p.w / 2, -p.h / 2],
    [p.w / 2, p.h / 2],
    [-p.w / 2, p.h / 2],
  ].map(([u, v]) => [p.cx + u! * c + v! * s, p.cy - u! * s + v! * c] as const);
  let t = 0;
  for (let i = 0; i < 4; i++) t += segScore(m, pts[i]![0], pts[i]![1], pts[(i + 1) % 4]![0], pts[(i + 1) % 4]![1]);
  return t / 4;
}

/** Only accept a move when the shape now sits clearly on ink. */
const GOOD = 0.32;
const GAIN = 1.15;

export function refine(reading: Reading, m: InkMap): Refined {
  const r = structuredClone(reading);
  const moved: Refined['moved'] = [];
  const W = m.w;
  const H = m.h;
  const px = (p: YX) => ({ x: (p[1] / 1000) * W, y: (p[0] / 1000) * H });
  const yx = (x: number, y: number): YX => [(y / H) * 1000, (x / W) * 1000];
  const balls: { id: string; x: number; y: number; r: number }[] = [];

  for (const o of r.objects) {
    if (o.kind === 'ball' && o.box_2d?.length === 4) {
      const [y0, x0, y1, x1] = o.box_2d;
      const cx = (((x0 + x1) / 2) / 1000) * W;
      const cy = (((y0 + y1) / 2) / 1000) * H;
      const rad = (((x1 - x0) / 1000) * W + ((y1 - y0) / 1000) * H) / 4;
      if (rad < 3) continue;
      const before = circleScore(m, cx, cy, rad);
      let best = { x: cx, y: cy, r: rad, s: before };
      const step = Math.max(1.5, rad / 8);
      // Search up to 1.6 radii away, preferring circles close to where the AI put it.
      let bestPen = before;
      for (let dy = -rad * 1.6; dy <= rad * 1.6; dy += step)
        for (let dx = -rad * 1.6; dx <= rad * 1.6; dx += step)
          for (let k = 0.6; k <= 1.5; k += 0.06) {
            const s = circleScore(m, cx + dx, cy + dy, rad * k);
            const pen = s - 0.03 * (Math.hypot(dx, dy) / rad);
            if (pen > bestPen) {
              bestPen = pen;
              best = { x: cx + dx, y: cy + dy, r: rad * k, s };
            }
          }
      for (let dy = -2; dy <= 2; dy += 0.5)
        for (let dx = -2; dx <= 2; dx += 0.5)
          for (let dr = -2; dr <= 2; dr += 0.5) {
            const s = circleScore(m, best.x + dx, best.y + dy, best.r + dr);
            if (s > best.s && best.r + dr > 2) best = { x: best.x + dx, y: best.y + dy, r: best.r + dr, s };
          }
      // Two balls must not snap onto the same drawn circle.
      const clash = balls.some((b) => Math.hypot(b.x - best.x, b.y - best.y) < Math.max(b.r, best.r) * 0.6);
      if (best.s >= GOOD && best.s > before * GAIN && !clash) {
        o.box_2d = [((best.y - best.r) / H) * 1000, ((best.x - best.r) / W) * 1000, ((best.y + best.r) / H) * 1000, ((best.x + best.r) / W) * 1000];
        moved.push({ id: o.id, by: Math.hypot(best.x - cx, best.y - cy) });
        balls.push({ id: o.id, ...best });
      } else balls.push({ id: o.id, x: cx, y: cy, r: rad });
    } else if (o.kind === 'box' && o.box_2d?.length === 4) {
      const [y0, x0, y1, x1] = o.box_2d;
      const a = ((o.angleDeg ?? 0) * Math.PI) / 180;
      const W0 = ((x1 - x0) / 1000) * W;
      const H0 = ((y1 - y0) / 1000) * H;
      // Size from the bounding box and tilt (same maths as the checker).
      const c = Math.abs(Math.cos(a));
      const s = Math.abs(Math.sin(a));
      const det = c * c - s * s;
      let bw = W0;
      let bh = H0;
      if (Math.abs(det) > 0.25) {
        bw = (W0 * c - H0 * s) / det;
        bh = (H0 * c - W0 * s) / det;
      }
      if (!(bw > 2 && bh > 2)) bw = bh = (W0 + H0) / (2 * (c + s));
      let p = { cx: (((x0 + x1) / 2) / 1000) * W, cy: (((y0 + y1) / 2) / 1000) * H, w: bw, h: bh, a };
      const start = { ...p };
      const before = rectScore(m, p);
      let score = before;
      // Try the opposite tilt too: readers often get the sign wrong.
      for (const alt of [{ ...p, a: -a }]) {
        const sAlt = rectScore(m, alt);
        if (sAlt > score) {
          p = alt;
          score = sAlt;
        }
      }
      const steps = { cx: Math.max(bw, bh) / 4, cy: Math.max(bw, bh) / 4, w: bw * 0.15, h: bh * 0.15, a: (8 * Math.PI) / 180 };
      for (let it = 0; it < 80; it++) {
        let improved = false;
        for (const key of ['cx', 'cy', 'w', 'h', 'a'] as const) {
          for (const sign of [1, -1]) {
            const q = { ...p, [key]: p[key] + sign * steps[key] };
            if (q.w < 3 || q.h < 3) continue;
            const sq = rectScore(m, q);
            if (sq > score) {
              p = q;
              score = sq;
              improved = true;
            }
          }
        }
        if (!improved) {
          for (const key of Object.keys(steps) as (keyof typeof steps)[]) steps[key] /= 2;
          if (steps.cx < 0.4) break;
        }
      }
      if (score >= GOOD && score > before * GAIN) {
        // Back to a bounding box + tilt.
        const cs = Math.abs(Math.cos(p.a));
        const sn = Math.abs(Math.sin(p.a));
        const BW = p.w * cs + p.h * sn;
        const BH = p.w * sn + p.h * cs;
        o.box_2d = [((p.cy - BH / 2) / H) * 1000, ((p.cx - BW / 2) / W) * 1000, ((p.cy + BH / 2) / H) * 1000, ((p.cx + BW / 2) / W) * 1000];
        o.angleDeg = Math.round(((p.a * 180) / Math.PI) * 10) / 10;
        moved.push({ id: o.id, by: Math.hypot(p.cx - start.cx, p.cy - start.cy) });
      }
    } else if (o.kind === 'surface' && Array.isArray(o.points) && o.points.length >= 2) {
      const pts = o.points.map(px);
      const lineScore = () => {
        let t = 0;
        for (let i = 1; i < pts.length; i++) t += segScore(m, pts[i - 1]!.x, pts[i - 1]!.y, pts[i]!.x, pts[i]!.y);
        return t / (pts.length - 1);
      };
      const before = lineScore();
      const orig = pts.map((p) => ({ ...p }));
      const local = (i: number) => {
        let t = 0;
        if (i > 0) t += segScore(m, pts[i - 1]!.x, pts[i - 1]!.y, pts[i]!.x, pts[i]!.y);
        if (i < pts.length - 1) t += segScore(m, pts[i]!.x, pts[i]!.y, pts[i + 1]!.x, pts[i + 1]!.y);
        return t;
      };
      const reach = Math.min(W, H) * 0.035;
      // A closed outline repeats its first corner at the end; move the two together.
      const closed = pts.length > 3 && Math.hypot(pts[0]!.x - pts.at(-1)!.x, pts[0]!.y - pts.at(-1)!.y) < 2;
      const last = pts.length - 1;
      for (let sweep = 0; sweep < 3; sweep++) {
        for (let i = 0; i < (closed ? last : pts.length); i++) {
          const p = pts[i]!;
          const score = () => local(i) + (closed && i === 0 ? local(last) : 0);
          let best = { x: p.x, y: p.y, s: score() };
          // An open end may only move sideways to its line: sliding along it would
          // shorten the line (a shorter line can look darker on average).
          const end = !closed && (i === 0 || i === last);
          const nb = end ? pts[i === 0 ? 1 : last - 1]! : null;
          const len = nb ? Math.hypot(nb.x - p.x, nb.y - p.y) || 1 : 1;
          const nx = nb ? -(nb.y - p.y) / len : 0;
          const ny = nb ? (nb.x - p.x) / len : 0;
          const span = sweep === 0 ? reach : reach / 4;
          const step = sweep === 0 ? reach / 6 : 1;
          const tries: [number, number][] = [];
          if (end) for (let d = -span; d <= span; d += step) tries.push([nx * d, ny * d]);
          else for (let dy = -span; dy <= span; dy += step) for (let dx = -span; dx <= span; dx += step) tries.push([dx, dy]);
          for (const [dx, dy] of tries) {
            pts[i] = { x: p.x + dx, y: p.y + dy };
            if (closed && i === 0) pts[last] = pts[i]!;
            const s = score();
            if (s > best.s) best = { x: p.x + dx, y: p.y + dy, s };
          }
          pts[i] = { x: best.x, y: best.y };
          if (closed && i === 0) pts[last] = pts[i]!;
        }
      }
      const after = lineScore();
      if (after >= GOOD && after > before * GAIN) {
        o.points = pts.map((p) => yx(p.x, p.y));
        moved.push({ id: o.id, by: Math.max(...pts.map((p, i) => Math.hypot(p.x - orig[i]!.x, p.y - orig[i]!.y))) });
      }
    }
  }

  // Ropes and rods: snap the fixed end to the drawn line (it sets the pendulum length).
  for (const l of r.links) {
    if (l.kind !== 'rope' && l.kind !== 'rod') continue;
    if (!Array.isArray(l.fromPoint) || !Array.isArray(l.toPoint)) continue;
    const a = px(l.fromPoint);
    const b = px(l.toPoint);
    const before = segScore(m, a.x, a.y, b.x, b.y);
    let best = { x: a.x, y: a.y, s: before };
    const span = Math.min(W, H) * 0.03;
    for (let dy = -span; dy <= span; dy += 1)
      for (let dx = -span; dx <= span; dx += 1) {
        const s = segScore(m, a.x + dx, a.y + dy, b.x, b.y);
        if (s > best.s) best = { x: a.x + dx, y: a.y + dy, s };
      }
    if (best.s >= GOOD && best.s > before * GAIN) l.fromPoint = yx(best.x, best.y);
  }

  return { reading: r, moved: moved.filter((x) => x.by > 0.5) };
}
