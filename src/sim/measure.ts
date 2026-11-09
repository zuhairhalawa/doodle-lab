/**
 * Measurements taken from the running engine, and the textbook formulas the
 * student can compare them with.
 */
import { Vec2 } from 'planck';
import type { Scene } from '../scene/types.ts';
import { G, type Sim } from './world.ts';

export interface Sample {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
}

export interface Energy {
  kinetic: number;
  potential: number;
  spring: number;
}

export function sample(sim: Sim, id: string): Sample | null {
  const b = sim.bodies.get(id);
  if (!b || !b.isDynamic()) return null;
  const p = b.getPosition();
  const v = b.getLinearVelocity();
  return { t: sim.time, x: p.x, y: p.y, vx: v.x, vy: v.y, angle: b.getAngle() };
}

/** Kinetic, gravitational (above y = 0, the bottom of the photo) and spring energy, in joules. */
export function energy(sim: Sim): Energy {
  let kinetic = 0;
  let potential = 0;
  for (const b of sim.bodies.values()) {
    if (!b.isDynamic()) continue;
    const m = b.getMass();
    const v = b.getLinearVelocity();
    const w = b.getAngularVelocity();
    kinetic += 0.5 * m * Vec2.lengthSquared(v) + 0.5 * b.getInertia() * w * w;
    // getInertia is about the body origin; ours are centred so this is the centroid inertia.
    potential += m * G * b.getWorldCenter().y;
  }
  let spring = 0;
  for (const j of sim.scene.joints) {
    if (j.kind !== 'spring') continue;
    const b = sim.bodies.get(j.b);
    if (!b) continue;
    const a = j.a ? sim.bodies.get(j.a) : null;
    const rest = Vec2.distance(sim.toWorld(j.aPoint), sim.toWorld(j.bPoint)) * j.restScale;
    const pa = a ? a.getWorldPoint(localAnchors(sim, j).a) : sim.toWorld(j.aPoint);
    const pb = b.getWorldPoint(localAnchors(sim, j).b);
    const stretch = Vec2.distance(pa, pb) - rest;
    spring += 0.5 * j.stiffness * stretch * stretch;
  }
  return { kinetic, potential, spring };
}

/** Local anchors are fixed at build time; recompute them from the scene's starting pose. */
const anchorCache = new WeakMap<object, { a: Vec2; b: Vec2 }>();
function localAnchors(sim: Sim, j: Scene['joints'][number]) {
  let c = anchorCache.get(j);
  if (!c) {
    const sb = sim.scene.bodies.find((x) => x.id === j.b)!;
    const sa = j.a ? sim.scene.bodies.find((x) => x.id === j.a) : null;
    const local = (body: { x: number; y: number; angle: number }, p: { x: number; y: number }) => {
      const o = sim.toWorld(body);
      const w = sim.toWorld(p);
      const dx = w.x - o.x;
      const dy = w.y - o.y;
      const c0 = Math.cos(body.angle);
      const s0 = Math.sin(body.angle);
      return new Vec2(dx * c0 + dy * s0, -dx * s0 + dy * c0);
    };
    c = { a: sa ? local(sa, j.aPoint) : sim.toWorld(j.aPoint), b: local(sb, j.bPoint) };
    anchorCache.set(j, c);
  }
  return c;
}

/**
 * Period of an oscillation from samples: the time between every other
 * sign change of the velocity component that swings the most.
 * Returns null until at least one full period has been seen.
 */
export function periodFrom(samples: Sample[]): number | null {
  if (samples.length < 8) return null;
  const spread = (k: 'vx' | 'vy') => Math.max(...samples.map((s) => Math.abs(s[k])));
  const key = spread('vx') >= spread('vy') ? 'vx' : 'vy';
  const crossings: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]![key];
    const b = samples[i]![key];
    if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) {
      // Linear interpolation for the crossing time.
      const t = samples[i - 1]!.t + ((samples[i]!.t - samples[i - 1]!.t) * Math.abs(a)) / (Math.abs(a) + Math.abs(b) || 1);
      crossings.push(t);
    }
  }
  if (crossings.length < 3) return null;
  const periods: number[] = [];
  for (let i = 2; i < crossings.length; i++) periods.push(crossings[i]! - crossings[i - 2]!);
  return periods.reduce((s, p) => s + p, 0) / periods.length;
}

export interface FormulaCheck {
  id: string;
  kind: 'pendulum' | 'spring';
  title: string;
  formula: string;
  predicted: number;
  detail: string;
}

/**
 * Textbook formulas for the simple cases the drawing contains: a single bob
 * on a rope or rod from a fixed point, or a mass on a spring from a fixed point.
 */
export function formulaChecks(scene: Scene): FormulaCheck[] {
  const out: FormulaCheck[] = [];
  for (const j of scene.joints) {
    if (j.a !== null) continue;
    const b = scene.bodies.find((x) => x.id === j.b);
    if (!b || !b.dynamic) continue;
    // Only when this body has exactly one link and nothing hangs from it.
    if (scene.joints.filter((k) => k.b === b.id || k.a === b.id).length !== 1) continue;
    if (j.kind === 'rope' || j.kind === 'rod') {
      const L = Math.hypot(j.aPoint.x - b.x, j.aPoint.y - b.y) * scene.mpp;
      const theta = Math.abs(Math.atan2(b.x - j.aPoint.x, b.y - j.aPoint.y));
      const T0 = 2 * Math.PI * Math.sqrt(L / G);
      const T = T0 * (1 + (theta * theta) / 16 + (11 * theta ** 4) / 3072);
      out.push({
        id: b.id,
        kind: 'pendulum',
        title: `${b.id} swings like a pendulum`,
        formula: 'T = 2π√(L/g)',
        predicted: T,
        detail: `L = ${L.toFixed(2)} m, released ${Math.round((theta * 180) / Math.PI)}° from straight down. Small-angle formula ${T0.toFixed(2)} s; with the large-angle correction ${T.toFixed(2)} s.`,
      });
    } else if (j.kind === 'spring') {
      const T = 2 * Math.PI * Math.sqrt(b.massKg / j.stiffness);
      out.push({
        id: b.id,
        kind: 'spring',
        title: `${b.id} bounces on a spring`,
        formula: 'T = 2π√(m/k)',
        predicted: T,
        detail: `m = ${b.massKg} kg, k = ${j.stiffness} N/m.`,
      });
    }
  }
  return out;
}

/** True once every moving body has been nearly still for `hold` seconds. */
export class RestWatch {
  private still = 0;
  constructor(private readonly hold = 0.6) {}
  update(sim: Sim, dt: number): boolean {
    let moving = false;
    for (const b of sim.bodies.values()) {
      if (!b.isDynamic()) continue;
      if (Vec2.lengthSquared(b.getLinearVelocity()) > 0.02 * 0.02 || Math.abs(b.getAngularVelocity()) > 0.05) moving = true;
    }
    this.still = moving ? 0 : this.still + dt;
    return this.still >= this.hold;
  }
}
