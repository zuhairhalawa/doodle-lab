/**
 * Compares what the AI read with what was drawn. Three levels:
 * 1. Detection: physics drawing or not.
 * 2. Reading: every object found (and nothing invented), positions, labels, links, scale.
 * 3. Outcome: run both scenes in the engine and check they end up the same.
 */
import type { Reading, ReadObject, YX } from '../src/read/schema.ts';
import { validate } from '../src/scene/validate.ts';
import { buildSim } from '../src/sim/world.ts';

export interface CaseScore {
  detectionOk: boolean;
  objects: { expected: number; found: number; extra: number; missing: string[]; invented: string[] };
  /** Mean centre error of matched balls and boxes, in 1/1000 of the image. */
  positionError: number | null;
  /** Mean relative radius error of matched balls. */
  radiusError: number | null;
  /** Mean tilt error of matched boxes, degrees. */
  angleError: number | null;
  surfaces: { expected: number; matched: number; extra: number };
  labels: { expected: number; correct: number; wrong: string[] };
  links: { expected: number; correct: number; wrong: string[] };
  scale: { expected: boolean; ok: boolean; ratio: number | null };
  outcome: { ok: boolean; error: number | null; note: string };
  pass: boolean;
  reasons: string[];
}

type Pt = { x: number; y: number };
const centre = (o: ReadObject): Pt | null => {
  const b = o.box_2d;
  if (!Array.isArray(b) || b.length !== 4) {
    const pts = o.points ?? [];
    if (!pts.length) return null;
    return { x: pts.reduce((s, p) => s + p[1], 0) / pts.length, y: pts.reduce((s, p) => s + p[0], 0) / pts.length };
  }
  return { x: (b[1] + b[3]) / 2, y: (b[0] + b[2]) / 2 };
};
const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const yxPt = (p: YX): Pt => ({ x: p[1], y: p[0] });

function densify(pts: YX[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = yxPt(pts[i - 1]!);
    const b = yxPt(pts[i]!);
    const n = Math.max(1, Math.ceil(d(a, b) / 10));
    for (let k = 0; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  if (pts.length === 1) out.push(yxPt(pts[0]!));
  return out;
}
function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return d(p, { x: a.x + t * dx, y: a.y + t * dy });
}
/** Mean distance from the points of one line to the nearest of a set of lines. */
function lineDistance(line: YX[], others: YX[][]): number {
  const pts = densify(line);
  const segs = others.flatMap((o) => o.slice(1).map((p, i) => [yxPt(o[i]!), yxPt(p)] as const));
  if (!segs.length) return Infinity;
  return pts.reduce((s, p) => s + Math.min(...segs.map(([a, b]) => segDist(p, a, b))), 0) / pts.length;
}

const near = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= Math.max(tol * Math.abs(b), 1e-9);

/** Match tolerance for object centres, in 1/1000 of the image. */
const MATCH = 60;
const SURFACE_MATCH = 20;

/** Chaotic scenes (a toppling tower, a double pendulum) are compared over a shorter run. */
export const horizonFor = (id: string) => (/^(stack|double_pendulum|hard-portrait)/.test(id) ? 0.4 : 1.5);

export function scoreCase(truth: Reading, read: Reading | null, width: number, height: number, horizon = 1.5): CaseScore {
  const reasons: string[] = [];
  const s: CaseScore = {
    detectionOk: !!read && read.isPhysicsSketch === truth.isPhysicsSketch,
    objects: { expected: 0, found: 0, extra: 0, missing: [], invented: [] },
    positionError: null,
    radiusError: null,
    angleError: null,
    surfaces: { expected: 0, matched: 0, extra: 0 },
    labels: { expected: 0, correct: 0, wrong: [] },
    links: { expected: 0, correct: 0, wrong: [] },
    scale: { expected: truth.measurements.length > 0, ok: true, ratio: null },
    outcome: { ok: true, error: null, note: '' },
    pass: false,
    reasons,
  };
  if (!read) {
    reasons.push('no answer');
    return s;
  }
  if (!s.detectionOk) reasons.push(truth.isPhysicsSketch ? 'said it was not a physics drawing' : `invented a physics scene (${read.objects?.length ?? 0} objects)`);
  if (!truth.isPhysicsSketch) {
    s.pass = s.detectionOk;
    return s;
  }
  const readObjs = Array.isArray(read.objects) ? read.objects : [];

  // ---- Bodies: match by kind and centre ----
  const tBodies = truth.objects.filter((o) => o.kind === 'ball' || o.kind === 'box');
  const rBodies = readObjs.filter((o) => o.kind === 'ball' || o.kind === 'box');
  const used = new Set<ReadObject>();
  const matched = new Map<string, ReadObject>();
  const pairs: { t: ReadObject; r: ReadObject; dist: number }[] = [];
  for (const t of tBodies) {
    for (const r of rBodies) {
      if (r.kind !== t.kind) continue;
      const ct = centre(t);
      const cr = centre(r);
      if (ct && cr) pairs.push({ t, r, dist: d(ct, cr) });
    }
  }
  pairs.sort((a, b) => a.dist - b.dist);
  for (const p of pairs) {
    if (p.dist > MATCH || matched.has(p.t.id) || used.has(p.r)) continue;
    matched.set(p.t.id, p.r);
    used.add(p.r);
  }
  s.objects.expected = tBodies.length;
  s.objects.found = matched.size;
  s.objects.missing = tBodies.filter((t) => !matched.has(t.id)).map((t) => t.id);
  s.objects.invented = rBodies.filter((r) => !used.has(r)).map((r) => `${r.kind} ${r.id}`);
  s.objects.extra = s.objects.invented.length;
  if (s.objects.missing.length) reasons.push(`missed ${s.objects.missing.join(', ')}`);
  if (s.objects.extra) reasons.push(`invented ${s.objects.invented.join(', ')}`);

  const posErr: number[] = [];
  const radErr: number[] = [];
  const angErr: number[] = [];
  for (const t of tBodies) {
    const r = matched.get(t.id);
    if (!r) continue;
    posErr.push(d(centre(t)!, centre(r)!));
    if (t.kind === 'ball' && r.box_2d) {
      const rt = (t.box_2d![2] - t.box_2d![0] + t.box_2d![3] - t.box_2d![1]) / 4;
      const rr = (r.box_2d[2] - r.box_2d[0] + r.box_2d[3] - r.box_2d[1]) / 4;
      radErr.push(Math.abs(rr - rt) / rt);
    }
    if (t.kind === 'box') {
      let e = Math.abs((r.angleDeg ?? 0) - (t.angleDeg ?? 0)) % 180;
      if (e > 90) e = 180 - e;
      angErr.push(e);
    }
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  s.positionError = mean(posErr);
  s.radiusError = mean(radErr);
  s.angleError = mean(angErr);
  if (s.angleError !== null && s.angleError > 8) reasons.push(`box tilt off by ${s.angleError.toFixed(0)}°`);

  // ---- Surfaces: every drawn line is covered by some read line ----
  const tSurf = truth.objects.filter((o) => o.kind === 'surface');
  const rSurf = readObjs.filter((o) => o.kind === 'surface' && Array.isArray(o.points) && o.points.length >= 2);
  s.surfaces.expected = tSurf.length;
  for (const t of tSurf) {
    const dist = lineDistance(t.points!, rSurf.map((r) => r.points!));
    if (dist <= SURFACE_MATCH) s.surfaces.matched++;
    else reasons.push(`surface ${t.id} ${Number.isFinite(dist) ? `off by ${dist.toFixed(0)}` : 'missing'}`);
  }
  s.surfaces.extra = rSurf.filter((r) => lineDistance(r.points!, tSurf.map((t) => t.points!)) > SURFACE_MATCH * 2).length;
  if (s.surfaces.extra) reasons.push(`${s.surfaces.extra} extra surface(s)`);

  // ---- Labels: mass, friction, bounce, arrow speed ----
  for (const t of tBodies) {
    const r = matched.get(t.id);
    const check = (what: string, want: number | undefined, got: number | undefined, unset: number) => {
      if (want === undefined) return;
      s.labels.expected++;
      if (r && got !== undefined && got !== unset && near(got, want)) s.labels.correct++;
      else s.labels.wrong.push(`${t.id} ${what}: wanted ${want}, read ${got ?? 'nothing'}`);
    };
    check('mass', t.massKg, r?.massKg, 0);
    // A friction value may be read as the block's or as the surface's: both run the same.
    const surfaceMu = readObjs.find((o) => o.kind === 'surface' && o.friction !== undefined && t.friction !== undefined && near(o.friction, t.friction))?.friction;
    check('friction', t.friction, r?.friction !== undefined && r.friction >= 0 ? r.friction : surfaceMu, -1);
    check('bounce', t.bounce, r?.bounce, -1);
    if (t.arrow) {
      s.labels.expected++;
      const ra = r?.arrow;
      const ct = centre(t)!;
      const angT = Math.atan2(t.arrow.tip[0] - ct.y, t.arrow.tip[1] - ct.x);
      const cr = r ? centre(r) : null;
      const angR = ra && cr ? Math.atan2(ra.tip[0] - cr.y, ra.tip[1] - cr.x) : NaN;
      let dA = Math.abs(angT - angR);
      if (dA > Math.PI) dA = 2 * Math.PI - dA;
      const speedOk = t.arrow.speedMps < 0 ? true : !!ra && near(ra.speedMps, t.arrow.speedMps);
      if (ra && dA < (20 * Math.PI) / 180 && speedOk) s.labels.correct++;
      else s.labels.wrong.push(`${t.id} arrow: wanted ${t.arrow.speedMps} m/s at ${Math.round((-angT * 180) / Math.PI)}°, read ${ra ? `${ra.speedMps} m/s at ${Math.round((-angR * 180) / Math.PI)}°` : 'nothing'}`);
    }
  }
  if (s.labels.wrong.length) reasons.push(...s.labels.wrong);

  // ---- Links: kind (rope = rod) and the moving end on the right object ----
  const readLinks = Array.isArray(read.links) ? read.links : [];
  const findRead = (id: string) => matched.get(id);
  const usedLinks = new Set<number>();
  const kindOk = (a: string, b: string) => a === b || (a !== 'spring' && a !== 'pin' && b !== 'spring' && b !== 'pin');
  for (const t of truth.links) {
    s.links.expected++;
    const toR = findRead(t.to);
    const fromTruthBody = tBodies.find((b) => b.id === t.from);
    const fromR = fromTruthBody ? findRead(fromTruthBody.id) : null;
    const idx = readLinks.findIndex((l, i) => {
      if (usedLinks.has(i) || !kindOk(l.kind, t.kind) || !toR) return false;
      const ends = [l.from, l.to];
      if (!ends.includes(toR.id)) return false;
      if (fromR) return ends.includes(fromR.id);
      // Fixed end: the other end must not be a moving body.
      const other = l.from === toR.id ? l.to : l.from;
      return !rBodies.some((b) => b.id === other && b !== toR && !b.fixed);
    });
    if (idx < 0) {
      s.links.wrong.push(`${t.kind} to ${t.to} not found`);
      continue;
    }
    usedLinks.add(idx);
    const l = readLinks[idx]!;
    if (t.kind === 'spring' && t.stiffnessNpm !== undefined && t.stiffnessNpm > 0 && !(l.stiffnessNpm !== undefined && near(l.stiffnessNpm, t.stiffnessNpm))) {
      s.links.wrong.push(`spring k: wanted ${t.stiffnessNpm}, read ${l.stiffnessNpm}`);
      continue;
    }
    s.links.correct++;
  }
  const extraLinks = readLinks.length - usedLinks.size;
  if (extraLinks > 0) s.links.wrong.push(`${extraLinks} extra link(s)`);
  if (s.links.wrong.length) reasons.push(...s.links.wrong);

  // ---- Scale ----
  const tScene = validate(truth, width, height);
  const rScene = validate(read, width, height);
  if (s.scale.expected) {
    s.scale.ratio = rScene.mpp / tScene.mpp;
    s.scale.ok = rScene.scaleFromLabel && Math.abs(s.scale.ratio - 1) < 0.1;
    if (!s.scale.ok) reasons.push(rScene.scaleFromLabel ? `scale off by ${((s.scale.ratio - 1) * 100).toFixed(0)}%` : 'length label not read');
  }

  // ---- Outcome: run both and compare where the matched bodies end up ----
  if (rScene.runnable && tScene.runnable) {
    const simT = buildSim(tScene, { pageFloor: true });
    const simR = buildSim(rScene, { pageFloor: true });
    simT.step(horizon);
    simR.step(horizon);
    const errs: number[] = [];
    for (const t of tBodies) {
      const r = matched.get(t.id);
      if (!r) continue;
      // Validation may rename duplicate ids; look bodies up by the validated id order.
      const tb = simT.bodies.get(t.id);
      const rb = simR.bodies.get(r.id) ?? simR.bodies.get(String(r.id).trim().replace(/\s+/g, ''));
      if (!tb || !rb) continue;
      const pt = simT.toImage(tb.getPosition());
      const pr = simR.toImage(rb.getPosition());
      errs.push(Math.hypot(((pt.x - pr.x) / width) * 1000, ((pt.y - pr.y) / height) * 1000));
    }
    s.outcome.error = mean(errs);
    // Same outcome: every matched body within 8% of the image of where the drawn scene puts it.
    s.outcome.ok = errs.length > 0 && Math.max(...errs) <= 80 && s.objects.missing.length === 0;
    if (!s.outcome.ok && errs.length) {
      s.outcome.note = `bodies end ${Math.max(...errs).toFixed(0)}/1000 apart after ${horizon} s`;
      reasons.push(s.outcome.note);
    }
  } else {
    s.outcome.ok = false;
    s.outcome.note = rScene.runnable ? 'drawn scene cannot run' : 'read scene cannot run';
    reasons.push(s.outcome.note);
  }

  s.pass =
    s.detectionOk &&
    s.objects.missing.length === 0 &&
    s.objects.extra === 0 &&
    s.surfaces.matched === s.surfaces.expected &&
    s.labels.correct === s.labels.expected &&
    s.links.correct === s.links.expected &&
    s.scale.ok &&
    s.outcome.ok;
  return s;
}
