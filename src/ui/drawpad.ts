/** Draw a doodle on screen with a finger, pen or mouse, then read it like a photo. */

type Op = { kind: 'line'; erase: boolean; pts: [number, number][] } | { kind: 'text'; at: [number, number]; text: string };

export const PAD_W = 1200;
export const PAD_H = 900;

export class DrawPad {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ops: Op[] = [];
  private current: Op | null = null;
  tool: 'pencil' | 'eraser' | 'label' = 'pencil';
  onChange: () => void = () => {};

  constructor(canvas: HTMLCanvasElement, private labelLayer: HTMLElement) {
    this.canvas = canvas;
    canvas.width = PAD_W;
    canvas.height = PAD_H;
    this.ctx = canvas.getContext('2d')!;
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', () => this.up());
    canvas.addEventListener('pointercancel', () => this.up());
    this.redraw();
  }

  get empty() {
    return this.ops.length === 0;
  }

  private at(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * PAD_W, ((e.clientY - r.top) / r.height) * PAD_H];
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    if (this.tool === 'label') {
      this.askLabel(e);
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.current = { kind: 'line', erase: this.tool === 'eraser', pts: [this.at(e)] };
    this.ops.push(this.current);
    this.redraw();
  }

  private move(e: PointerEvent) {
    if (!this.current || this.current.kind !== 'line') return;
    for (const ce of e.getCoalescedEvents?.() ?? [e]) this.current.pts.push(this.at(ce));
    this.redraw();
  }

  private up() {
    if (this.current) this.onChange();
    this.current = null;
  }

  private askLabel(e: PointerEvent) {
    const at = this.at(e);
    const r = this.canvas.getBoundingClientRect();
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'pad-label';
    input.placeholder = '2 kg';
    input.setAttribute('aria-label', 'Label text, for example 2 kg or μ = 0.3');
    input.style.left = `${e.clientX - r.left}px`;
    input.style.top = `${e.clientY - r.top}px`;
    this.labelLayer.append(input);
    input.focus();
    const done = (keep: boolean) => {
      const text = input.value.trim();
      input.remove();
      if (keep && text) {
        this.ops.push({ kind: 'text', at, text: text.slice(0, 24) });
        this.redraw();
        this.onChange();
      }
    };
    input.addEventListener('keydown', (k) => {
      if (k.key === 'Enter') done(true);
      if (k.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(true));
  }

  undo() {
    this.ops.pop();
    this.redraw();
    this.onChange();
  }

  clear() {
    this.ops = [];
    this.redraw();
    this.onChange();
  }

  private redraw() {
    const { ctx } = this;
    ctx.fillStyle = '#fbfdf9';
    ctx.fillRect(0, 0, PAD_W, PAD_H);
    ctx.strokeStyle = 'rgba(120, 165, 125, 0.28)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= PAD_W; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, PAD_H);
      ctx.stroke();
    }
    for (let y = 0; y <= PAD_H; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(PAD_W, y + 0.5);
      ctx.stroke();
    }
    for (const op of this.ops) {
      if (op.kind === 'text') {
        ctx.save();
        ctx.font = '500 34px "Recursive Variable", system-ui, sans-serif';
        ctx.fillStyle = '#34363b';
        ctx.textBaseline = 'middle';
        ctx.fillText(op.text, op.at[0], op.at[1]);
        ctx.restore();
        continue;
      }
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = op.erase ? '#fbfdf9' : 'rgba(46, 48, 54, 0.9)';
      ctx.lineWidth = op.erase ? 34 : 4;
      ctx.beginPath();
      op.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (op.pts.length === 1) ctx.lineTo(op.pts[0]![0] + 0.1, op.pts[0]![1]);
      ctx.stroke();
      ctx.restore();
    }
  }
}
