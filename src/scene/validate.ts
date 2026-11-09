/**
 * Turns an untrusted AI reading into a scene the physics engine can run.
 * Every correction is written down as a Note so the student can see what the
 * AI read and what the checker changed.
 */
import type { ReadLink, ReadObject, Reading, YX } from '../read/schema.ts';
import { boxCorners, clampToBox, closestOnSegment, dist, median, sizeFromBounds } from './geometry.ts';
import { type Body, DEFAULTS, type Joint, type Note, type P, type Scene } from './types.ts';

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round = (n: number, d = 2) => Number(n.toFixed(d));

export function validate(reading: Partial<Reading> | null | undefined, width: number, height: number): Scene {
  const notes: Note[] = [];
  const scene: Scene = {
    width,
    height,
    mpp: DEFAULTS.widthMeters / width,
    scaleFromLabel: false,
    whatIsIt: typeof reading?.whatIsIt === 'string' ? reading.whatIsIt.slice(0, 300) : '',
    bodies: [],
    joints: [],
    notes,
    runnable: false,
  };
  if (!reading || typeof reading !== 'object') {
    notes.push({ level: 'problem', text: 'The reader sent back nothing usable. Try the photo again.' });
    return scene;
  }
  if (reading.isPhysicsSketch === false) {
    notes.push({ level: 'problem', text: `This doesn't look like a physics drawing${scene.whatIsIt ? ` (it looks like: ${scene.whatIsIt.replace(/\.$/, '')})` : ''}. Draw a ball, a box, a ramp or a pendulum.` });
    return scene;
  }

  const px = (p: unknown): P | null => {
    if (!Array.isArray(p) || p.length !== 2 || !finite(p[0]) || !finite(p[1])) return null;
    const [y, x] = p as YX;
    return { x: (clamp(x, -50, 1050) / 1000) * width, y: (clamp(y, -50, 1050) / 1000) * height };
  };
  const bounds = (o: ReadObject): { x0: number; y0: number; x1: number; y1: number } | null => {
    const b = o.box_2d;
    if (Array.isArray(b) && b.length === 4 && b.every(finite)) {
      const [ymin, xmin, ymax, xmax] = b;
      const x0 = (clamp(Math.min(xmin, xmax), -50, 1050) / 1000) * width;
      const x1 = (clamp(Math.max(xmin, xmax), -50, 1050) / 1000) * width;
      const y0 = (clamp(Math.min(ymin, ymax), -50, 1050) / 1000) * height;
      const y1 = (clamp(Math.max(ymin, ymax), -50, 1050) / 1000) * height;
      return { x0, y0, x1, y1 };
    }
    const pts = (o.points ?? []).map(px).filter((p): p is P => !!p);
    if (pts.length >= 2) {
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
    return null;
  };

  // ---- Objects -------------------------------------------------------------
  const ids = new Set<string>();
  const unique = (raw: string, kind: string) => {
    let base = (raw || kind).trim().replace(/\s+/g, '').slice(0, 24) || kind;
    let id = base;
    for (let i = 2; ids.has(id); i++) id = `${base}_${i}`;
    ids.add(id);
    return id;
  };
  const idMap = new Map<string, string>();
  const minSize = Math.min(width, height) * 0.01;

  for (const o of Array.isArray(reading.objects) ? reading.objects.slice(0, 40) : []) {
    if (!o || typeof o !== 'object') continue;
    const kind = o.kind;
    if (kind !== 'ball' && kind !== 'box' && kind !== 'surface' && kind !== 'anchor') continue;
    const id = unique(String(o.id ?? ''), kind);
    if (typeof o.id === 'string' && !idMap.has(o.id)) idMap.set(o.id, id);
    const label = typeof o.label === 'string' ? o.label.slice(0, 80) : '';
    const body: Body = {
      id,
      kind,
      dynamic: false,
      x: 0,
      y: 0,
      r: 0,
      w: 0,
      h: 0,
      angle: 0,
      points: [],
      label,
      massKg: DEFAULTS.massKg,
      massFromLabel: false,
      friction: DEFAULTS.friction,
      frictionFromLabel: false,
      bounce: DEFAULTS.bounce,
      bounceFromLabel: false,
      vx: 0,
      vy: 0,
      hasArrow: false,
      speedFromLabel: false,
    };

    if (kind === 'surface') {
      let pts = (o.points ?? []).map(px).filter((p): p is P => !!p);
      if (pts.length < 2) {
        const bb = bounds(o);
        if (!bb) {
          notes.push({ level: 'dropped', text: `Left out ${id}: no line was given for it.`, id });
          ids.delete(id);
          continue;
        }
        const thin = Math.min(bb.x1 - bb.x0, bb.y1 - bb.y0) < minSize * 2;
        pts = thin
          ? bb.x1 - bb.x0 >= bb.y1 - bb.y0
            ? [{ x: bb.x0, y: (bb.y0 + bb.y1) / 2 }, { x: bb.x1, y: (bb.y0 + bb.y1) / 2 }]
            : [{ x: (bb.x0 + bb.x1) / 2, y: bb.y0 }, { x: (bb.x0 + bb.x1) / 2, y: bb.y1 }]
          : [{ x: bb.x0, y: bb.y0 }, { x: bb.x1, y: bb.y0 }, { x: bb.x1, y: bb.y1 }, { x: bb.x0, y: bb.y1 }, { x: bb.x0, y: bb.y0 }];
        notes.push({ level: 'fixed', text: `${id} came back as a box, so it is used as its outline.`, id });
      }
      // Drop repeated points (keep a closing point when the shape is closed).
      body.points = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]!) > 1).slice(0, 64);
      if (body.points.length < 2) {
        notes.push({ level: 'dropped', text: `Left out ${id}: its line has no length.`, id });
        ids.delete(id);
        continue;
      }
      if (finite(o.friction) && o.friction >= 0) {
        body.friction = round(clamp(o.friction, 0, 1.5), 3);
        body.frictionFromLabel = true;
      }
      scene.bodies.push(body);
      continue;
    }

    const bb = bounds(o);
    if (!bb) {
      notes.push({ level: 'dropped', text: `Left out ${id}: no position was given for it.`, id });
      ids.delete(id);
      continue;
    }
    body.x = (bb.x0 + bb.x1) / 2;
    body.y = (bb.y0 + bb.y1) / 2;
    const W = bb.x1 - bb.x0;
    const H = bb.y1 - bb.y0;
    if (kind !== 'anchor' && (W < minSize || H < minSize)) {
      notes.push({ level: 'dropped', text: `Left out ${id}: it is too small to simulate.`, id });
      ids.delete(id);
      continue;
    }
    if (kind === 'ball') {
      body.r = (W + H) / 4;
      if (Math.max(W, H) / Math.min(W, H) > 1.6) notes.push({ level: 'fixed', text: `${id} is drawn as an oval; it is simulated as a circle.`, id });
    } else if (kind === 'box') {
      const deg = finite(o.angleDeg) ? clamp(o.angleDeg, -90, 90) : 0;
      body.angle = (deg * Math.PI) / 180;
      const size = sizeFromBounds(W, H, body.angle);
      body.w = size.w;
      body.h = size.h;
    }
    if (kind === 'anchor') {
      scene.bodies.push(body);
      continue;
    }
    body.dynamic = o.fixed !== true;
    if (finite(o.massKg) && o.massKg > 0) {
      body.massKg = round(clamp(o.massKg, 0.01, 1000), 3);
      body.massFromLabel = true;
      if (body.massKg !== o.massKg) notes.push({ level: 'fixed', text: `${id}'s mass was limited to ${body.massKg} kg.`, id });
    }
    if (finite(o.friction) && o.friction >= 0) {
      body.friction = round(clamp(o.friction, 0, 1.5), 3);
      body.frictionFromLabel = true;
    }
    if (finite(o.bounce) && o.bounce >= 0) {
      body.bounce = round(clamp(o.bounce, 0, 1), 3);
      body.bounceFromLabel = true;
    }
    const tip = o.arrow ? px(o.arrow.tip) : null;
    if (tip && body.dynamic) {
      const dx = tip.x - body.x;
      const dy = tip.y - body.y;
      const len = Math.hypot(dx, dy);
      if (len > Math.max(body.r, body.w / 2, body.h / 2) * 0.6) {
        const given = finite(o.arrow!.speedMps) && o.arrow!.speedMps > 0;
        const speed = given ? clamp(o.arrow!.speedMps, 0, 60) : DEFAULTS.speedMps;
        body.vx = round((dx / len) * speed, 3);
        body.vy = round((-dy / len) * speed, 3);
        body.hasArrow = true;
        body.speedFromLabel = given;
        if (!given) notes.push({ level: 'assumed', text: `${id}'s arrow has no speed written on it; using ${DEFAULTS.speedMps} m/s.`, id });
      }
    }
    if (body.dynamic && !body.massFromLabel) notes.push({ level: 'assumed', text: `No mass written for ${id}; using ${DEFAULTS.massKg} kg.`, id });
    scene.bodies.push(body);
  }

  const byId = new Map(scene.bodies.map((b) => [b.id, b]));
  const resolve = (raw: unknown): Body | null => {
    if (typeof raw !== 'string' || !raw) return null;
    return byId.get(idMap.get(raw) ?? raw) ?? null;
  };

  // ---- Scale ---------------------------------------------------------------
  const scales: number[] = [];
  for (const m of Array.isArray(reading.measurements) ? reading.measurements : []) {
    const a = px(m?.from);
    const b = px(m?.to);
    if (!a || !b || !finite(m.meters) || m.meters <= 0) continue;
    const d = dist(a, b);
    if (d < minSize * 3) continue;
    scales.push(m.meters / d);
  }
  if (scales.length) {
    const mpp = median(scales);
    const widthM = mpp * width;
    if (widthM >= 0.05 && widthM <= 200) {
      scene.mpp = mpp;
      scene.scaleFromLabel = true;
    } else notes.push({ level: 'dropped', text: `Ignored a length label: it would make the page ${round(widthM, 1)} m wide.` });
  }
  if (!scene.scaleFromLabel) notes.push({ level: 'assumed', text: `No length is written on the drawing, so the page is taken to be ${DEFAULTS.widthMeters} m wide.` });

  // ---- Links ---------------------------------------------------------------
  const pinned = new Set<string>();
  for (const l of (Array.isArray(reading.links) ? reading.links.slice(0, 40) : []) as ReadLink[]) {
    if (!l || !['rope', 'rod', 'spring', 'pin'].includes(l.kind)) continue;
    let a = resolve(l.from);
    let b = resolve(l.to);
    let aPoint = px(l.fromPoint);
    let bPoint = px(l.toPoint);
    if (!b && !a) {
      notes.push({ level: 'dropped', text: `Left out a ${l.kind}: it is not attached to anything that was read.` });
      continue;
    }
    // The moving end goes in b.
    if ((!b || !b.dynamic) && a?.dynamic) {
      [a, b] = [b, a];
      [aPoint, bPoint] = [bPoint, aPoint];
    }
    if (!b || !b.dynamic) {
      notes.push({ level: 'dropped', text: `Left out a ${l.kind} between two fixed things.` });
      continue;
    }
    if (a && !a.dynamic) {
      // Hanging from a surface or anchor: a fixed point.
      aPoint = a.kind === 'anchor' ? { x: a.x, y: a.y } : (aPoint ?? { x: a.x, y: a.y });
      a = null;
    }
    if (!aPoint) aPoint = a ? { x: a.x, y: a.y } : null;
    if (!aPoint) {
      notes.push({ level: 'dropped', text: `Left out a ${l.kind} on ${b.id}: its fixed end has no position.`, id: b.id });
      continue;
    }
    const joint: Joint = {
      kind: l.kind,
      a: a?.id ?? null,
      aPoint,
      b: b.id,
      bPoint: bPoint ?? { x: b.x, y: b.y },
      stiffness: DEFAULTS.stiffnessNpm,
      stiffnessFromLabel: false,
      restScale: 1,
    };
    if (l.kind === 'pin') {
      // Pivot on the corner of the surface it sits on (the top of a fulcrum), if one is close.
      let pivot = aPoint;
      let bestD = Math.min(width, height) * 0.04;
      for (const s of scene.bodies) {
        if (s.kind !== 'surface') continue;
        for (const p of s.points) {
          const d = dist(p, aPoint);
          if (d < bestD) {
            bestD = d;
            pivot = { ...p };
          }
        }
      }
      if (pivot !== aPoint && bestD > 1) notes.push({ level: 'fixed', text: `Moved ${b.id}'s pivot ${Math.round(bestD)} px onto the corner it rests on.`, id: b.id });
      joint.aPoint = pivot;
      joint.bPoint = pivot;
      pinned.add(b.id);
    } else {
      // A rope or rod pulls on the centre of a ball (pendulum length is to the centre).
      const anchor = (body: Body, p: P) => (body.kind === 'ball' ? { x: body.x, y: body.y } : clampToBox(p, body));
      joint.bPoint = anchor(b, joint.bPoint);
      if (a) joint.aPoint = anchor(a, joint.aPoint);
      if (dist(joint.aPoint, joint.bPoint) < minSize * 2) {
        notes.push({ level: 'dropped', text: `Left out a ${l.kind} on ${b.id}: it has no length.`, id: b.id });
        continue;
      }
    }
    if (l.kind === 'spring') {
      if (finite(l.stiffnessNpm) && l.stiffnessNpm > 0) {
        joint.stiffness = round(clamp(l.stiffnessNpm, 0.5, 100_000), 2);
        joint.stiffnessFromLabel = true;
      } else notes.push({ level: 'assumed', text: `No spring constant written on ${b.id}'s spring; using ${DEFAULTS.stiffnessNpm} N/m.`, id: b.id });
    }
    scene.joints.push(joint);
  }

  // ---- Settle contacts -------------------------------------------------------
  settle(scene, pinned, notes);

  const movers = scene.bodies.filter((b) => b.dynamic);
  if (!movers.length) {
    notes.push({ level: 'problem', text: 'Nothing in this drawing can move. Add a ball or a box (and leave it unfixed).' });
    return scene;
  }
  scene.runnable = true;
  return scene;
}

/**
 * The AI's positions are a few pixels off, so a ball may sit inside the ramp
 * or a box may float above it. Push moving bodies out of fixed surfaces, line
 * boxes up with the slope they sit on, and pull apart overlapping bodies.
 */
function settle(scene: Scene, pinned: Set<string>, notes: Note[]) {
  const surfaces = scene.bodies.filter((b) => b.kind === 'surface');
  const segs = surfaces.flatMap((s) => s.points.slice(1).map((p, i) => ({ a: s.points[i]!, b: p, id: s.id })));
  const movers = scene.bodies.filter((b) => b.dynamic && !pinned.has(b.id));
  const touch = Math.min(scene.width, scene.height) * 0.012;
  const moved = new Map<string, number>();
  const tilted = new Set<string>();

  // Snap boxes that lie on a slope to its angle.
  for (const b of movers.filter((m) => m.kind === 'box')) {
    let best: { angle: number; d: number } | null = null;
    for (const s of segs) {
      const { q, t } = closestOnSegment(b, s.a, s.b);
      if (t <= 0 || t >= 1) continue;
      const d = dist(b, q);
      if (d > Math.hypot(b.w, b.h) / 2 + touch) continue;
      let ang = Math.atan2(-(s.b.y - s.a.y), s.b.x - s.a.x);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      if (!best || d < best.d) best = { angle: ang, d };
    }
    if (best && Math.abs(best.angle - b.angle) > 0.01 && Math.abs(best.angle - b.angle) < (14 * Math.PI) / 180) {
      const before = Math.round((b.angle * 180) / Math.PI);
      b.angle = best.angle;
      if (Math.abs(before - Math.round((b.angle * 180) / Math.PI)) >= 2) tilted.add(`${b.id} (${before}° → ${Math.round((b.angle * 180) / Math.PI)}°)`);
    }
  }

  const push = (b: Body, dx: number, dy: number) => {
    b.x += dx;
    b.y += dy;
    moved.set(b.id, (moved.get(b.id) ?? 0) + Math.hypot(dx, dy));
  };

  for (let pass = 0; pass < 6; pass++) {
    for (const b of movers) {
      for (const s of segs) {
        if (b.kind === 'ball') {
          const { q } = closestOnSegment(b, s.a, s.b);
          const d = dist(b, q);
          if (d < b.r - 0.5) {
            let nx: number;
            let ny: number;
            if (d > 1e-6) {
              nx = (b.x - q.x) / d;
              ny = (b.y - q.y) / d;
            } else {
              // Centre exactly on the line: push to the side that faces up.
              const lx = s.b.x - s.a.x;
              const ly = s.b.y - s.a.y;
              const l = Math.hypot(lx, ly) || 1;
              nx = ly / l;
              ny = -lx / l;
              if (ny > 0) {
                nx = -nx;
                ny = -ny;
              }
            }
            push(b, nx * (b.r - d + 0.5), ny * (b.r - d + 0.5));
          }
        } else if (b.kind === 'box') {
          // Corners on the far side of the segment's line from the centre.
          const lx = s.b.x - s.a.x;
          const ly = s.b.y - s.a.y;
          const l = Math.hypot(lx, ly);
          if (l < 1) continue;
          let nx = -ly / l;
          let ny = lx / l;
          const side = (b.x - s.a.x) * nx + (b.y - s.a.y) * ny;
          if (Math.abs(side) < 1e-6) continue;
          if (side < 0) {
            nx = -nx;
            ny = -ny;
          }
          let depth = 0;
          for (const c of boxCorners(b)) {
            const t = ((c.x - s.a.x) * lx + (c.y - s.a.y) * ly) / (l * l);
            if (t < 0 || t > 1) continue;
            const sd = (c.x - s.a.x) * nx + (c.y - s.a.y) * ny;
            if (sd < 0) depth = Math.max(depth, -sd);
          }
          if (depth > 0.5 && depth < Math.max(b.w, b.h) * 0.6) push(b, nx * (depth + 0.5), ny * (depth + 0.5));
        }
      }
    }
    // Overlapping moving bodies: separate along the shortest way out.
    const all = scene.bodies.filter((b) => b.dynamic);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const p = all[i]!;
        const q = all[j]!;
        if (scene.joints.some((jt) => (jt.a === p.id && jt.b === q.id) || (jt.a === q.id && jt.b === p.id))) continue;
        const rp = p.kind === 'ball' ? p.r : null;
        const rq = q.kind === 'ball' ? q.r : null;
        if (rp !== null && rq !== null) {
          const d = dist(p, q);
          const over = rp + rq - d;
          if (over > 0.5 && d > 1e-6) {
            const nx = (q.x - p.x) / d;
            const ny = (q.y - p.y) / d;
            if (!pinned.has(p.id)) push(p, (-nx * (over + 0.5)) / 2, (-ny * (over + 0.5)) / 2);
            if (!pinned.has(q.id)) push(q, (nx * (over + 0.5)) / 2, (ny * (over + 0.5)) / 2);
          }
          continue;
        }
        // Box involved: compare bounding boxes and lift the upper one.
        const bbox = (b: Body) => {
          if (b.kind === 'ball') return { x0: b.x - b.r, x1: b.x + b.r, y0: b.y - b.r, y1: b.y + b.r };
          const cs = boxCorners(b);
          return { x0: Math.min(...cs.map((c) => c.x)), x1: Math.max(...cs.map((c) => c.x)), y0: Math.min(...cs.map((c) => c.y)), y1: Math.max(...cs.map((c) => c.y)) };
        };
        const A = bbox(p);
        const B = bbox(q);
        const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
        const oy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
        if (ox <= 0.5 || oy <= 0.5) continue;
        const upper = p.y < q.y ? p : q;
        const lower = upper === p ? q : p;
        if (oy <= ox) {
          if (!pinned.has(upper.id)) push(upper, 0, -(oy + 0.5));
          else if (!pinned.has(lower.id)) push(lower, 0, oy + 0.5);
        } else {
          const left = p.x < q.x ? p : q;
          const right = left === p ? q : p;
          if (!pinned.has(left.id)) push(left, -(ox + 0.5) / 2, 0);
          if (!pinned.has(right.id)) push(right, (ox + 0.5) / 2, 0);
        }
      }
    }
  }

  // Re-attach rope/spring ends to bodies that moved.
  for (const j of scene.joints) {
    const b = scene.bodies.find((x) => x.id === j.b);
    if (b?.kind === 'ball' && j.kind !== 'pin') j.bPoint = { x: b.x, y: b.y };
  }
  const nudged = [...moved].filter(([, d]) => d > touch * 0.25).map(([id, d]) => `${id} (${Math.round(d)} px)`);
  if (nudged.length) notes.push({ level: 'fixed', text: `Moved out of overlaps so nothing starts stuck inside something else: ${nudged.join(', ')}.` });
  if (tilted.size) notes.push({ level: 'fixed', text: `Tilted to sit flat on the surface under it: ${[...tilted].join(', ')}.` });
}
