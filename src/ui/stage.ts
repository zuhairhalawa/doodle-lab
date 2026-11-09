/**
 * The page the experiment runs on: the photo with the moving lines lifted
 * off it, the engine's motion, strobe trails, the AI's reading drawn in blue
 * ink, the student's prediction (highlighter) and the result (red pencil).
 */
import { boxCorners } from '../scene/geometry.ts';
import type { P, Scene } from '../scene/types.ts';
import { RestWatch, type Sample, energy, sample } from '../sim/measure.ts';
import { type Sim, buildSim } from '../sim/world.ts';
import { type Cutouts, cutOut } from './cutout.ts';

export const INK = '#2448c8';
export const MARK = '#f2d43c';
export const RED = '#c8362c';

export interface Tick {
  time: number;
  energy: { kinetic: number; potential: number; spring: number };
  samples: Map<string, Sample[]>;
  running: boolean;
  rested: boolean;
}

interface Ghost {
  id: string;
  x: number;
  y: number;
  angle: number;
}

const MAX_TIME = 20;

export class Stage {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private photo: HTMLCanvasElement;
  scene: Scene;
  private cut: Cutouts;
  sim: Sim;
  private raf = 0;
  private last = 0;
  running = false;
  slow = false;
  strobe = true;
  showReading = true;
  /** 0..1 while the reading is being revealed. */
  reveal = 1;
  prediction: P | null = null;
  result: P | null = null;
  selected: string | null = null;
  private ghosts: Ghost[] = [];
  private lastGhost = -1;
  samples = new Map<string, Sample[]>();
  private rest = new RestWatch(0.8);
  rested = false;
  onTick: (t: Tick) => void = () => {};
  onStop: (why: 'rest' | 'time') => void = () => {};

  constructor(canvas: HTMLCanvasElement, photo: HTMLCanvasElement, scene: Scene) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.photo = photo;
    canvas.width = photo.width;
    canvas.height = photo.height;
    this.scene = scene;
    this.cut = cutOut(photo, scene);
    this.sim = buildSim(scene, { pageFloor: true });
    this.selected = scene.bodies.find((b) => b.dynamic)?.id ?? null;
    this.draw();
  }

  /** Swap in an edited scene (new mass, friction, ...) and start over. */
  setScene(scene: Scene) {
    const geometryChanged = JSON.stringify(scene.bodies.map((b) => [b.x, b.y, b.r, b.w, b.h, b.angle])) !== JSON.stringify(this.scene.bodies.map((b) => [b.x, b.y, b.r, b.w, b.h, b.angle]));
    this.scene = scene;
    if (geometryChanged) this.cut = cutOut(this.photo, scene);
    this.reset();
  }

  reset() {
    this.pause();
    this.sim = buildSim(this.scene, { pageFloor: true });
    this.ghosts = [];
    this.lastGhost = -1;
    this.samples = new Map();
    this.rest = new RestWatch(0.8);
    this.rested = false;
    this.result = null;
    this.draw();
    this.emit();
  }

  play() {
    if (this.running || !this.scene.runnable) return;
    if (this.rested || this.sim.time >= MAX_TIME) this.reset();
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(1 / 30, (now - this.last) / 1000) * (this.slow ? 0.25 : 1);
      this.last = now;
      this.advance(dt);
      this.draw();
      this.emit();
      if (this.running) this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Run without drawing (used for the hero and for tests). */
  advance(dt: number) {
    this.sim.step(dt);
    const t = this.sim.time;
    for (const b of this.scene.bodies) {
      if (!b.dynamic) continue;
      const s = sample(this.sim, b.id);
      if (!s) continue;
      const list = this.samples.get(b.id) ?? [];
      const prev = list[list.length - 1];
      if (!prev || s.t - prev.t >= 1 / 60) list.push(s);
      this.samples.set(b.id, list);
    }
    if (Math.floor(t * 8) !== this.lastGhost) {
      this.lastGhost = Math.floor(t * 8);
      for (const [id, body] of this.sim.bodies) {
        if (!body.isDynamic()) continue;
        const p = this.sim.toImage(body.getPosition());
        this.ghosts.push({ id, x: p.x, y: p.y, angle: body.getAngle() });
      }
      if (this.ghosts.length > 600) this.ghosts.splice(0, this.ghosts.length - 600);
    }
    if (this.rest.update(this.sim, dt) && t > 0.3) {
      this.rested = true;
      this.finish('rest');
    } else if (t >= MAX_TIME) this.finish('time');
  }

  private finish(why: 'rest' | 'time') {
    this.pause();
    if (this.selected) {
      const b = this.sim.bodies.get(this.selected);
      if (b) this.result = this.sim.toImage(b.getPosition());
    }
    this.draw();
    this.emit();
    this.onStop(why);
  }

  private emit() {
    this.onTick({ time: this.sim.time, energy: energy(this.sim), samples: this.samples, running: this.running, rested: this.rested });
  }

  /** Canvas pixel from a pointer event. */
  toImage(ev: { clientX: number; clientY: number }): P {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * this.canvas.width, y: ((ev.clientY - r.top) / r.height) * this.canvas.height };
  }

  /** Which moving body is under an image point, if any. */
  hit(p: P): string | null {
    for (const [id, body] of this.sim.bodies) {
      if (!body.isDynamic()) continue;
      const b = this.scene.bodies.find((x) => x.id === id)!;
      const c = this.sim.toImage(body.getPosition());
      const reach = b.kind === 'ball' ? b.r : Math.hypot(b.w, b.h) / 2;
      if (Math.hypot(p.x - c.x, p.y - c.y) <= reach + 8) return id;
    }
    return null;
  }

  draw() {
    const { ctx, scene, sim, cut } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const unit = Math.min(W, H) / 600;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(cut.background, 0, 0);

    // Strobe: faint copies of each moving drawing, eight times a second.
    if (this.strobe) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      for (const g of this.ghosts) this.sprite(g.id, g.x, g.y, g.angle);
      ctx.restore();
    }

    // Ropes, rods and springs between their current ends.
    scene.joints.forEach((j, i) => {
      const joint = sim.joints[i];
      const pa = joint ? sim.toImage(joint.getAnchorA()) : j.aPoint;
      const pb = joint ? sim.toImage(joint.getAnchorB()) : j.bPoint;
      ctx.save();
      ctx.strokeStyle = cut.ink;
      ctx.lineWidth = 2.2 * unit;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (j.kind === 'spring') zigzag(ctx, pa, pb, 7 * unit + 4);
      else if (j.kind === 'pin') {
        ctx.fillStyle = cut.ink;
        ctx.beginPath();
        ctx.arc(pa.x, pa.y, 4 * unit, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
      ctx.restore();
    });

    // The user's own drawings, where the engine says they are now.
    for (const [id, body] of sim.bodies) {
      if (!body.isDynamic()) continue;
      const p = sim.toImage(body.getPosition());
      this.sprite(id, p.x, p.y, body.getAngle());
      if (id === this.selected && !this.running && scene.bodies.filter((b) => b.dynamic).length > 1) {
        ctx.save();
        ctx.strokeStyle = INK;
        ctx.setLineDash([5 * unit, 5 * unit]);
        ctx.lineWidth = 1.5 * unit;
        const sb = scene.bodies.find((x) => x.id === id)!;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (sb.kind === 'ball' ? sb.r : Math.hypot(sb.w, sb.h) / 2) + 10 * unit, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (this.showReading && sim.time === 0) this.drawReading(unit);
    if (this.prediction) mark(ctx, this.prediction, MARK, 'your guess', unit, true);
    if (this.result && this.prediction) mark(ctx, this.result, RED, 'engine', unit, false);
  }

  private sprite(id: string, x: number, y: number, angle: number) {
    const s = this.cut.sprites.get(id);
    const b = this.scene.bodies.find((v) => v.id === id);
    if (!s || !b) return;
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    // Engine angles are counterclockwise; canvas rotation is clockwise.
    ctx.rotate(-(angle - b.angle));
    ctx.drawImage(s.canvas, -s.cx, -s.cy);
    ctx.restore();
  }

  /** The AI's reading, in blue ink, drawn over the photo before the run. */
  private drawReading(unit: number) {
    const { ctx, scene } = this;
    const items: (() => void)[] = [];
    ctx.save();
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = 2 * unit;
    ctx.font = `600 ${15 * unit}px "Recursive Variable", system-ui, sans-serif`;
    for (const b of scene.bodies) {
      items.push(() => {
        ctx.setLineDash(b.dynamic ? [] : [6 * unit, 4 * unit]);
        ctx.beginPath();
        if (b.kind === 'ball') ctx.arc(b.x, b.y, b.r + 5 * unit, 0, Math.PI * 2);
        else if (b.kind === 'box') {
          const cs = boxCorners({ ...b, w: b.w + 10 * unit, h: b.h + 10 * unit });
          ctx.moveTo(cs[0]!.x, cs[0]!.y);
          for (const c of cs.slice(1)) ctx.lineTo(c.x, c.y);
          ctx.closePath();
        } else if (b.kind === 'surface') {
          ctx.moveTo(b.points[0]!.x, b.points[0]!.y);
          for (const p of b.points.slice(1)) ctx.lineTo(p.x, p.y);
        } else ctx.arc(b.x, b.y, 6 * unit, 0, Math.PI * 2);
        ctx.globalAlpha = b.kind === 'surface' ? 0.55 : 0.9;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.setLineDash([]);
        if (b.kind === 'ball' || b.kind === 'box') {
          const top = b.kind === 'ball' ? b.y - b.r : Math.min(...boxCorners(b).map((c) => c.y));
          const bits = [b.id, `${b.massKg} kg`];
          if (b.frictionFromLabel) bits.push(`μ ${b.friction}`);
          ctx.textAlign = 'center';
          ctx.fillText(bits.join(' · '), b.x, top - 12 * unit);
          if (b.hasArrow) {
            const m = 1 / scene.mpp;
            const s = 0.25; // draw 0.25 s of travel
            arrowTo(ctx, { x: b.x, y: b.y }, { x: b.x + b.vx * m * s, y: b.y - b.vy * m * s }, unit);
          }
        }
      });
    }
    for (const j of scene.joints) {
      items.push(() => {
        ctx.setLineDash([3 * unit, 4 * unit]);
        ctx.beginPath();
        ctx.moveTo(j.aPoint.x, j.aPoint.y);
        ctx.lineTo(j.bPoint.x, j.bPoint.y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (j.kind === 'spring') {
          ctx.textAlign = 'center';
          ctx.fillText(`k ${j.stiffness} N/m`, (j.aPoint.x + j.bPoint.x) / 2 + 30 * unit, (j.aPoint.y + j.bPoint.y) / 2 - 18 * unit);
        }
      });
    }
    const n = Math.ceil(items.length * this.reveal);
    for (const f of items.slice(0, n)) f();
    ctx.restore();
  }
}

function zigzag(ctx: CanvasRenderingContext2D, a: P, b: P, amp: number) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const lead = Math.min(14, len * 0.12);
  const coils = 10;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(a.x + ux * lead, a.y + uy * lead);
  for (let i = 0; i < coils; i++) {
    const t = lead + ((len - 2 * lead) * (i + 0.5)) / coils;
    const s = i % 2 ? -1 : 1;
    ctx.lineTo(a.x + ux * t - uy * amp * s, a.y + uy * t + ux * amp * s);
  }
  ctx.lineTo(b.x - ux * lead, b.y - uy * lead);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

function arrowTo(ctx: CanvasRenderingContext2D, a: P, b: P, unit: number) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  for (const s of [1, -1]) {
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - Math.cos(ang + s * 0.45) * 12 * unit, b.y - Math.sin(ang + s * 0.45) * 12 * unit);
  }
  ctx.stroke();
}

function mark(ctx: CanvasRenderingContext2D, p: P, colour: string, text: string, unit: number, highlighter: boolean) {
  ctx.save();
  ctx.lineCap = 'round';
  if (highlighter) {
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 16 * unit, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#7a6400';
  } else ctx.strokeStyle = colour;
  ctx.lineWidth = 3 * unit;
  const r = 10 * unit;
  ctx.beginPath();
  ctx.moveTo(p.x - r, p.y - r);
  ctx.lineTo(p.x + r, p.y + r);
  ctx.moveTo(p.x + r, p.y - r);
  ctx.lineTo(p.x - r, p.y + r);
  ctx.stroke();
  ctx.font = `600 ${14 * unit}px "Recursive Variable", system-ui, sans-serif`;
  ctx.fillStyle = highlighter ? '#5c4b00' : colour;
  ctx.textAlign = 'left';
  ctx.fillText(text, p.x + 20 * unit, p.y + 5 * unit);
  ctx.restore();
}
