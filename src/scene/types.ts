import type { LinkKind } from '../read/schema.ts';

/** A point in image pixels, y down. */
export interface P {
  x: number;
  y: number;
}

export type BodyKind = 'ball' | 'box' | 'surface' | 'anchor';

/** One checked object, in image pixels. Velocities are in m/s with y up. */
export interface Body {
  id: string;
  kind: BodyKind;
  dynamic: boolean;
  /** Centre (ball, box, anchor), after the checker moved it out of overlaps. */
  x: number;
  y: number;
  /** Centre where it is drawn on the photo (before the checker moved it). */
  drawnX: number;
  drawnY: number;
  /** Ball radius. */
  r: number;
  /** Box size and tilt (radians, counterclockwise as seen). */
  w: number;
  h: number;
  angle: number;
  /** Surface line. */
  points: P[];
  label: string;
  massKg: number;
  massFromLabel: boolean;
  friction: number;
  frictionFromLabel: boolean;
  bounce: number;
  bounceFromLabel: boolean;
  /** Starting velocity in m/s, x right, y up. */
  vx: number;
  vy: number;
  hasArrow: boolean;
  speedFromLabel: boolean;
}

export interface Joint {
  kind: LinkKind;
  /** Body id, or null for a fixed point on the page. */
  a: string | null;
  aPoint: P;
  b: string;
  bPoint: P;
  /** Spring constant in N/m (springs only). */
  stiffness: number;
  stiffnessFromLabel: boolean;
  /** Spring rest length as a share of the drawn length (1 = as drawn). */
  restScale: number;
}

/**
 * What the checker did to the AI reading, in words a student can follow.
 * fixed = we corrected something, assumed = we filled in a missing value,
 * dropped = we left something out, problem = the drawing cannot run.
 */
export interface Note {
  level: 'fixed' | 'assumed' | 'dropped' | 'problem';
  text: string;
  id?: string;
}

export interface Scene {
  width: number;
  height: number;
  /** Meters per image pixel. */
  mpp: number;
  scaleFromLabel: boolean;
  whatIsIt: string;
  bodies: Body[];
  joints: Joint[];
  notes: Note[];
  /** False when nothing can run (not a physics drawing, or nothing can move). */
  runnable: boolean;
}

export const DEFAULTS = {
  massKg: 1,
  friction: 0.4,
  bounce: 0.25,
  speedMps: 2,
  stiffnessNpm: 40,
  /** Without a measurement, the image is this many meters wide. */
  widthMeters: 2,
};
