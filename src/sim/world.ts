/**
 * Builds a Planck.js (Box2D) world from a checked scene. Units are SI:
 * meters, kilograms, seconds, y up. The image's bottom-left corner is (0, 0).
 */
import { Box, Chain, Circle, DistanceJoint, Edge, RevoluteJoint, RopeJoint, Vec2, World, type Body as PBody, type Contact, type Joint as PJoint } from 'planck';
import { DEFAULTS, type P, type Scene } from '../scene/types.ts';

export const G = 9.81;
export const STEP = 1 / 480;

export interface Sim {
  world: World;
  scene: Scene;
  bodies: Map<string, PBody>;
  /** Engine joints in the same order as scene.joints (null when one was skipped). */
  joints: (PJoint | null)[];
  /** Image pixels → world meters. */
  toWorld: (p: P) => Vec2;
  /** World meters → image pixels. */
  toImage: (v: { x: number; y: number }) => P;
  time: number;
  step: (dt: number) => void;
}

export interface SimOptions {
  /** Treat the bottom edge of the photo as a floor so nothing falls forever. */
  pageFloor?: boolean;
}

export function buildSim(scene: Scene, opts: SimOptions = {}): Sim {
  const world = new World({ gravity: new Vec2(0, -G) });
  const m = scene.mpp;
  const H = scene.height;
  const toWorld = (p: P) => new Vec2(p.x * m, (H - p.y) * m);
  const toImage = (v: { x: number; y: number }) => ({ x: v.x / m, y: H - v.y / m });
  const bodies = new Map<string, PBody>();
  const ground = world.createBody();

  for (const b of scene.bodies) {
    if (b.kind === 'surface') {
      const pts = b.points.map(toWorld);
      const closed = pts.length > 3 && Vec2.distance(pts[0]!, pts[pts.length - 1]!) < 0.02 * Math.max(1, m * scene.width);
      const verts = closed ? pts.slice(0, -1) : pts;
      const body = world.createBody();
      if (verts.length === 2) body.createFixture(new Edge(verts[0]!, verts[1]!), { friction: b.friction, restitution: 0 });
      else body.createFixture(new Chain(verts, closed), { friction: b.friction, restitution: 0 });
      body.setUserData({ id: b.id, kind: 'surface', friction: b.friction, labeled: b.frictionFromLabel });
      bodies.set(b.id, body);
      continue;
    }
    if (b.kind === 'anchor') {
      const body = world.createBody({ position: toWorld(b) });
      body.setUserData({ id: b.id, kind: 'anchor' });
      bodies.set(b.id, body);
      continue;
    }
    const body = b.dynamic
      ? world.createDynamicBody({ position: toWorld(b), angle: b.angle, bullet: true })
      : world.createBody({ position: toWorld(b), angle: b.angle });
    const fixtureOpt = { friction: b.friction, restitution: b.bounce, density: 1 };
    if (b.kind === 'ball') {
      const r = b.r * m;
      fixtureOpt.density = b.massKg / (Math.PI * r * r);
      body.createFixture(new Circle(r), fixtureOpt);
    } else {
      const hw = (b.w * m) / 2;
      const hh = (b.h * m) / 2;
      fixtureOpt.density = b.massKg / (4 * hw * hh);
      body.createFixture(new Box(hw, hh), fixtureOpt);
    }
    if (b.dynamic) body.setLinearVelocity(new Vec2(b.vx, b.vy));
    body.setUserData({ id: b.id, kind: b.kind, friction: b.friction, labeled: b.frictionFromLabel });
    bodies.set(b.id, body);
  }

  if (opts.pageFloor) {
    const floor = world.createBody();
    floor.createFixture(new Edge(new Vec2(-scene.width * m, 0), new Vec2(2 * scene.width * m, 0)), { friction: 1, restitution: 0 });
    floor.setUserData({ id: '_page', kind: 'surface', friction: DEFAULTS.friction, labeled: false });
  }

  const joints: (PJoint | null)[] = [];
  const passThrough: [PBody, PBody][] = [];
  for (const j of scene.joints) {
    const b = bodies.get(j.b);
    if (!b) {
      joints.push(null);
      continue;
    }
    const a = j.a ? bodies.get(j.a) ?? ground : ground;
    const wa = toWorld(j.aPoint);
    const wb = toWorld(j.bPoint);
    const length = Vec2.distance(wa, wb);
    if (j.kind === 'pin') {
      joints.push(world.createJoint(new RevoluteJoint({}, a, b, wa)));
      // A plank on a pivot touches its fulcrum only at the pivot: let it pass through
      // any surface that has a corner at the pivot point.
      for (const s of scene.bodies) {
        if (s.kind === 'surface' && s.points.some((p) => Math.hypot(p.x - j.aPoint.x, p.y - j.aPoint.y) < 2)) {
          const sb = bodies.get(s.id);
          if (sb) passThrough.push([b, sb]);
        }
      }
    } else if (j.kind === 'rod') {
      joints.push(world.createJoint(new DistanceJoint({ length }, a, b, wa, wb)));
    } else if (j.kind === 'rope') {
      joints.push(world.createJoint(new RopeJoint({ bodyA: a, bodyB: b, localAnchorA: a.getLocalPoint(wa), localAnchorB: b.getLocalPoint(wb), maxLength: length })));
    } else {
      // Spring: a soft distance joint whose stiffness equals k.
      const mb = b.getMass();
      const ma = a.isDynamic() ? a.getMass() : 0;
      const mEff = ma > 0 ? (ma * mb) / (ma + mb) : mb;
      const frequencyHz = Math.sqrt(j.stiffness / mEff) / (2 * Math.PI);
      joints.push(world.createJoint(new DistanceJoint({ length: length * j.restScale, frequencyHz, dampingRatio: 0.01 }, a, b, wa, wb)));
    }
  }

  // Friction: a coefficient written on the drawing (on the block or on the ramp) is the
  // coefficient between the two things touching. Written values win over defaults. (Box2D's own rule, √(μa·μb), would change a written μ.)
  world.on('pre-solve', (contact: Contact) => {
    const ba = contact.getFixtureA().getBody();
    const bb = contact.getFixtureB().getBody();
    if (passThrough.some(([x, y]) => (x === ba && y === bb) || (x === bb && y === ba))) {
      contact.setEnabled(false);
      return;
    }
    type U = { friction?: number; labeled?: boolean } | null;
    const ua = contact.getFixtureA().getBody().getUserData() as U;
    const ub = contact.getFixtureB().getBody().getUserData() as U;
    const fa = ua?.friction ?? DEFAULTS.friction;
    const fb = ub?.friction ?? DEFAULTS.friction;
    // A value on the moving object is more specific than one on the ramp, so it wins.
    const aFirst = ua?.labeled && (!ub?.labeled || (ba.isDynamic() && !bb.isDynamic()));
    const bFirst = ub?.labeled && (!ua?.labeled || (bb.isDynamic() && !ba.isDynamic()));
    if (aFirst && !bFirst) contact.setFriction(fa);
    else if (bFirst && !aFirst) contact.setFriction(fb);
    else contact.setFriction((fa + fb) / 2);
  });

  const sim: Sim = {
    world,
    scene,
    bodies,
    joints,
    toWorld,
    toImage,
    time: 0,
    step(dt: number) {
      // Fixed steps keep runs repeatable: the same scene always moves the same way.
      acc += dt;
      while (acc >= STEP - 1e-12) {
        world.step(STEP, 10, 4);
        acc -= STEP;
        sim.time += STEP;
      }
    },
  };
  let acc = 0;
  return sim;
}
