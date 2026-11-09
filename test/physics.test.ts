import { describe, expect, it } from 'vitest';
import type { Reading } from '../src/read/schema.ts';
import { validate } from '../src/scene/validate.ts';
import { RestWatch, energy, formulaChecks, periodFrom, sample, type Sample } from '../src/sim/measure.ts';
import { G, buildSim } from '../src/sim/world.ts';

/** A 1000 × 1000 px page with a "2 m" measurement across it: 1 px = 2 mm. */
const page = (r: Partial<Reading>): Reading => ({
  isPhysicsSketch: true,
  whatIsIt: 'test',
  objects: [],
  links: [],
  measurements: [{ from: [990, 0], to: [990, 1000], meters: 2, label: '2 m' }],
  unreadable: [],
  ...r,
});

function run(reading: Reading, seconds: number, id: string, every = 1 / 240) {
  const scene = validate(reading, 1000, 1000);
  const sim = buildSim(scene);
  const out: Sample[] = [];
  while (sim.time < seconds) {
    sim.step(every);
    const s = sample(sim, id);
    if (s) out.push(s);
  }
  return { scene, sim, samples: out };
}

describe('engine vs textbook', () => {
  it('free fall: 1 m drop takes √(2h/g)', () => {
    // Ball centre at y=300 (1.4 m up), floor at y=900 (0.2 m up); radius 20 px = 4 cm.
    const reading = page({
      objects: [
        { id: 'ball', kind: 'ball', box_2d: [280, 480, 320, 520], label: '' },
        { id: 'floor', kind: 'surface', points: [[900, 0], [900, 1000]], label: '' },
      ],
    });
    const { samples } = run(reading, 1, 'ball');
    // Bottom of ball starts at 320 px, floor at 900 px: drop of 580 px = 1.16 m.
    const h = 1.16;
    const hit = samples.find((s, i) => i > 0 && s.vy > samples[i - 1]!.vy + 0.5);
    expect(hit).toBeDefined();
    expect(hit!.t).toBeCloseTo(Math.sqrt((2 * h) / G), 1);
    expect(Math.abs(hit!.t - Math.sqrt((2 * h) / G)) / Math.sqrt((2 * h) / G)).toBeLessThan(0.02);
  });

  it('pendulum period matches 2π√(L/g) with the large-angle correction', () => {
    // Pivot at (500, 100); bob 500 px (1 m) away at 20°.
    const th = (20 * Math.PI) / 180;
    const bx = 500 + 500 * Math.sin(th);
    const by = 100 + 500 * Math.cos(th);
    const reading = page({
      objects: [{ id: 'bob', kind: 'ball', box_2d: [by - 15, bx - 15, by + 15, bx + 15], label: '1 kg', massKg: 1 }],
      links: [{ kind: 'rod', from: '', fromPoint: [100, 500], to: 'bob', toPoint: [by, bx] }],
    });
    const { scene, samples } = run(reading, 8, 'bob');
    const [check] = formulaChecks(scene);
    expect(check?.kind).toBe('pendulum');
    const T = periodFrom(samples)!;
    expect(Math.abs(T - check!.predicted) / check!.predicted).toBeLessThan(0.02);
  });

  it('spring: period matches 2π√(m/k)', () => {
    const reading = page({
      objects: [{ id: 'mass', kind: 'box', box_2d: [580, 470, 640, 530], label: '2 kg', massKg: 2 }],
      links: [{ kind: 'spring', from: '', fromPoint: [100, 500], to: 'mass', toPoint: [580, 500], stiffnessNpm: 50 }],
    });
    const { scene, samples } = run(reading, 8, 'mass');
    const [check] = formulaChecks(scene);
    expect(check?.kind).toBe('spring');
    expect(check!.predicted).toBeCloseTo(2 * Math.PI * Math.sqrt(2 / 50), 6);
    const T = periodFrom(samples)!;
    expect(Math.abs(T - check!.predicted) / check!.predicted).toBeLessThan(0.03);
  });

  // Box2D's rigid joints lose a little energy every step (the loss scales with the step size).
  // At 480 steps a second it stays under 1% of the total per second; the energy bars show it.
  it('a swinging rod keeps its energy to within 1% per second', () => {
    const reading = page({
      objects: [{ id: 'bob', kind: 'ball', box_2d: [285, 785, 315, 815], label: '' }],
      links: [{ kind: 'rod', from: '', fromPoint: [300, 500], to: 'bob', toPoint: [300, 800] }],
    });
    const scene = validate(reading, 1000, 1000);
    const sim = buildSim(scene);
    const total = () => {
      const e = energy(sim);
      return e.kinetic + e.potential + e.spring;
    };
    const start = total();
    let worst = 0;
    while (sim.time < 5) {
      sim.step(1 / 60);
      worst = Math.max(worst, Math.abs(total() - start) / start);
    }
    expect(worst / 5).toBeLessThan(0.01);
  });

  it('friction decides whether a box slides: μ = 0.7 holds on 30°, μ = 0.2 slides at g(sinθ − μcosθ)', () => {
    const th = Math.PI / 6;
    // Slope from (100, 900) rising to the right.
    const len = 700;
    const top: [number, number] = [900 - len * Math.sin(th), 100 + len * Math.cos(th)];
    const mid = { x: 100 + 350 * Math.cos(th), y: 900 - 350 * Math.sin(th) };
    // Box 40 px square sitting on the slope (centre 20 px above along the normal).
    const cx = mid.x - 20 * Math.sin(th);
    const cy = mid.y - 20 * Math.cos(th);
    const half = 20 * (Math.cos(th) + Math.sin(th));
    const make = (mu: number) =>
      page({
        objects: [
          { id: 'ramp', kind: 'surface', points: [[900, 100], top], label: '' },
          { id: 'box', kind: 'box', box_2d: [cy - half, cx - half, cy + half, cx + half], angleDeg: 30, label: `μ = ${mu}`, friction: mu },
        ],
      });
    const still = run(make(0.7), 1.5, 'box').samples;
    expect(Math.hypot(still.at(-1)!.vx, still.at(-1)!.vy)).toBeLessThan(0.02);
    const slide = run(make(0.2), 0.5, 'box').samples;
    const a = Math.hypot(slide.at(-1)!.vx, slide.at(-1)!.vy) / slide.at(-1)!.t;
    const expected = G * (Math.sin(th) - 0.2 * Math.cos(th));
    expect(Math.abs(a - expected) / expected).toBeLessThan(0.05);
  });

  it('runs the same way every time', () => {
    const reading = page({
      objects: [
        { id: 'b1', kind: 'ball', box_2d: [100, 300, 150, 350], label: '', arrow: { tip: [100, 500], speedMps: 3 } },
        { id: 'floor', kind: 'surface', points: [[900, 0], [900, 1000]], label: '' },
      ],
    });
    const a = run(reading, 2, 'b1').samples.at(-1)!;
    const b = run(reading, 2, 'b1').samples.at(-1)!;
    expect(a).toEqual(b);
  });

  it('notices when everything has stopped', () => {
    const reading = page({
      objects: [
        { id: 'box', kind: 'box', box_2d: [800, 480, 880, 560], label: '' },
        { id: 'floor', kind: 'surface', points: [[900, 0], [900, 1000]], label: '' },
      ],
    });
    const scene = validate(reading, 1000, 1000);
    const sim = buildSim(scene);
    const watch = new RestWatch(0.5);
    let rested = -1;
    while (sim.time < 3 && rested < 0) {
      sim.step(1 / 60);
      if (watch.update(sim, 1 / 60)) rested = sim.time;
    }
    expect(rested).toBeGreaterThan(0);
    expect(rested).toBeLessThan(2);
  });
});

describe('friction written on the drawing', () => {
  const th = (24 * Math.PI) / 180;
  const mid = { x: 100 + 350 * Math.cos(th), y: 900 - 350 * Math.sin(th) };
  const cx = mid.x - 20 * Math.sin(th);
  const cy = mid.y - 20 * Math.cos(th);
  const half = 20 * (Math.cos(th) + Math.sin(th));
  const scene = (rampMu: number, blockMu?: number) =>
    validate(
      page({
        objects: [
          { id: 'ramp', kind: 'surface', points: [[900, 100], [900 - 700 * Math.sin(th), 100 + 700 * Math.cos(th)]], label: `μ = ${rampMu}`, friction: rampMu },
          { id: 'box', kind: 'box', box_2d: [cy - half, cx - half, cy + half, cx + half], angleDeg: 24, label: '', ...(blockMu === undefined ? {} : { friction: blockMu }) },
        ],
      }),
      1000,
      1000,
    );
  const speedAfter = (s: ReturnType<typeof scene>) => {
    const sim = buildSim(s);
    sim.step(0.5);
    const v = sim.bodies.get('box')!.getLinearVelocity();
    return Math.hypot(v.x, v.y);
  };
  it('a μ written by the ramp applies to the block on it', () => {
    // tan 24° = 0.45: μ 0.2 slides, μ 0.5 holds.
    expect(speedAfter(scene(0.2))).toBeGreaterThan(0.5);
    expect(speedAfter(scene(0.5))).toBeLessThan(0.02);
  });
  it("the block's own μ wins over the ramp's", () => {
    expect(speedAfter(scene(0.2, 0.5))).toBeLessThan(0.02);
    expect(speedAfter(scene(0.5, 0.2))).toBeGreaterThan(0.5);
  });
});
