import type { Body, P } from './types.ts';

export const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

/** Closest point on segment ab to p, and the parameter t along it. */
export function closestOnSegment(p: P, a: P, b: P): { q: P; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { q: { x: a.x + t * dx, y: a.y + t * dy }, t };
}

/** Corners of a box body, in image pixels (angle is counterclockwise as seen). */
export function boxCorners(b: Pick<Body, 'x' | 'y' | 'w' | 'h' | 'angle'>): P[] {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const hw = b.w / 2;
  const hh = b.h / 2;
  // Screen y points down, so a counterclockwise turn as seen uses -s for y.
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([u, v]) => ({ x: b.x + u! * c + v! * s, y: b.y - u! * s + v! * c }));
}

/**
 * Size of a tilted rectangle from its axis-aligned bounding box.
 * W = w|cos| + h|sin|, H = w|sin| + h|cos|. Near 45° this has no stable
 * answer, so we assume a square.
 */
export function sizeFromBounds(W: number, H: number, angle: number): { w: number; h: number } {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const det = c * c - s * s;
  if (Math.abs(det) > 0.25) {
    const w = (W * c - H * s) / det;
    const h = (H * c - W * s) / det;
    if (w > 2 && h > 2) return { w, h };
  }
  const side = (W + H) / (2 * (c + s));
  return { w: side, h: side };
}

/** Point inside a box closest to p (for spring and rope ends). */
export function clampToBox(p: P, b: Pick<Body, 'x' | 'y' | 'w' | 'h' | 'angle'>): P {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const dx = p.x - b.x;
  const dy = p.y - b.y;
  // Into box axes (inverse of boxCorners' mapping).
  let u = dx * c - dy * s;
  let v = dx * s + dy * c;
  u = Math.max(-b.w / 2, Math.min(b.w / 2, u));
  v = Math.max(-b.h / 2, Math.min(b.h / 2, v));
  return { x: b.x + u * c + v * s, y: b.y - u * s + v * c };
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function pointInPolygon(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
