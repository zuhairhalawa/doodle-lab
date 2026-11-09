/**
 * Draws a Doodle like a pencil sketch on paper, then "photographs" it:
 * a little rotation, a desk around the page, uneven light, grain and blur.
 * Runs in the browser (canvas 2D).
 */
import { type DBox, type DShape, type Doodle, type XY, PAPER_H, PAPER_W, boxCornersXY, frameSize, photoTransform } from './doodle.ts';

/** Small seeded random generator (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ctx = CanvasRenderingContext2D;

interface Pen {
  ctx: Ctx;
  rand: () => number;
  color: string;
  width: number;
  wobble: number;
  passes: number;
}

function inkOf(d: Doodle): { color: string; width: number; passes: number; wobble: number } {
  if (d.style.ink === 'pen') return { color: 'rgba(28, 48, 140, 0.92)', width: 2.2, passes: 1, wobble: 0.9 };
  if (d.style.ink === 'faint') return { color: 'rgba(120, 120, 128, 0.32)', width: 1.4, passes: 1, wobble: 1.2 };
  return { color: 'rgba(48, 48, 54, 0.78)', width: 2.1, passes: 2, wobble: 1.3 };
}

/** A hand-drawn polyline: smooth sideways wobble, slight overshoot, several light passes. */
function stroke(pen: Pen, pts: XY[], closed = false, overshoot = 3) {
  const { ctx, rand } = pen;
  for (let pass = 0; pass < pen.passes; pass++) {
    ctx.beginPath();
    ctx.strokeStyle = pen.color;
    ctx.lineWidth = pen.width * (0.8 + rand() * 0.4);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const path = closed ? [...pts, pts[0]!] : pts;
    let first = true;
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1]!;
      const [bx, by] = path[i]!;
      const len = Math.hypot(bx - ax, by - ay);
      const n = Math.max(2, Math.ceil(len / 14));
      const nx = -(by - ay) / (len || 1);
      const ny = (bx - ax) / (len || 1);
      const ph = rand() * Math.PI * 2;
      const amp = pen.wobble * (0.6 + rand());
      const os0 = i === 1 && !closed ? -overshoot * rand() : 0;
      const os1 = i === path.length - 1 && !closed ? overshoot * rand() : 0;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const ext = t === 0 ? os0 / (len || 1) : t === 1 ? os1 / (len || 1) : 0;
        const tt = t + ext;
        const w = Math.sin(ph + t * Math.PI * 1.7) * amp * Math.sin(Math.PI * t) + (rand() - 0.5) * 0.5;
        const x = ax + (bx - ax) * tt + nx * w;
        const y = ay + (by - ay) * tt + ny * w;
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }
}

function circle(pen: Pen, c: XY, r: number) {
  const { ctx, rand } = pen;
  for (let pass = 0; pass < pen.passes; pass++) {
    ctx.beginPath();
    ctx.strokeStyle = pen.color;
    ctx.lineWidth = pen.width * (0.8 + rand() * 0.4);
    const start = rand() * Math.PI * 2;
    const sweep = Math.PI * 2 + 0.15 + rand() * 0.3;
    const squash = 1 + (rand() - 0.5) * 0.06;
    const n = Math.max(24, Math.round(r / 2));
    for (let k = 0; k <= n; k++) {
      const a = start + (sweep * k) / n;
      const rr = r * (1 + Math.sin(a * 3 + pass) * 0.015 + (k / n) * 0.02 * (rand() - 0.5));
      const x = c[0] + Math.cos(a) * rr * squash;
      const y = c[1] + Math.sin(a) * rr;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function hatch(pen: Pen, pts: XY[], side: 1 | -1) {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!;
    const [bx, by] = pts[i]!;
    const len = Math.hypot(bx - ax, by - ay);
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    // Right of travel direction in screen coordinates.
    const nx = -uy * side * -1;
    const ny = ux * side * -1;
    for (let s = 10; s < len - 4; s += 16) {
      const p: XY = [ax + ux * s, ay + uy * s];
      stroke({ ...pen, passes: 1, width: pen.width * 0.7 }, [p, [p[0] + nx * 12 - ux * 9, p[1] + ny * 12 - uy * 9]], false, 0);
    }
  }
}

function text(pen: Pen, font: string, at: XY, s: string, size = 30) {
  const { ctx, rand } = pen;
  ctx.save();
  ctx.translate(at[0], at[1]);
  ctx.rotate((rand() - 0.5) * 0.08);
  ctx.font = `${size}px "${font}"`;
  ctx.fillStyle = pen.color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

function spring(pen: Pen, a: XY, b: XY) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const lead = Math.min(18, len * 0.12);
  const coils = Math.max(6, Math.round(len / 22));
  const amp = 12;
  const pts: XY[] = [a, [a[0] + ux * lead, a[1] + uy * lead]];
  for (let i = 0; i < coils; i++) {
    const t = lead + ((len - 2 * lead) * (i + 0.5)) / coils;
    const side = i % 2 ? -1 : 1;
    pts.push([a[0] + ux * t - uy * amp * side, a[1] + uy * t + ux * amp * side]);
  }
  pts.push([b[0] - ux * lead, b[1] - uy * lead], b);
  stroke(pen, pts, false, 0);
}

function arrow(pen: Pen, from: XY, tip: XY) {
  stroke(pen, [from, tip], false, 0);
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  for (const s of [1, -1]) stroke({ ...pen, passes: 1 }, [tip, [tip[0] - Math.cos(a + s * 0.45) * 18, tip[1] - Math.sin(a + s * 0.45) * 18]], false, 0);
}

function shape(pen: Pen, s: DShape) {
  if (s.kind === 'ball') {
    circle(pen, s.c, s.r);
    if (s.fixed) hatch(pen, [[s.c[0] - s.r, s.c[1]], [s.c[0] + s.r, s.c[1]]], 1);
  } else if (s.kind === 'box') {
    const cs = boxCornersXY(s as DBox);
    for (let i = 0; i < 4; i++) stroke(pen, [cs[i]!, cs[(i + 1) % 4]!], false, 4);
  } else if (s.kind === 'surface') {
    stroke(pen, s.pts, false, 4);
    if (s.hatch) hatch(pen, s.pts, s.hatch);
  } else {
    pen.ctx.beginPath();
    pen.ctx.fillStyle = pen.color;
    pen.ctx.arc(s.c[0], s.c[1], 5, 0, Math.PI * 2);
    pen.ctx.fill();
  }
}

function paper(ctx: Ctx, d: Doodle, rand: () => number) {
  const kind = d.style.paper;
  ctx.fillStyle = kind === 'cream' ? '#f3ecd9' : kind === 'grid' ? '#eef3ea' : '#f7f6f2';
  ctx.fillRect(0, 0, PAPER_W, PAPER_H);
  ctx.lineWidth = 1;
  if (kind === 'grid') {
    ctx.strokeStyle = 'rgba(110, 160, 120, 0.35)';
    for (let x = 0; x <= PAPER_W; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, PAPER_H);
      ctx.stroke();
    }
    for (let y = 0; y <= PAPER_H; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(PAPER_W, y + 0.5);
      ctx.stroke();
    }
  } else if (kind === 'ruled') {
    ctx.strokeStyle = 'rgba(80, 120, 200, 0.35)';
    for (let y = 60; y <= PAPER_H; y += 36) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(PAPER_W, y + 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(210, 80, 80, 0.4)';
    ctx.beginPath();
    ctx.moveTo(90.5, 0);
    ctx.lineTo(90.5, PAPER_H);
    ctx.stroke();
  }
  // Paper fibre: faint speckles.
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rand() * 0.04})`;
    ctx.fillRect(rand() * PAPER_W, rand() * PAPER_H, 1.5, 1.5);
  }
}

export function renderDoodle(d: Doodle, seed: number): HTMLCanvasElement {
  const rand = rng(seed);
  const sheet = document.createElement('canvas');
  sheet.width = PAPER_W;
  sheet.height = PAPER_H;
  const sc = sheet.getContext('2d')!;
  paper(sc, d, rand);
  const ink = inkOf(d);
  const pen: Pen = { ctx: sc, rand, ...ink };
  const font = d.style.font;

  for (const s of d.shapes) shape(pen, s);
  for (const l of d.links) {
    if (l.kind === 'spring') spring(pen, l.fromP, l.toP);
    else if (l.kind === 'pin') {
      sc.beginPath();
      sc.fillStyle = pen.color;
      sc.arc(l.fromP[0], l.fromP[1], 6, 0, Math.PI * 2);
      sc.fill();
    } else stroke(pen, [l.fromP, l.toP], false, 1);
    if (l.text && l.textAt) text(pen, font, l.textAt, l.text);
  }
  for (const a of d.arrows) {
    const s = d.shapes.find((x) => x.id === a.on)!;
    const c = 'c' in s ? s.c : a.tip;
    const r = s.kind === 'ball' ? s.r : s.kind === 'box' ? Math.max(s.w, s.h) / 2 : 0;
    const dx = a.tip[0] - c[0];
    const dy = a.tip[1] - c[1];
    const len = Math.hypot(dx, dy);
    arrow(pen, [c[0] + (dx / len) * (r + 4), c[1] + (dy / len) * (r + 4)], a.tip);
    if (a.text && a.textAt) text(pen, font, a.textAt, a.text);
  }
  for (const l of d.labels) text(pen, font, l.at, l.text);
  for (const m of d.measures) {
    const a: XY = [m.a[0] + m.offset[0], m.a[1] + m.offset[1]];
    const b: XY = [m.b[0] + m.offset[0], m.b[1] + m.offset[1]];
    const thin = { ...pen, passes: 1, width: pen.width * 0.7 };
    stroke(thin, [a, b], false, 0);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    for (const p of [a, b]) stroke(thin, [[p[0] - nx * 9, p[1] - ny * 9], [p[0] + nx * 9, p[1] + ny * 9]], false, 0);
    const mid: XY = [(a[0] + b[0]) / 2 + nx * 26, (a[1] + b[1]) / 2 + ny * 26];
    text(pen, font, mid, m.text, 28);
  }
  const ex = d.extra;
  if (ex) {
    for (const l of ex.lines ?? []) stroke(pen, l, false, 3);
    for (const c of ex.circles ?? []) circle(pen, c.c, c.r);
    for (const t of ex.texts ?? []) text(pen, font, t.at, t.text, t.size ?? 30);
    for (const s of ex.crossed ?? []) {
      shape(pen, s);
      const c = 'c' in s ? s.c : s.pts[0]!;
      const r = s.kind === 'ball' ? s.r : 40;
      const zig: XY[] = [];
      for (let i = 0; i < 9; i++) zig.push([c[0] - r * 1.1 + (i * 2.2 * r) / 8, c[1] + (i % 2 ? -r : r) * 0.9]);
      stroke({ ...pen, passes: 2, width: pen.width * 1.4 }, zig, false, 0);
    }
  }

  const [W, H] = frameSize(d.style);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const oc = out.getContext('2d')!;
  if (d.style.screen) {
    oc.fillStyle = '#ffffff';
    oc.fillRect(0, 0, W, H);
  } else {
    // Desk.
    const desk = oc.createLinearGradient(0, 0, W, H);
    desk.addColorStop(0, '#6b5b4b');
    desk.addColorStop(1, '#4f4337');
    oc.fillStyle = desk;
    oc.fillRect(0, 0, W, H);
  }
  const m = photoTransform(d.style, W, H);
  oc.save();
  oc.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  if (!d.style.screen) {
    oc.shadowColor = 'rgba(0,0,0,0.35)';
    oc.shadowBlur = 18;
    oc.shadowOffsetY = 6;
  }
  oc.filter = d.style.blur > 0 ? `blur(${d.style.blur}px)` : 'none';
  oc.drawImage(sheet, 0, 0);
  oc.restore();
  if (!d.style.screen) {
    // Uneven light: one corner darker, plus a soft shadow band.
    const g = oc.createRadialGradient(W * (0.3 + rand() * 0.4), H * (0.3 + rand() * 0.3), W * 0.1, W / 2, H / 2, W * 0.85);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, `rgba(40,30,20,${0.25 * d.style.light})`);
    oc.fillStyle = g;
    oc.fillRect(0, 0, W, H);
    // Grain.
    const img = oc.getImageData(0, 0, W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rand() - 0.5) * 10;
      img.data[i] = img.data[i]! + n;
      img.data[i + 1] = img.data[i + 1]! + n;
      img.data[i + 2] = img.data[i + 2]! + n;
    }
    oc.putImageData(img, 0, 0);
  }
  return out;
}
