/**
 * A doodle described in paper pixels. The renderer draws it like a pencil
 * sketch; truthOf() turns it into the Reading we expect the AI to return.
 */
import type { Reading, ReadObject, YX } from '../../src/read/schema.ts';

export type XY = [number, number];

export interface DBall {
  kind: 'ball';
  id: string;
  c: XY;
  r: number;
  fixed?: boolean;
}
export interface DBox {
  kind: 'box';
  id: string;
  c: XY;
  w: number;
  h: number;
  /** Degrees, counterclockwise as seen. */
  angle: number;
  fixed?: boolean;
}
export interface DSurface {
  kind: 'surface';
  id: string;
  pts: XY[];
  /** Draw hatching on this side of the line (+1 = right of travel direction, -1 = left). */
  hatch?: 1 | -1;
}
export interface DAnchor {
  kind: 'anchor';
  id: string;
  c: XY;
}
export type DShape = DBall | DBox | DSurface | DAnchor;

export interface DLabel {
  on: string;
  text: string;
  at: XY;
  massKg?: number;
  friction?: number;
  bounce?: number;
}
export interface DArrow {
  on: string;
  tip: XY;
  speed: number;
  text?: string;
  textAt?: XY;
}
export interface DLink {
  kind: 'rope' | 'rod' | 'spring' | 'pin';
  from: string;
  fromP: XY;
  to: string;
  toP: XY;
  k?: number;
  text?: string;
  textAt?: XY;
}
export interface DMeasure {
  a: XY;
  b: XY;
  meters: number;
  text: string;
  /** Offset of the dimension line from the measured edge, in px. */
  offset: XY;
}
export interface DExtra {
  /** Free strokes that are not part of the physics (scribbles, house, list). */
  lines?: XY[][];
  circles?: { c: XY; r: number }[];
  texts?: { at: XY; text: string; size?: number }[];
  /** Shapes drawn then scribbled out: drawn, but not in the truth. */
  crossed?: DShape[];
}

export interface Doodle {
  id: string;
  title: string;
  /** What this case is meant to test. */
  tests: string;
  physics: boolean;
  /** Hard cases are expected to fail sometimes; reported separately. */
  hard?: boolean;
  shapes: DShape[];
  labels: DLabel[];
  arrows: DArrow[];
  links: DLink[];
  measures: DMeasure[];
  extra?: DExtra;
  style: Style;
}

export interface Style {
  paper: 'plain' | 'grid' | 'ruled' | 'cream';
  ink: 'pencil' | 'pen' | 'faint';
  font: string;
  /** Photo: rotation in degrees, scale, offsets as share of frame. */
  rot: number;
  scale: number;
  dx: number;
  dy: number;
  light: number;
  blur: number;
  portrait?: boolean;
  /** Draw on screen instead of photographing paper: no desk, no lighting. */
  screen?: boolean;
}

export const PAPER_W = 1200;
export const PAPER_H = 900;

/** Affine map from paper px to output image px. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}
export const apply = (m: Affine, p: XY): XY => [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];

export function photoTransform(s: Style, W: number, H: number): Affine {
  if (s.screen) {
    const k = Math.min(W / PAPER_W, H / PAPER_H);
    return { a: k, b: 0, c: 0, d: k, e: (W - PAPER_W * k) / 2, f: (H - PAPER_H * k) / 2 };
  }
  const t = (s.rot * Math.PI) / 180;
  const fit = Math.min(W / PAPER_W, H / PAPER_H) * s.scale;
  const cos = Math.cos(t) * fit;
  const sin = Math.sin(t) * fit;
  const cx = W / 2 + s.dx * W;
  const cy = H / 2 + s.dy * H;
  // Rotate about the paper centre, then move it to (cx, cy). Screen rotation: positive = clockwise as seen.
  return { a: cos, b: sin, c: -sin, d: cos, e: cx - (cos * PAPER_W) / 2 + (sin * PAPER_H) / 2, f: cy - (sin * PAPER_W) / 2 - (cos * PAPER_H) / 2 };
}

export function frameSize(s: Style): [number, number] {
  return s.portrait ? [960, 1280] : [1280, 960];
}

const yx = (p: XY, W: number, H: number): YX => [Math.round((p[1] / H) * 1000), Math.round((p[0] / W) * 1000)];

export function boxCornersXY(b: DBox): XY[] {
  const t = (b.angle * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    [-b.w / 2, -b.h / 2],
    [b.w / 2, -b.h / 2],
    [b.w / 2, b.h / 2],
    [-b.w / 2, b.h / 2],
  ].map(([u, v]) => [b.c[0] + u! * c + v! * s, b.c[1] - u! * s + v! * c] as XY);
}

/** The Reading a perfect reader would return for this doodle, in output-image coordinates. */
export function truthOf(d: Doodle): Reading {
  const [W, H] = frameSize(d.style);
  const m = photoTransform(d.style, W, H);
  const P = (p: XY) => yx(apply(m, p), W, H);
  const rot = d.style.screen ? 0 : -d.style.rot; // photo rotation is clockwise as seen
  if (!d.physics) return { isPhysicsSketch: false, whatIsIt: d.title, objects: [], links: [], measurements: [], unreadable: [] };
  const objects: ReadObject[] = d.shapes.map((s) => {
    const labels = d.labels.filter((l) => l.on === s.id);
    const label = labels.map((l) => l.text).join(', ');
    const o: ReadObject = { id: s.id, kind: s.kind, label };
    if (s.kind === 'surface') o.points = s.pts.map(P);
    else {
      const pts: XY[] =
        s.kind === 'box'
          ? boxCornersXY(s).map((p) => apply(m, p))
          : s.kind === 'ball'
            ? [0, 1, 2, 3].map((i) => apply(m, [s.c[0] + s.r * Math.cos((i * Math.PI) / 2), s.c[1] + s.r * Math.sin((i * Math.PI) / 2)]))
            : [apply(m, s.c)];
      let x0 = Math.min(...pts.map((p) => p[0]));
      let x1 = Math.max(...pts.map((p) => p[0]));
      let y0 = Math.min(...pts.map((p) => p[1]));
      let y1 = Math.max(...pts.map((p) => p[1]));
      if (s.kind === 'ball') {
        // A rotated circle's bounding box is still a square around its centre.
        const c = apply(m, s.c);
        const r = s.r * Math.hypot(m.a, m.b);
        [x0, x1, y0, y1] = [c[0] - r, c[0] + r, c[1] - r, c[1] + r];
      }
      if (s.kind === 'anchor') [x0, x1, y0, y1] = [x0 - 6, x1 + 6, y0 - 6, y1 + 6];
      o.box_2d = [Math.round((y0 / H) * 1000), Math.round((x0 / W) * 1000), Math.round((y1 / H) * 1000), Math.round((x1 / W) * 1000)];
      if (s.kind === 'box') o.angleDeg = Math.round((s.angle + rot) * 10) / 10;
      if ((s.kind === 'ball' || s.kind === 'box') && s.fixed) o.fixed = true;
      const mass = labels.find((l) => l.massKg !== undefined)?.massKg;
      if (mass !== undefined) o.massKg = mass;
      const fr = labels.find((l) => l.friction !== undefined)?.friction;
      if (fr !== undefined) o.friction = fr;
      const bo = labels.find((l) => l.bounce !== undefined)?.bounce;
      if (bo !== undefined) o.bounce = bo;
      const arrow = d.arrows.find((a) => a.on === s.id);
      if (arrow) o.arrow = { tip: P(arrow.tip), speedMps: arrow.text ? arrow.speed : -1 };
    }
    return o;
  });
  return {
    isPhysicsSketch: true,
    whatIsIt: d.title,
    objects,
    links: d.links.map((l) => ({ kind: l.kind, from: l.from, fromPoint: P(l.fromP), to: l.to, toPoint: P(l.toP), stiffnessNpm: l.k ?? -1, label: l.text ?? '' })),
    measurements: d.measures.map((x) => ({ from: P(x.a), to: P(x.b), meters: x.meters, label: x.text })),
    unreadable: [],
  };
}
