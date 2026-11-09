/**
 * The eval set: physics doodles built from 12 templates with random sizes,
 * angles, labels and photo conditions, plus drawings that are not physics
 * and deliberately hard cases. Every case is generated from a seed, so the
 * set is reproducible: `npm run gen`.
 */
import { rng } from './render.ts';
import type { DArrow, DBall, DBox, DLabel, DLink, DMeasure, DShape, Doodle, Style, XY } from './doodle.ts';

type R = () => number;
const between = (r: R, a: number, b: number) => a + (b - a) * r();
const pick = <T,>(r: R, xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
const round = (n: number, d = 0) => Number(n.toFixed(d));

const FONTS = ['Ink Free', 'Segoe Script', 'Comic Sans MS'];

function style(r: R, o: Partial<Style> = {}): Style {
  return {
    paper: pick(r, ['plain', 'grid', 'ruled', 'cream'] as const),
    ink: r() < 0.7 ? 'pencil' : 'pen',
    font: pick(r, FONTS),
    rot: between(r, -3, 3),
    scale: between(r, 0.9, 1.0),
    dx: between(r, -0.03, 0.03),
    dy: between(r, -0.03, 0.03),
    light: between(r, 0.4, 1),
    blur: r() < 0.5 ? 0 : between(r, 0.3, 0.7),
    ...o,
  };
}

interface Parts {
  title: string;
  tests: string;
  shapes: DShape[];
  labels?: DLabel[];
  arrows?: DArrow[];
  links?: DLink[];
  measures?: DMeasure[];
}

const floorLine = (y = 800, x0 = 60, x1 = 1140): DShape => ({ kind: 'surface', id: 'floor', pts: [[x0, y], [x1, y]], hatch: -1 });
const ceiling = (y = 110, x0 = 330, x1 = 870): DShape => ({ kind: 'surface', id: 'ceiling', pts: [[x0, y], [x1, y]], hatch: 1 });

const mass = (r: R) => pick(r, [0.5, 1, 2, 3, 4, 5]);
const massText = (kg: number) => (kg < 1 ? `${kg * 1000} g` : `${kg} kg`);

/** A slope from top-left down to bottom-right, as a right triangle. */
function ramp(r: R) {
  const x0 = between(r, 90, 160);
  const h = between(r, 260, 420);
  const L = between(r, 420, 640);
  const A: XY = [x0, 800 - h];
  const B: XY = [x0 + L, 800];
  const len = Math.hypot(L, h);
  const u: XY = [L / len, h / len];
  const n: XY = [h / len, -L / len];
  return { A, B, u, n, h, L, x0, deg: (Math.atan2(h, L) * 180) / Math.PI };
}

const T: Record<string, (r: R) => Parts> = {
  ramp_ball(r) {
    const k = ramp(r);
    const rad = between(r, 26, 40);
    const s = between(r, 30, 90);
    const c: XY = [k.A[0] + k.u[0] * s + k.n[0] * rad, k.A[1] + k.u[1] * s + k.n[1] * rad];
    const kg = mass(r);
    const meters = pick(r, [0.5, 1, 1.5]);
    return {
      title: 'A ball at the top of a ramp',
      tests: 'circle on a slope, mass label, height measurement',
      shapes: [floorLine(), { kind: 'surface', id: 'ramp', pts: [[k.x0, 800], k.A, k.B] }, { kind: 'ball', id: 'ball', c, r: rad }],
      labels: [{ on: 'ball', text: massText(kg), at: [c[0] + rad + 50, c[1] - rad - 10], massKg: kg }],
      measures: [{ a: k.A, b: [k.x0, 800], meters, text: `${meters} m`, offset: [-40, 0] }],
    };
  },
  ramp_box(r) {
    const k = ramp(r);
    const w = between(r, 70, 100);
    const h = between(r, 50, 70);
    const s = between(r, 60, 160);
    const c: XY = [k.A[0] + k.u[0] * (s + w / 2) + k.n[0] * (h / 2), k.A[1] + k.u[1] * (s + w / 2) + k.n[1] * (h / 2)];
    const mu = pick(r, [0.1, 0.2, 0.3, 0.5]);
    const kg = mass(r);
    return {
      title: 'A block on a ramp with friction',
      tests: 'tilted box, friction label, mass label',
      shapes: [floorLine(), { kind: 'surface', id: 'ramp', pts: [[k.x0, 800], k.A, k.B] }, { kind: 'box', id: 'block', c, w, h, angle: -round(k.deg, 1) }],
      labels: [
        { on: 'block', text: massText(kg), at: [c[0] + 30, c[1] - 90], massKg: kg },
        // Written beside the ramp, so it is the ramp's friction.
        { on: 'ramp', text: `μ = ${mu}`, at: [k.B[0] - 40, 680], friction: mu },
      ],
    };
  },
  pendulum(r) {
    const P: XY = [600, 110];
    const L = between(r, 380, 520);
    const th = ((r() < 0.5 ? -1 : 1) * between(r, 20, 45) * Math.PI) / 180;
    const rad = between(r, 26, 36);
    const c: XY = [P[0] + L * Math.sin(th), P[1] + L * Math.cos(th)];
    const kg = mass(r);
    const meters = pick(r, [0.5, 1, 2]);
    // The length label sits halfway along the string.
    return {
      title: 'A pendulum hanging from the ceiling',
      tests: 'rope from a fixed point, swing angle, length label',
      shapes: [ceiling(), { kind: 'ball', id: 'bob', c, r: rad }],
      links: [{ kind: 'rope', from: 'ceiling', fromP: P, to: 'bob', toP: [c[0] - rad * Math.sin(th), c[1] - rad * Math.cos(th)] }],
      labels: [{ on: 'bob', text: massText(kg), at: [c[0] + (th > 0 ? 90 : -90), c[1] + 10], massKg: kg }],
      measures: [{ a: P, b: c, meters, text: `${meters} m`, offset: [th > 0 ? -50 : 50, 0] }],
    };
  },
  spring_wall(r) {
    const len = between(r, 220, 360);
    const w = between(r, 100, 130);
    const h = between(r, 80, 100);
    const c: XY = [120 + len + w / 2, 800 - h / 2];
    const k = pick(r, [20, 50, 100, 200]);
    const kg = mass(r);
    const v = pick(r, [2, 3, 4]);
    return {
      title: 'A block on a spring attached to a wall',
      tests: 'zigzag spring, spring constant label, velocity arrow',
      shapes: [
        { kind: 'surface', id: 'wall', pts: [[120, 480], [120, 800]], hatch: -1 },
        { kind: 'surface', id: 'floor', pts: [[120, 800], [1140, 800]], hatch: -1 },
        { kind: 'box', id: 'block', c, w, h, angle: 0 },
      ],
      links: [{ kind: 'spring', from: 'wall', fromP: [120, c[1]], to: 'block', toP: [c[0] - w / 2, c[1]], k, text: `k = ${k} N/m`, textAt: [120 + len / 2, c[1] - 60] }],
      labels: [{ on: 'block', text: massText(kg), at: [c[0], c[1] - h / 2 - 40], massKg: kg }],
      arrows: [{ on: 'block', tip: [c[0] + w / 2 + 130, c[1]], speed: v, text: `${v} m/s`, textAt: [c[0] + w / 2 + 80, c[1] - 40] }],
    };
  },
  collision(r) {
    const ra = between(r, 30, 42);
    const rb = between(r, 34, 50);
    const a: XY = [between(r, 220, 320), 800 - ra];
    const b: XY = [between(r, 720, 860), 800 - rb];
    const ka = mass(r);
    const kb = mass(r);
    const va = pick(r, [3, 4, 5]);
    const vb = pick(r, [0, 1, 2]);
    const arrows: DArrow[] = [{ on: 'ball1', tip: [a[0] + ra + 150, a[1]], speed: va, text: `${va} m/s`, textAt: [a[0] + ra + 80, a[1] - 50] }];
    if (vb) arrows.push({ on: 'ball2', tip: [b[0] - rb - 130, b[1]], speed: vb, text: `${vb} m/s`, textAt: [b[0] - rb - 70, b[1] - 50] });
    return {
      title: 'Two balls about to collide on the floor',
      tests: 'two bodies, two masses, arrows in opposite directions',
      shapes: [floorLine(), { kind: 'ball', id: 'ball1', c: a, r: ra }, { kind: 'ball', id: 'ball2', c: b, r: rb }],
      labels: [
        { on: 'ball1', text: massText(ka), at: [a[0], a[1] - ra - 90], massKg: ka },
        { on: 'ball2', text: massText(kb), at: [b[0], b[1] - rb - 90], massKg: kb },
      ],
      arrows,
    };
  },
  projectile(r) {
    const top = between(r, 380, 480);
    const edge = between(r, 380, 460);
    const rad = between(r, 24, 32);
    const c: XY = [edge - rad - 20, top - rad];
    const v = pick(r, [3, 4, 5, 6]);
    const ang = (between(r, 30, 55) * Math.PI) / 180;
    const meters = pick(r, [1, 1.5, 2]);
    return {
      title: 'A ball launched off a table',
      tests: 'angled velocity arrow, ledge outline, height label',
      shapes: [
        { kind: 'surface', id: 'table', pts: [[60, top], [edge, top], [edge, 800]] },
        { kind: 'surface', id: 'floor', pts: [[edge, 800], [1140, 800]], hatch: -1 },
        { kind: 'ball', id: 'ball', c, r: rad },
      ],
      arrows: [{ on: 'ball', tip: [c[0] + Math.cos(ang) * 170, c[1] - Math.sin(ang) * 170], speed: v, text: `${v} m/s`, textAt: [c[0] + Math.cos(ang) * 120 + 60, c[1] - Math.sin(ang) * 120 - 10] }],
      measures: [{ a: [edge, top], b: [edge, 800], meters, text: `${meters} m`, offset: [45, 0] }],
    };
  },
  seesaw(r) {
    const W = between(r, 480, 600);
    const ph = 100;
    const apex: XY = [600, 800 - ph];
    const plank: DBox = { kind: 'box', id: 'plank', c: [600, apex[1] - 11], w: W, h: 22, angle: 0 };
    const bw = between(r, 60, 80);
    const kb = mass(r);
    const kc = mass(r);
    const left: DBox = { kind: 'box', id: 'box', c: [600 - W / 2 + bw / 2 + 10, apex[1] - 22 - bw / 2], w: bw, h: bw, angle: 0 };
    const ball: DBall = { kind: 'ball', id: 'ball', c: [600 + W / 2 - 60, between(r, 220, 320)], r: between(r, 26, 34) };
    return {
      title: 'A seesaw with a box on one end and a ball dropping on the other',
      tests: 'pin joint on a fulcrum, long thin plank, drop from height',
      shapes: [floorLine(), { kind: 'surface', id: 'fulcrum', pts: [[540, 800], apex, [660, 800]] }, plank, left, ball],
      links: [{ kind: 'pin', from: '', fromP: apex, to: 'plank', toP: apex }],
      labels: [
        { on: 'box', text: massText(kb), at: [left.c[0], left.c[1] - bw / 2 - 40], massKg: kb },
        { on: 'ball', text: massText(kc), at: [ball.c[0] + 90, ball.c[1]], massKg: kc },
      ],
    };
  },
  stack(r) {
    const n = pick(r, [3, 4]);
    const x = between(r, 760, 880);
    const shapes: DShape[] = [floorLine()];
    let y = 800;
    for (let i = 0; i < n; i++) {
      const w = between(r, 90, 115);
      const h = between(r, 70, 90);
      shapes.push({ kind: 'box', id: `box${i + 1}`, c: [x + between(r, -8, 8), y - h / 2], w, h, angle: 0 });
      y -= h;
    }
    const rad = between(r, 28, 36);
    const c: XY = [between(r, 200, 320), 800 - rad];
    const v = pick(r, [5, 6, 8]);
    shapes.push({ kind: 'ball', id: 'ball', c, r: rad });
    return {
      title: 'A ball rolling at a tower of blocks',
      tests: 'several stacked boxes, one arrow',
      shapes,
      arrows: [{ on: 'ball', tip: [c[0] + rad + 150, c[1]], speed: v, text: `${v} m/s`, textAt: [c[0] + rad + 80, c[1] - 50] }],
      labels: [{ on: 'ball', text: massText(2), at: [c[0], c[1] - rad - 90], massKg: 2 }],
    };
  },
  double_pendulum(r) {
    const P: XY = [600, 110];
    const L1 = between(r, 220, 280);
    const L2 = between(r, 200, 260);
    const t1 = (between(r, 30, 70) * Math.PI) / 180 * (r() < 0.5 ? -1 : 1);
    const t2 = (between(r, -40, 60) * Math.PI) / 180;
    const r1 = between(r, 22, 28);
    const r2 = between(r, 22, 28);
    const c1: XY = [P[0] + L1 * Math.sin(t1), P[1] + L1 * Math.cos(t1)];
    const c2: XY = [c1[0] + L2 * Math.sin(t2), c1[1] + L2 * Math.cos(t2)];
    return {
      title: 'A double pendulum',
      tests: 'a rod between two moving bodies (chaotic motion)',
      shapes: [ceiling(), { kind: 'ball', id: 'bob1', c: c1, r: r1 }, { kind: 'ball', id: 'bob2', c: c2, r: r2 }],
      links: [
        { kind: 'rod', from: 'ceiling', fromP: P, to: 'bob1', toP: [c1[0] - r1 * Math.sin(t1), c1[1] - r1 * Math.cos(t1)] },
        { kind: 'rod', from: 'bob1', fromP: [c1[0] + r1 * Math.sin(t2), c1[1] + r1 * Math.cos(t2)], to: 'bob2', toP: [c2[0] - r2 * Math.sin(t2), c2[1] - r2 * Math.cos(t2)] },
      ],
    };
  },
  cup(r) {
    const y0 = between(r, 200, 280);
    const y1 = between(r, 480, 540);
    const x1 = between(r, 560, 620);
    const cupL = x1 + between(r, 80, 120);
    const cupW = between(r, 160, 220);
    const rad = between(r, 24, 30);
    const len = Math.hypot(x1 - 100, y1 - y0);
    const u: XY = [(x1 - 100) / len, (y1 - y0) / len];
    const n: XY = [u[1], -u[0]];
    const c: XY = [100 + u[0] * 50 + n[0] * rad, y0 + u[1] * 50 + n[1] * rad];
    return {
      title: 'A ball rolling down a slope towards a cup',
      tests: 'open container outline, slope not touching the floor',
      shapes: [
        floorLine(),
        { kind: 'surface', id: 'slope', pts: [[100, y0], [x1, y1]] },
        { kind: 'surface', id: 'cup', pts: [[cupL, 620], [cupL + 15, 800], [cupL + cupW - 15, 800], [cupL + cupW, 620]] },
        { kind: 'ball', id: 'ball', c, r: rad },
      ],
    };
  },
  cradle(r) {
    const L = between(r, 340, 420);
    const rad = between(r, 30, 36);
    const shapes: DShape[] = [ceiling(110, 300, 900)];
    const links: DLink[] = [];
    const th = (between(r, 30, 45) * Math.PI) / 180;
    for (let i = 0; i < 3; i++) {
      const P: XY = [600 + (i - 1) * 2 * rad, 110];
      const a = i === 0 ? -th : 0;
      const c: XY = [P[0] + L * Math.sin(a), P[1] + L * Math.cos(a)];
      shapes.push({ kind: 'ball', id: `ball${i + 1}`, c, r: rad });
      links.push({ kind: 'rope', from: 'ceiling', fromP: P, to: `ball${i + 1}`, toP: [c[0] - rad * Math.sin(a), c[1] - rad * Math.cos(a)] });
    }
    return { title: "Three balls hanging side by side, the first pulled back (Newton's cradle)", tests: 'three ropes, touching balls', shapes, links };
  },
  vertical_spring(r) {
    const P: XY = [600, 110];
    const len = between(r, 260, 380);
    const w = between(r, 90, 120);
    const h = between(r, 70, 90);
    const c: XY = [600, 110 + len + h / 2];
    const k = pick(r, [10, 20, 40]);
    const kg = pick(r, [0.5, 1, 2]);
    return {
      title: 'A mass hanging from a spring',
      tests: 'vertical spring from the ceiling, mass and k labels',
      shapes: [ceiling(), { kind: 'box', id: 'mass', c, w, h, angle: 0 }],
      links: [{ kind: 'spring', from: 'ceiling', fromP: P, to: 'mass', toP: [600, c[1] - h / 2], k, text: `k = ${k} N/m`, textAt: [760, 110 + len / 2] }],
      labels: [{ on: 'mass', text: massText(kg), at: [c[0] + w / 2 + 70, c[1]], massKg: kg }],
    };
  },
};

function mirror(p: Parts): Parts {
  const fx = (q: XY): XY => [1200 - q[0], q[1]];
  return {
    ...p,
    shapes: p.shapes.map((s) =>
      s.kind === 'surface'
        ? { ...s, pts: s.pts.map(fx), hatch: s.hatch ? ((-s.hatch) as 1 | -1) : undefined }
        : s.kind === 'box'
          ? { ...s, c: fx(s.c), angle: -s.angle }
          : { ...s, c: fx(s.c) },
    ),
    labels: p.labels?.map((l) => ({ ...l, at: fx(l.at) })),
    arrows: p.arrows?.map((a) => ({ ...a, tip: fx(a.tip), textAt: a.textAt && fx(a.textAt) })),
    links: p.links?.map((l) => ({ ...l, fromP: fx(l.fromP), toP: fx(l.toP), textAt: l.textAt && fx(l.textAt) })),
    measures: p.measures?.map((m) => ({ ...m, a: fx(m.a), b: fx(m.b), offset: [-m.offset[0], m.offset[1]] as XY })),
  };
}

function build(id: string, parts: Parts, st: Style, extra: Partial<Doodle> = {}): Doodle {
  return { id, physics: true, ...parts, labels: parts.labels ?? [], arrows: parts.arrows ?? [], links: parts.links ?? [], measures: parts.measures ?? [], style: st, ...extra } as Doodle;
}

export interface Case {
  doodle: Doodle;
  seed: number;
  split: 'dev' | 'test';
}

export function allCases(): Case[] {
  const out: Case[] = [];
  let seed = 1000;
  for (const name of Object.keys(T)) {
    for (let v = 0; v < 3; v++) {
      seed += 17;
      const r = rng(seed);
      let parts = T[name]!(r);
      if (r() < 0.4 && name !== 'cradle') parts = mirror(parts);
      const st = style(r, v === 2 && r() < 0.5 ? { screen: true, rot: 0, blur: 0, paper: 'plain' } : {});
      out.push({ doodle: build(`${name}-${v + 1}`, parts, st), seed, split: v === 0 ? 'dev' : 'test' });
    }
  }
  // Not physics: the reader must say so instead of inventing a scene.
  const neg = (id: string, title: string, extra: Doodle['extra']) => {
    seed += 17;
    const r = rng(seed);
    out.push({ doodle: { id, title, tests: 'not a physics drawing', physics: false, shapes: [], labels: [], arrows: [], links: [], measures: [], extra, style: style(r) }, seed, split: 'test' });
  };
  neg('not-physics-house', 'A house with a tree and the sun', {
    lines: [
      [[300, 800], [300, 500], [600, 500], [600, 800], [300, 800]],
      [[270, 510], [450, 330], [630, 510]],
      [[420, 800], [420, 660], [490, 660], [490, 800]],
      [[800, 800], [800, 620]],
      ...Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return [[950 + Math.cos(a) * 80, 200 + Math.sin(a) * 80], [950 + Math.cos(a) * 120, 200 + Math.sin(a) * 120]] as XY[];
      }),
      [[60, 800], [1140, 800]],
    ],
    circles: [{ c: [950, 200], r: 60 }, { c: [800, 560], r: 70 }],
  });
  neg('not-physics-list', 'A handwritten shopping list', {
    texts: [
      { at: [400, 150], text: 'Shopping', size: 44 },
      { at: [400, 250], text: '- milk' },
      { at: [400, 320], text: '- eggs (12)' },
      { at: [400, 390], text: '- apples 2 kg' },
      { at: [400, 460], text: '- bread' },
      { at: [400, 530], text: '- rice 5 kg' },
    ],
  });
  neg('not-physics-tictactoe', 'A game of noughts and crosses', {
    lines: [
      [[500, 200], [500, 740]],
      [[700, 200], [700, 740]],
      [[320, 380], [880, 380]],
      [[320, 560], [880, 560]],
      [[350, 230], [470, 350]],
      [[470, 230], [350, 350]],
      [[730, 590], [850, 710]],
      [[850, 590], [730, 710]],
    ],
    circles: [{ c: [600, 470], r: 60 }, { c: [410, 650], r: 55 }],
  });
  neg('not-physics-blank', 'A blank page', {});

  // Hard cases: expected to trip the reader sometimes.
  const hard = (id: string, name: string, tests: string, st: Partial<Style>, extra: Partial<Doodle> = {}) => {
    seed += 17;
    const r = rng(seed);
    out.push({ doodle: build(id, { ...T[name]!(r), tests }, style(r, st), { hard: true, ...extra }), seed, split: 'test' });
  };
  hard('hard-faint', 'ramp_ball', 'very faint pencil', { ink: 'faint', paper: 'plain' });
  hard('hard-rotated', 'pendulum', 'photo rotated 14° and small in the frame', { rot: 14, scale: 0.75, dx: 0.05 });
  hard('hard-crossed', 'collision', 'a crossed-out ball that must be ignored', {}, { extra: { crossed: [{ kind: 'ball', id: 'old', c: [560, 500], r: 40 }] } });
  hard('hard-portrait', 'stack', 'portrait photo with the page small in the middle', { portrait: true, scale: 0.95 });
  {
    seed += 17;
    const r = rng(seed);
    // A curved ramp: a quarter circle from the top left down to the floor.
    const pts: XY[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * (Math.PI / 2);
      pts.push([120 + 520 * Math.sin(a), 280 + 520 * (1 - Math.cos(a))]);
    }
    const rad = 30;
    const a0 = 0.18;
    const p0: XY = [120 + 520 * Math.sin(a0), 280 + 520 * (1 - Math.cos(a0))];
    // Outward normal of the curve (away from the circle centre at (120, 800)).
    const c: XY = [p0[0] + rad * Math.sin(a0), p0[1] - rad * Math.cos(a0)];
    out.push({
      doodle: build(
        'hard-curve',
        {
          title: 'A ball on a curved ramp',
          tests: 'a curved surface that must be followed with many points',
          shapes: [floorLine(), { kind: 'surface', id: 'curve', pts }, { kind: 'ball', id: 'ball', c, r: rad }],
          labels: [{ on: 'ball', text: '1 kg', at: [c[0] + 80, c[1] - 40], massKg: 1 }],
        },
        style(r),
        { hard: true },
      ),
      seed,
      split: 'test',
    });
  }
  return out;
}

/** Clean drawings for the app's sample buttons (separate seeds from the eval set). */
export function sampleCases(): Case[] {
  const make = (id: string, name: string, seed: number, st: Partial<Style>, mirrorIt = false): Case => {
    const r = rng(seed);
    let parts = T[name]!(r);
    if (mirrorIt) parts = mirror(parts);
    return { doodle: build(id, parts, style(r, { blur: 0.3, light: 0.5, rot: 1.2, scale: 0.97, dx: 0, dy: 0, ink: 'pencil', ...st })), seed, split: 'dev' };
  };
  return [
    make('sample-ramp', 'ramp_box', 7, { paper: 'grid', font: 'Ink Free' }),
    make('sample-pendulum', 'pendulum', 11, { paper: 'plain', font: 'Ink Free' }),
    make('sample-collision', 'collision', 23, { paper: 'ruled', font: 'Segoe Script' }),
    make('sample-seesaw', 'seesaw', 5, { paper: 'cream', font: 'Ink Free' }),
    make('sample-cradle', 'cradle', 31, { paper: 'grid', font: 'Comic Sans MS' }),
    make('sample-tower', 'stack', 41, { paper: 'plain', font: 'Ink Free' }),
  ];
}
