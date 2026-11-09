import { describe, expect, it } from 'vitest';
import type { Reading } from '../src/read/schema.ts';
import { boxCorners, sizeFromBounds } from '../src/scene/geometry.ts';
import { validate } from '../src/scene/validate.ts';
import { DEFAULTS } from '../src/scene/types.ts';

const base = (r: Partial<Reading>): Reading => ({
  isPhysicsSketch: true,
  whatIsIt: 'test',
  objects: [],
  links: [],
  measurements: [],
  unreadable: [],
  ...r,
});
const floor = { id: 'floor', kind: 'surface' as const, points: [[900, 0], [900, 1000]] as [number, number][], label: '' };

describe('validate', () => {
  it('refuses a drawing that is not physics, and says what it looked like', () => {
    const s = validate(base({ isPhysicsSketch: false, whatIsIt: 'A house with a tree.' }), 800, 600);
    expect(s.runnable).toBe(false);
    expect(s.notes[0]!.text).toContain('A house with a tree');
  });

  it('refuses garbage without throwing', () => {
    expect(validate(null, 100, 100).runnable).toBe(false);
    expect(validate({ objects: 'nope' } as unknown as Reading, 100, 100).runnable).toBe(false);
    expect(validate(base({ objects: [{ id: 'x', kind: 'dragon' as 'ball', label: '' }] }), 100, 100).runnable).toBe(false);
  });

  it('needs something that can move', () => {
    const s = validate(base({ objects: [floor] }), 1000, 1000);
    expect(s.runnable).toBe(false);
    expect(s.notes.at(-1)!.text).toMatch(/Nothing in this drawing can move/);
  });

  it('converts 0-1000 coordinates to pixels on a non-square photo', () => {
    const s = validate(base({ objects: [{ id: 'b', kind: 'ball', box_2d: [400, 200, 500, 300], label: '' }] }), 2000, 1000);
    const b = s.bodies[0]!;
    expect(b.x).toBeCloseTo(500);
    expect(b.y).toBeCloseTo(450);
    // 200 px wide and 100 px tall: an oval, simulated as a circle with the mean radius.
    expect(b.r).toBeCloseTo(75);
    expect(s.notes.some((n) => n.text.includes('oval'))).toBe(true);
  });

  it('pushes a ball that the reader placed inside the floor back on top of it', () => {
    const s = validate(base({ objects: [{ id: 'b', kind: 'ball', box_2d: [870, 480, 930, 540], label: '' }, floor] }), 1000, 1000);
    const b = s.bodies.find((x) => x.id === 'b')!;
    expect(b.y + b.r).toBeLessThanOrEqual(900.01);
    expect(s.notes.some((n) => n.level === 'fixed' && n.text.includes('b ('))).toBe(true);
  });

  it('lines a box up with the ramp under it', () => {
    // Ramp at 30°, box read at 22°.
    const th = Math.PI / 6;
    const s = validate(
      base({
        objects: [
          { id: 'ramp', kind: 'surface', points: [[900, 100], [900 - 600 * Math.sin(th), 100 + 600 * Math.cos(th)]], label: '' },
          { id: 'box', kind: 'box', box_2d: [690, 330, 760, 400], angleDeg: 22, label: '' },
        ],
      }),
      1000,
      1000,
    );
    const box = s.bodies.find((b) => b.id === 'box')!;
    expect((box.angle * 180) / Math.PI).toBeCloseTo(30, 0);
    expect(s.notes.some((n) => n.text.includes('22° → 30°'))).toBe(true);
  });

  it('reads masses, friction and arrows, and fills in what is missing', () => {
    const s = validate(
      base({
        objects: [
          { id: 'a', kind: 'ball', box_2d: [100, 100, 150, 150], label: '3 kg, μ = 0.1', massKg: 3, friction: 0.1, arrow: { tip: [125, 400], speedMps: 4 } },
          { id: 'b', kind: 'box', box_2d: [100, 600, 150, 650], label: '', arrow: { tip: [0, 625], speedMps: -1 } },
          { id: 'c', kind: 'ball', box_2d: [300, 600, 350, 650], label: 'huge', massKg: 1e9 },
        ],
      }),
      1000,
      1000,
    );
    const [a, b, c] = s.bodies;
    expect(a!.massKg).toBe(3);
    expect(a!.friction).toBe(0.1);
    expect(a!.vx).toBeCloseTo(4);
    expect(a!.vy).toBeCloseTo(0);
    // An arrow pointing up the page is +y in the engine.
    expect(b!.vy).toBeCloseTo(DEFAULTS.speedMps);
    expect(b!.massFromLabel).toBe(false);
    expect(c!.massKg).toBe(1000);
    expect(s.notes.some((n) => n.level === 'assumed' && n.id === 'b')).toBe(true);
  });

  it('takes the scale from a written length', () => {
    const s = validate(base({ objects: [{ id: 'b', kind: 'ball', box_2d: [100, 100, 150, 150], label: '' }], measurements: [{ from: [500, 100], to: [500, 600], meters: 1, label: '1 m' }] }), 1000, 1000);
    expect(s.scaleFromLabel).toBe(true);
    expect(s.mpp).toBeCloseTo(1 / 500);
  });

  it('ignores an absurd length label', () => {
    const s = validate(base({ objects: [{ id: 'b', kind: 'ball', box_2d: [100, 100, 150, 150], label: '' }], measurements: [{ from: [500, 100], to: [500, 600], meters: 50000, label: '50 km' }] }), 1000, 1000);
    expect(s.scaleFromLabel).toBe(false);
    expect(s.mpp).toBeCloseTo(DEFAULTS.widthMeters / 1000);
  });

  it('drops links to things that were not read, keeps a pendulum hanging from the ceiling', () => {
    const s = validate(
      base({
        objects: [
          { id: 'ceiling', kind: 'surface', points: [[50, 0], [50, 1000]], label: '' },
          { id: 'bob', kind: 'ball', box_2d: [500, 480, 540, 520], label: '' },
        ],
        links: [
          { kind: 'rope', from: 'ceiling', fromPoint: [50, 500], to: 'bob', toPoint: [500, 500] },
          { kind: 'spring', from: 'ghost', fromPoint: [0, 0], to: 'ghost2', toPoint: [10, 10] },
        ],
      }),
      1000,
      1000,
    );
    expect(s.joints).toHaveLength(1);
    expect(s.joints[0]!.a).toBeNull();
    // Pendulum length is measured to the centre of the bob.
    expect(s.joints[0]!.bPoint).toEqual({ x: 500, y: 520 });
    expect(s.notes.some((n) => n.level === 'dropped')).toBe(true);
  });

  it('makes duplicate ids unique', () => {
    const s = validate(base({ objects: [{ id: 'ball', kind: 'ball', box_2d: [100, 100, 150, 150], label: '' }, { id: 'ball', kind: 'ball', box_2d: [100, 400, 150, 450], label: '' }] }), 1000, 1000);
    expect(s.bodies.map((b) => b.id)).toEqual(['ball', 'ball_2']);
  });

  it('separates two balls drawn overlapping', () => {
    const s = validate(base({ objects: [{ id: 'a', kind: 'ball', box_2d: [100, 100, 200, 200], label: '' }, { id: 'b', kind: 'ball', box_2d: [100, 170, 200, 270], label: '' }] }), 1000, 1000);
    const [a, b] = s.bodies;
    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeGreaterThanOrEqual(a!.r + b!.r - 0.01);
  });
});

describe('geometry', () => {
  it('recovers a tilted box from its bounding box', () => {
    const angle = (25 * Math.PI) / 180;
    const corners = boxCorners({ x: 0, y: 0, w: 80, h: 40, angle });
    const W = Math.max(...corners.map((c) => c.x)) - Math.min(...corners.map((c) => c.x));
    const H = Math.max(...corners.map((c) => c.y)) - Math.min(...corners.map((c) => c.y));
    const size = sizeFromBounds(W, H, angle);
    expect(size.w).toBeCloseTo(80);
    expect(size.h).toBeCloseTo(40);
  });

  it('turns a box counterclockwise as seen on the page', () => {
    // After a small counterclockwise turn, the right-hand corners rise (smaller y).
    const c = boxCorners({ x: 0, y: 0, w: 100, h: 10, angle: 0.2 });
    expect(c[1]!.y).toBeLessThan(c[0]!.y);
  });
});
