/**
 * What the vision model returns for one drawing. Coordinates use the
 * convention Gemini is trained on: 0–1000 across the image, points as [y, x]
 * and boxes as [ymin, xmin, ymax, xmax]. Nothing here is trusted until
 * src/scene/validate.ts has checked it.
 */

export type YX = [number, number];
export type Box2D = [number, number, number, number];

export type ObjectKind = 'ball' | 'box' | 'surface' | 'anchor';
export type LinkKind = 'rope' | 'rod' | 'spring' | 'pin';

export interface ReadObject {
  id: string;
  kind: ObjectKind;
  /** Ball, box or anchor: tight box around the drawn shape. */
  box_2d?: Box2D;
  /** Box only: tilt in degrees, counterclockwise as seen on the page; 0 = level. */
  angleDeg?: number;
  /** Surface only: the drawn line in order, at every corner. */
  points?: YX[];
  /** True when the drawing marks a ball or box as fixed in place (hatching, nail, "fixed"). */
  fixed?: boolean;
  /** Exact text written next to it, or "". */
  label: string;
  /** Mass from the label, 0 when no mass is written. */
  massKg?: number;
  /** Friction coefficient from the label, -1 when none is written. */
  friction?: number;
  /** Coefficient of restitution from the label, -1 when none is written. */
  bounce?: number;
  /** An arrow drawn from the object: where its tip is, and the speed written on it (-1 if none). */
  arrow?: { tip: YX; speedMps: number };
}

export interface ReadLink {
  kind: LinkKind;
  /** Object id the link starts on, or "" when it starts on a fixed point (ceiling, nail, wall). */
  from: string;
  fromPoint: YX;
  /** Object id the link ends on. */
  to: string;
  toPoint: YX;
  /** Spring constant from the label, -1 when none is written. */
  stiffnessNpm?: number;
  label?: string;
}

export interface ReadMeasurement {
  from: YX;
  to: YX;
  meters: number;
  label: string;
}

export interface Reading {
  isPhysicsSketch: boolean;
  whatIsIt: string;
  objects: ReadObject[];
  links: ReadLink[];
  measurements: ReadMeasurement[];
  unreadable: string[];
}

/**
 * What the model is asked for: one list per kind, with the geometry each kind
 * needs marked required (the model skips optional position fields otherwise).
 * fromModel() turns it into a Reading.
 */
export interface ModelReading {
  isPhysicsSketch: boolean;
  whatIsIt: string;
  balls: { id: string; box_2d: Box2D; label: string; massKg: number; friction: number; bounce: number; fixed: boolean; arrow?: { tip: YX; speedMps: number } }[];
  boxes: { id: string; box_2d: Box2D; angleDeg: number; label: string; massKg: number; friction: number; bounce: number; fixed: boolean; arrow?: { tip: YX; speedMps: number } }[];
  surfaces: { id: string; points: YX[]; label: string; friction: number }[];
  anchors: { id: string; point: YX }[];
  links: ReadLink[];
  measurements: ReadMeasurement[];
  unreadable: string[];
}

const yx = { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 };
const box2d = { type: 'array', items: { type: 'integer' }, minItems: 4, maxItems: 4, description: '[ymin, xmin, ymax, xmax], 0-1000, tight around the drawn shape.' };
const arrow = {
  type: 'object',
  description: 'Only when an arrow is drawn starting on this object.',
  properties: { tip: yx, speedMps: { type: 'number', description: 'Speed written on the arrow in m/s, or -1.' } },
  required: ['tip', 'speedMps'],
};
const common = {
  label: { type: 'string', description: 'Exact text written next to it, or "".' },
  massKg: { type: 'number', description: 'Mass from the label in kg, or 0.' },
  friction: { type: 'number', description: 'Friction coefficient from the label, or -1.' },
  bounce: { type: 'number', description: 'Coefficient of restitution from the label, or -1.' },
  fixed: { type: 'boolean', description: 'True only when the drawing marks it as fixed in place.' },
  arrow,
};

/** JSON schema handed to Gemini (structured output). */
export const READ_SCHEMA = {
  type: 'object',
  properties: {
    isPhysicsSketch: { type: 'boolean' },
    whatIsIt: { type: 'string', description: 'One plain sentence describing the drawing.' },
    balls: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, box_2d: box2d, ...common }, required: ['id', 'box_2d', 'label', 'massKg', 'friction', 'bounce', 'fixed'] },
    },
    boxes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, box_2d: box2d, angleDeg: { type: 'number', description: 'Tilt, counterclockwise as seen, degrees. 0 = level.' }, ...common },
        required: ['id', 'box_2d', 'angleDeg', 'label', 'massKg', 'friction', 'bounce', 'fixed'],
      },
    },
    surfaces: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          points: { type: 'array', items: yx, minItems: 2, description: '[y, x] points, 0-1000, along the drawn line, one at every corner.' },
          label: { type: 'string' },
          friction: { type: 'number', description: 'Friction coefficient written on this surface (e.g. "μ = 0.2" next to a ramp), or -1.' },
        },
        required: ['id', 'points', 'label', 'friction'],
      },
    },
    anchors: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, point: yx }, required: ['id', 'point'] },
    },
    links: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['rope', 'rod', 'spring', 'pin'] },
          from: { type: 'string', description: 'Ball, box, surface or anchor id where it starts, or "".' },
          fromPoint: yx,
          to: { type: 'string', description: 'Ball or box id where it ends.' },
          toPoint: yx,
          stiffnessNpm: { type: 'number', description: 'Spring constant from the label in N/m, or -1.' },
          label: { type: 'string' },
        },
        required: ['kind', 'from', 'fromPoint', 'to', 'toPoint', 'stiffnessNpm'],
      },
    },
    measurements: {
      type: 'array',
      items: {
        type: 'object',
        properties: { from: yx, to: yx, meters: { type: 'number' }, label: { type: 'string' } },
        required: ['from', 'to', 'meters', 'label'],
      },
    },
    unreadable: { type: 'array', items: { type: 'string' } },
  },
  required: ['isPhysicsSketch', 'whatIsIt', 'balls', 'boxes', 'surfaces', 'anchors', 'links', 'measurements', 'unreadable'],
} as const;

const list = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

/** Flattens the model's per-kind lists into one object list. Tolerates missing fields; validate() checks the rest. */
export function fromModel(m: Partial<ModelReading> | null | undefined): Reading | null {
  if (!m || typeof m !== 'object') return null;
  const objects: ReadObject[] = [
    ...list<ModelReading['balls'][number]>(m.balls).map((b) => ({ ...b, kind: 'ball' as const })),
    ...list<ModelReading['boxes'][number]>(m.boxes).map((b) => ({ ...b, kind: 'box' as const })),
    ...list<ModelReading['surfaces'][number]>(m.surfaces).map((s) => ({ ...s, kind: 'surface' as const })),
    ...list<ModelReading['anchors'][number]>(m.anchors).map((a) => ({
      id: a?.id,
      kind: 'anchor' as const,
      label: '',
      box_2d: Array.isArray(a?.point) && a.point.length === 2 ? ([a.point[0], a.point[1], a.point[0], a.point[1]] as Box2D) : undefined,
    })),
  ];
  return {
    isPhysicsSketch: m.isPhysicsSketch !== false,
    whatIsIt: typeof m.whatIsIt === 'string' ? m.whatIsIt : '',
    objects,
    links: list(m.links),
    measurements: list(m.measurements),
    unreadable: list(m.unreadable),
  };
}

export const READ_SYSTEM = `You read hand-drawn physics diagrams (pencil or pen on paper, or drawn on a screen) and describe them as data so a physics engine can run them. You do not simulate anything yourself. Only describe what is drawn.

Coordinates: 0-1000 across the image. Points are [y, x]. Boxes are [ymin, xmin, ymax, xmax]. y grows downward.

Return one list per kind: balls, boxes, surfaces, anchors. Give every object a short unique id (ball1, block, ramp, floor, wall, ceiling, pivot1).
- "ball": a drawn circle that can move. box_2d is a tight box around the circle.
- "box": a drawn square or rectangle that can move (a block, crate, cart body, plank). box_2d is tight around it. angleDeg is its tilt (counterclockwise as seen; a box resting on a ramp that rises to the right has a positive angle).
- "surface": any fixed line or outline things rest on or hit: floor, ground, wall, ceiling, ramp, slope, ledge, table top, cup or bowl outline, fulcrum triangle. points follows the drawn line with a point at every corner. A triangle ramp is one surface with its 3 corners plus the first corner again. A curve gets enough points (6-12) to follow it. Hatching under a line just marks it as fixed ground; do not report the hatching strokes.
- "anchor": a small fixed point that something hangs from or turns around (a nail, a pivot dot, a hook) when it is not on a drawn surface.
Set fixed=true on a ball or box only when the drawing clearly marks it as fixed (hatching on it, a nail through it, or the word "fixed").

Links:
- "rope" or "rod": a straight line from a fixed point or object to an object (pendulum string, rod). from is the object id it starts on, or "" when it starts on a ceiling, wall or anchor point that is not a separate object; fromPoint and toPoint are its two drawn ends.
- "spring": a zigzag or coil between two things. stiffnessNpm from the label (k = 50 N/m means 50), else -1.
- "pin": an object (usually a plank) that turns around a fixed point, like a seesaw on a fulcrum. from = "", fromPoint = the pivot, to = the plank id, toPoint = the pivot too.

Labels: copy any text written next to an object into its label exactly. A friction value written next to a ramp or floor rather than next to a block belongs to that surface. Fill massKg from a mass ("2 kg" = 2, "500 g" = 0.5), else 0. friction from "μ = 0.3" or "mu = 0.3" or "frictionless" (0), else -1. bounce from "e = 0.8", else -1.
Arrows: an arrow starting on a ball or box shows its starting velocity. Put the arrow tip in arrow.tip and the speed written on it in arrow.speedMps ("4 m/s" = 4), or -1 when no speed is written. Do not make an arrow into an object.
Measurements: a dimension line or label that gives a real length ("1 m", "h = 50 cm", "L = 2 m"): give the two ends of the length it describes and its value in meters.

Ignore scribbled-out or crossed-out shapes, shading, the paper's own grid or ruled lines, and anything outside the paper. Put anything you see but cannot interpret in unreadable, briefly.
If the drawing is not a physics setup (a house, a face, a list, a blank page), set isPhysicsSketch=false and return empty objects and links.
Be precise with positions: the engine will place every object exactly where you say.`;
