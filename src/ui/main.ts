import '@fontsource-variable/recursive/full.css';
import './style.css';
import { type InkMap, inkMap, refine } from '../read/refine.ts';
import { type ModelReading, fromModel } from '../read/schema.ts';
import type { Body, Scene } from '../scene/types.ts';
import { validate } from '../scene/validate.ts';
import { type FormulaCheck, formulaChecks, periodFrom } from '../sim/measure.ts';
import { type ReadResult, readDrawing, savedReading } from './api.ts';
import { DrawPad } from './drawpad.ts';
import { type Picture, fromBlob, fromSource, fromUrl } from './input.ts';
import { INK, RED, Stage, type Tick } from './stage.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const SAMPLES = [
  { id: 'sample-ramp', name: 'Block on a ramp' },
  { id: 'sample-pendulum', name: 'Pendulum' },
  { id: 'sample-collision', name: 'Two balls collide' },
  { id: 'sample-seesaw', name: 'Seesaw' },
  { id: 'sample-cradle', name: "Newton's cradle" },
  { id: 'sample-tower', name: 'Knock down a tower' },
];

// ---------------------------------------------------------------------------
// From the AI's answer to a checked scene: snap to the pencil lines, then validate.

const inkCache = new WeakMap<HTMLCanvasElement, InkMap>();
function inkOf(canvas: HTMLCanvasElement): InkMap {
  let m = inkCache.get(canvas);
  if (!m) {
    const { data } = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
    const grey = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < grey.length; i++) grey[i] = Math.round(0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!);
    m = inkMap(grey, canvas.width, canvas.height);
    inkCache.set(canvas, m);
  }
  return m;
}

export function sceneFrom(raw: ModelReading, canvas: HTMLCanvasElement): Scene {
  const flat = fromModel(raw);
  const snapped = flat ? refine(flat, inkOf(canvas)) : null;
  const sc = validate(snapped?.reading ?? flat, canvas.width, canvas.height);
  if (snapped?.moved.length && sc.runnable) {
    sc.notes.unshift({ level: 'fixed', text: `Snapped to your pencil lines: ${snapped.moved.map((m) => `${m.id} (${Math.round(m.by)} px)`).join(', ')}.` });
  }
  return sc;
}

// ---------------------------------------------------------------------------
// State
let stage: Stage | null = null;
let picture: Picture | null = null;
let sampleId: string | null = null;
let result: ReadResult | null = null;
let scene: Scene | null = null;
let checks: FormulaCheck[] = [];
let predicting = false;
let reading: AbortController | null = null;
let startEnergy = 0;

const sections = { home: $('home'), pad: $('pad'), lab: $('lab') };
function show(which: keyof typeof sections) {
  for (const [k, el] of Object.entries(sections)) el.hidden = k !== which;
  $('how').hidden = which === 'pad';
  if (which !== 'home') hero?.pause();
  else if (hero && !reduceMotion) hero.play();
  window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
}

function status(text: string, tone: 'info' | 'error' = 'info') {
  const el = $('stage-status');
  el.textContent = text;
  el.dataset.tone = tone;
}

// ---------------------------------------------------------------------------
// Home: samples and the live hero

const list = $('sample-list');
for (const s of SAMPLES) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sample';
  b.innerHTML = `<img src="/samples/${s.id}.jpg" alt="" loading="lazy" width="240" height="180"><span>${s.name}</span>`;
  b.addEventListener('click', () => void openSample(s.id));
  li.append(b);
  list.append(li);
}

let hero: Stage | null = null;
async function startHero() {
  try {
    const [pic, res] = await Promise.all([fromUrl('/samples/sample-ramp.jpg'), savedReading('sample-ramp')]);
    const sc = sceneFrom(res.raw, pic.canvas);
    hero = new Stage($<HTMLCanvasElement>('hero'), pic.canvas, sc);
    hero.strobe = true;
    hero.showReading = true;
    hero.onStop = () => {
      setTimeout(() => {
        if (!hero || sections.home.hidden) return;
        hero.reset();
        setTimeout(() => !sections.home.hidden && hero?.play(), 1200);
      }, 2500);
    };
    if (!reduceMotion) setTimeout(() => !sections.home.hidden && hero?.play(), 1400);
  } catch {
    $('hero-caption').textContent = 'The sample could not be loaded.';
  }
}
void startHero();

// ---------------------------------------------------------------------------
// Inputs

for (const id of ['camera', 'upload']) {
  $<HTMLInputElement>(id).addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const pic = await fromBlob(file);
      sampleId = null;
      void openPicture(pic, () => readDrawing(pic.jpeg, reading?.signal));
    } catch (err) {
      alertHome((err as Error).message);
    }
  });
}

function alertHome(text: string) {
  let el = document.querySelector<HTMLElement>('.home-error');
  if (!el) {
    el = document.createElement('p');
    el.className = 'home-error';
    el.setAttribute('role', 'alert');
    document.querySelector('.actions')!.after(el);
  }
  el.textContent = text;
}

async function openSample(id: string) {
  try {
    const pic = await fromUrl(`/samples/${id}.jpg`);
    sampleId = id;
    void openPicture(pic, () => savedReading(id));
  } catch (err) {
    alertHome((err as Error).message);
  }
}

// Draw pad.
const pad = new DrawPad($<HTMLCanvasElement>('pad-canvas'), $('pad-layer'));
pad.onChange = () => ($<HTMLButtonElement>('pad-read').disabled = pad.empty);
$('open-pad').addEventListener('click', () => show('pad'));
$('pad-cancel').addEventListener('click', () => show('home'));
$('pad-undo').addEventListener('click', () => pad.undo());
$('pad-clear').addEventListener('click', () => pad.clear());
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) {
  b.addEventListener('click', () => {
    pad.tool = b.dataset.tool as DrawPad['tool'];
    for (const o of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) o.setAttribute('aria-pressed', String(o === b));
  });
}
$('pad-read').addEventListener('click', () => {
  const pic = fromSource(pad.canvas, pad.canvas.width, pad.canvas.height);
  sampleId = null;
  void openPicture(pic, () => readDrawing(pic.jpeg, reading?.signal));
});

$('new').addEventListener('click', () => {
  reading?.abort();
  stage?.pause();
  show('home');
});
$('again').addEventListener('click', () => {
  if (!picture) return;
  const pic = picture;
  void openPicture(pic, () => readDrawing(pic.jpeg, reading?.signal));
});

// ---------------------------------------------------------------------------
// Reading

async function openPicture(pic: Picture, read: () => Promise<ReadResult>) {
  reading?.abort();
  reading = new AbortController();
  const mine = reading;
  stage?.pause();
  stage = null;
  picture = pic;
  show('lab');
  const canvas = $<HTMLCanvasElement>('stage');
  canvas.width = pic.width;
  canvas.height = pic.height;
  canvas.getContext('2d')!.drawImage(pic.canvas, 0, 0);
  setControls(false);
  $('readouts').hidden = true;
  clearSheet();
  $('scan').hidden = false;
  const started = performance.now();
  const timer = setInterval(() => status(`Gemini is reading your drawing… ${((performance.now() - started) / 1000).toFixed(0)} s`), 500);
  status('Gemini is reading your drawing…');
  try {
    const res = await read();
    if (mine !== reading) return;
    result = res;
    const sc = sceneFrom(res.raw, pic.canvas);
    setScene(sc, true);
  } catch (err) {
    if ((err as Error).name === 'AbortError' || mine !== reading) return;
    status((err as Error).message, 'error');
    $('what').textContent = '';
  } finally {
    clearInterval(timer);
    if (mine === reading) $('scan').hidden = true;
  }
}

function setScene(sc: Scene, fresh: boolean) {
  scene = sc;
  checks = formulaChecks(sc);
  if (fresh || !stage) {
    stage = new Stage($<HTMLCanvasElement>('stage'), picture!.canvas, sc);
    stage.onTick = onTick;
    stage.onStop = onStop;
    stage.strobe = $<HTMLInputElement>('strobe').checked;
    stage.slow = $<HTMLInputElement>('slow').checked;
    stage.showReading = $<HTMLInputElement>('show-read').checked;
    if (fresh && !reduceMotion) {
      // Let the reading appear in blue ink, one object at a time.
      stage.reveal = 0;
      const t0 = performance.now();
      const step = () => {
        if (!stage) return;
        stage.reveal = Math.min(1, (performance.now() - t0) / 1400);
        stage.draw();
        if (stage.reveal < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }
  } else {
    // A changed experiment needs a new guess.
    stage.prediction = null;
    stage.setScene(sc);
  }
  renderSheet();
  setControls(sc.runnable);
  $('readouts').hidden = !sc.runnable;
  startEnergy = 0;
  if (!sc.runnable) status(sc.notes.find((n) => n.level === 'problem')?.text ?? 'This drawing cannot run.', 'error');
  else {
    const moving = sc.bodies.filter((b) => b.dynamic).length;
    status(`Read ${moving} moving object${moving === 1 ? '' : 's'} and ${sc.bodies.filter((b) => b.kind === 'surface').length} surface${sc.bodies.filter((b) => b.kind === 'surface').length === 1 ? '' : 's'}. Press Run it, or Predict first.`);
  }
  stage.reset();
}

// ---------------------------------------------------------------------------
// Controls

function setControls(on: boolean) {
  for (const id of ['play', 'restart', 'predict']) $<HTMLButtonElement>(id).disabled = !on;
  playLabel(false);
}
function playLabel(running: boolean) {
  $('play').querySelector('span')!.textContent = running ? 'Pause' : stage && stage.sim.time > 0 && !stage.rested ? 'Continue' : 'Run it';
  $('play').classList.toggle('is-running', running);
}

$('play').addEventListener('click', () => {
  if (!stage) return;
  if (stage.running) stage.pause();
  else {
    if (predicting) togglePredict(false);
    stage.play();
    if (stage.running) status(stage.prediction ? 'Running. Watch where it ends up.' : 'Running. Tap a moving object to follow its speed.');
  }
  playLabel(stage.running);
});
$('restart').addEventListener('click', () => {
  stage?.reset();
  playLabel(false);
  if (scene?.runnable) status('Back at the start.');
});
$('predict').addEventListener('click', () => togglePredict(!predicting));
function togglePredict(on: boolean) {
  predicting = on;
  $('predict').setAttribute('aria-pressed', String(on));
  $('stage-wrap').classList.toggle('is-predicting', on);
  if (on && stage) {
    stage.reset();
    const name = stage.selected ?? 'it';
    status(`Tap the page where you think ${name} will come to rest.`);
  }
}
$<HTMLInputElement>('slow').addEventListener('change', (e) => stage && (stage.slow = (e.target as HTMLInputElement).checked));
$<HTMLInputElement>('strobe').addEventListener('change', (e) => {
  if (!stage) return;
  stage.strobe = (e.target as HTMLInputElement).checked;
  stage.draw();
});
$<HTMLInputElement>('show-read').addEventListener('change', (e) => {
  if (!stage) return;
  stage.showReading = (e.target as HTMLInputElement).checked;
  stage.draw();
});

$('stage').addEventListener('pointerdown', (e) => {
  if (!stage || !scene?.runnable) return;
  const p = stage.toImage(e);
  if (predicting) {
    stage.prediction = p;
    togglePredict(false);
    stage.draw();
    status('Guess marked in yellow. Press Run it to see where the engine puts it.');
    renderChecks();
    return;
  }
  const id = stage.hit(p);
  if (id) {
    stage.selected = id;
    stage.draw();
    renderGraph();
    status(`Following ${id}.`);
  }
});

document.addEventListener('keydown', (e) => {
  if (sections.lab.hidden || e.key !== ' ' || (e.target as HTMLElement).closest('input, textarea, button, select, summary')) return;
  e.preventDefault();
  $('play').click();
});

// ---------------------------------------------------------------------------
// Readouts

function onTick(t: Tick) {
  $('clock').textContent = t.time.toFixed(2);
  const e = t.energy;
  const total = e.kinetic + e.potential + e.spring;
  if (t.time === 0 || startEnergy === 0) startEnergy = total;
  const lost = Math.max(0, startEnergy - total);
  const parts = [
    { key: 'kinetic', label: 'Motion', value: e.kinetic, colour: INK },
    { key: 'potential', label: 'Height', value: e.potential, colour: '#6b6f78' },
    { key: 'spring', label: 'Spring', value: e.spring, colour: '#3d8a5a' },
    { key: 'lost', label: 'Lost to friction, collisions', value: lost, colour: RED },
  ].filter((p) => p.key !== 'spring' || scene?.joints.some((j) => j.kind === 'spring'));
  const sum = parts.reduce((s, p) => s + p.value, 0) || 1;
  $('energy-bar').innerHTML = parts.map((p) => `<span style="width:${(100 * p.value) / sum}%;background:${p.colour}" data-key="${p.key}"></span>`).join('');
  $('energy-bar').setAttribute('aria-label', parts.map((p) => `${p.label} ${p.value.toFixed(1)} joules`).join(', '));
  $('energy-key').innerHTML = parts.map((p) => `<li><i style="background:${p.colour}"></i>${p.label} <span class="num">${p.value.toFixed(1)} J</span></li>`).join('');
  playLabel(t.running);
  renderGraph();
  if (checks.length) updateMeasured();
}

function onStop(why: 'rest' | 'time') {
  playLabel(false);
  if (!stage) return;
  if (stage.prediction && stage.result && scene) {
    const d = Math.hypot(stage.prediction.x - stage.result.x, stage.prediction.y - stage.result.y) * scene.mpp;
    status(`${stage.selected} ${why === 'rest' ? 'came to rest' : 'was still moving after 20 s'}. Your guess was ${d < 1 ? `${Math.round(d * 100)} cm` : `${d.toFixed(2)} m`} away.`);
  } else status(why === 'rest' ? `Everything stopped after ${stage.sim.time.toFixed(1)} s.` : 'Stopped after 20 s.');
  renderChecks();
}

function renderGraph() {
  const c = $<HTMLCanvasElement>('graph');
  const ctx = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  ctx.clearRect(0, 0, W, H);
  const id = stage?.selected;
  const data = id ? (stage?.samples.get(id) ?? []) : [];
  const maxT = Math.max(4, data.at(-1)?.t ?? 0);
  const speeds = data.map((s) => Math.hypot(s.vx, s.vy));
  const maxV = Math.max(1, ...speeds) * 1.15;
  ctx.strokeStyle = 'rgba(60, 90, 70, 0.18)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= maxT; x++) {
    const px = 36 + ((W - 46) * x) / maxT;
    ctx.beginPath();
    ctx.moveTo(px, 8);
    ctx.lineTo(px, H - 22);
    ctx.stroke();
  }
  ctx.fillStyle = '#5b6157';
  ctx.font = '12px "Recursive Variable", system-ui';
  ctx.fillText(`${maxV.toFixed(1)} m/s`, 0, 16);
  ctx.fillText('0', 24, H - 22);
  ctx.fillText(`${maxT.toFixed(0)} s`, W - 26, H - 6);
  if (data.length > 1) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    data.forEach((s, i) => {
      const x = 36 + ((W - 46) * s.t) / maxT;
      const y = H - 22 - ((H - 32) * speeds[i]!) / maxV;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
  const now = speeds.at(-1) ?? 0;
  $('graph-label').textContent = id ? `Speed of ${id}: ${now.toFixed(2)} m/s` : '';
}

// ---------------------------------------------------------------------------
// Lab sheet

function clearSheet() {
  for (const id of ['what', 'meta', 'checks', 'objects', 'scale-row', 'notes', 'raw']) $(id).textContent = '';
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmt = (n: number) => String(Number(n.toFixed(3)));

function renderSheet() {
  if (!scene || !result) return;
  $('what').textContent = scene.whatIsIt;
  const when = result.source === 'saved' ? `Saved reading from ${result.model.split('@')[0]} on ${result.savedOn}.` : `Read just now by ${result.model.split('@')[0]} in ${(result.ms / 1000).toFixed(1)} s.`;
  $('meta').innerHTML = `${esc(when)}${result.source === 'saved' ? ' <button type="button" class="linkish" id="read-live">Read it live</button>' : ''}`;
  document.getElementById('read-live')?.addEventListener('click', () => $('again').click());
  $('raw').textContent = JSON.stringify(result.raw, null, 2);

  const movers = scene.bodies.filter((b) => b.dynamic);
  const fixed = scene.bodies.filter((b) => !b.dynamic && b.kind !== 'anchor');
  const tag = (fromLabel: boolean) => (fromLabel ? '<span class="tag tag-read" title="Written on the drawing">written</span>' : '<span class="tag" title="Not written; a default value">assumed</span>');
  const num = (body: Body, field: 'massKg' | 'friction' | 'bounce' | 'speed', value: number, step: string, min: string, max: string, label: string) =>
    `<input type="number" inputmode="decimal" step="${step}" min="${min}" max="${max}" value="${fmt(value)}" data-body="${esc(body.id)}" data-field="${field}" aria-label="${esc(label)}">`;
  // A μ written on a ramp applies to whatever slides on it, unless the object has its own.
  const surfaceMu = scene.bodies.filter((x) => x.kind === 'surface' && x.frictionFromLabel);
  const frictionCell = (b: Body) => {
    if (b.frictionFromLabel || !surfaceMu.length) return `${num(b, 'friction', b.friction, '0.05', '0', '1.5', `${b.id} friction coefficient`)}${tag(b.frictionFromLabel)}`;
    const from = surfaceMu.map((x) => `${x.id} ${fmt(x.friction)}`).join(', ');
    return `${num(b, 'friction', surfaceMu[0]!.friction, '0.05', '0', '1.5', `${b.id} friction coefficient`)}<span class="tag tag-read" title="Written next to the surface">from ${esc(from)}</span>`;
  };
  let html = '';
  if (movers.length) {
    html += `<table class="objects"><caption>Moving things</caption><thead><tr><th scope="col">Object</th><th scope="col">Mass (kg)</th><th scope="col">Friction μ</th><th scope="col">Bounce</th><th scope="col">Start speed (m/s)</th></tr></thead><tbody>`;
    for (const b of movers) {
      const speed = Math.hypot(b.vx, b.vy);
      html += `<tr><th scope="row"><span class="kind kind-${b.kind}" aria-hidden="true"></span>${esc(b.id)}${b.label ? `<small>"${esc(b.label)}"</small>` : ''}</th>
        <td data-label="Mass (kg)">${num(b, 'massKg', b.massKg, '0.1', '0.01', '1000', `${b.id} mass in kilograms`)}${tag(b.massFromLabel)}</td>
        <td data-label="Friction μ">${frictionCell(b)}</td>
        <td data-label="Bounce">${num(b, 'bounce', b.bounce, '0.05', '0', '1', `${b.id} bounce`)}${tag(b.bounceFromLabel)}</td>
        <td data-label="Start speed (m/s)">${b.hasArrow ? `${num(b, 'speed', speed, '0.5', '0', '60', `${b.id} starting speed`)}${tag(b.speedFromLabel)}` : '<span class="muted">at rest</span>'}</td></tr>`;
    }
    html += '</tbody></table>';
  }
  if (fixed.length) {
    html += `<p class="fixed-list"><strong>Fixed:</strong> ${fixed.map((b) => `${esc(b.id)}${b.frictionFromLabel ? ` (μ ${fmt(b.friction)})` : ''}`).join(', ')}.</p>`;
  }
  const springs = scene.joints.filter((j) => j.kind === 'spring');
  const others = scene.joints.filter((j) => j.kind !== 'spring');
  if (springs.length) {
    html += `<table class="objects"><caption>Springs</caption><thead><tr><th scope="col">On</th><th scope="col">k (N/m)</th><th scope="col">Rest length</th></tr></thead><tbody>`;
    scene.joints.forEach((j, i) => {
      if (j.kind !== 'spring') return;
      html += `<tr><th scope="row">${esc(j.b)}</th><td><input type="number" step="1" min="0.5" max="100000" value="${fmt(j.stiffness)}" data-joint="${i}" data-field="stiffness" aria-label="Spring constant on ${esc(j.b)}">${tag(j.stiffnessFromLabel)}</td>
        <td><input type="number" step="5" min="20" max="300" value="${Math.round(j.restScale * 100)}" data-joint="${i}" data-field="restScale" aria-label="Spring rest length as a percentage of the drawn length"> % of drawn</td></tr>`;
    });
    html += '</tbody></table>';
  }
  if (others.length) html += `<p class="fixed-list"><strong>Links:</strong> ${others.map((j) => `${j.kind} ${j.a ? `${esc(j.a)} to ` : ''}${esc(j.b)}`).join(', ')}.</p>`;
  $('objects').innerHTML = html;

  const pageW = scene.mpp * scene.width;
  $('scale-row').innerHTML = `<label>Page width <input type="number" step="0.1" min="0.05" max="200" value="${fmt(pageW)}" id="page-width" aria-label="Page width in meters"> m</label> ${tag(scene.scaleFromLabel)}<span class="muted">${scene.scaleFromLabel ? ' from the length written on the drawing' : ' no length written, so this is a guess'}</span>`;

  const icon = { fixed: 'Fixed', assumed: 'Assumed', dropped: 'Left out', problem: 'Problem' };
  $('notes').innerHTML = scene.notes.length ? scene.notes.map((n) => `<li data-level="${n.level}"><strong>${icon[n.level]}:</strong> ${esc(n.text)}</li>`).join('') : '<li>Nothing needed changing.</li>';
  renderChecks();
}

$('objects').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (!scene || input.tagName !== 'INPUT') return;
  const v = Number(input.value);
  if (!Number.isFinite(v)) return;
  const next = structuredClone(scene);
  const clampTo = (x: number) => Math.min(Number(input.max), Math.max(Number(input.min), x));
  if (input.dataset.body) {
    const b = next.bodies.find((x) => x.id === input.dataset.body)!;
    const f = input.dataset.field;
    if (f === 'massKg') b.massKg = clampTo(v);
    if (f === 'friction') {
      b.friction = clampTo(v);
      b.frictionFromLabel = true;
    }
    if (f === 'bounce') b.bounce = clampTo(v);
    if (f === 'speed') {
      const s = Math.hypot(b.vx, b.vy) || 1;
      b.vx = (b.vx / s) * clampTo(v);
      b.vy = (b.vy / s) * clampTo(v);
    }
  } else if (input.dataset.joint) {
    const j = next.joints[Number(input.dataset.joint)]!;
    if (input.dataset.field === 'stiffness') j.stiffness = clampTo(v);
    else j.restScale = clampTo(v) / 100;
  }
  setScene(next, false);
  status('Changed. Press Run it to see the difference.');
});
$('scale-row').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  if (!scene || input.id !== 'page-width') return;
  const v = Math.min(200, Math.max(0.05, Number(input.value)));
  if (!Number.isFinite(v)) return;
  const next = structuredClone(scene);
  next.mpp = v / next.width;
  setScene(next, false);
  status(`The page is now ${fmt(v)} m wide. Bigger scenes move more slowly on screen.`);
});

function renderChecks() {
  const box = $('checks');
  if (!scene || !stage) {
    box.innerHTML = '';
    return;
  }
  let html = '';
  for (const c of checks) {
    html += `<div class="check" data-id="${esc(c.id)}"><p class="check-title">${esc(c.title)}</p>
      <p class="formula"><span>${esc(c.formula)}</span> = <span class="num">${c.predicted.toFixed(2)} s</span></p>
      <p class="muted">${esc(c.detail)}</p>
      <p class="measured">Engine: <span class="num" data-measured="${esc(c.id)}">run it to measure</span></p></div>`;
  }
  if (stage.prediction && stage.result) {
    const d = Math.hypot(stage.prediction.x - stage.result.x, stage.prediction.y - stage.result.y) * scene.mpp;
    html += `<div class="check check-guess"><p class="check-title">Your prediction</p><p>Your guess was <strong class="num">${d < 1 ? `${Math.round(d * 100)} cm` : `${d.toFixed(2)} m`}</strong> from where ${esc(stage.selected ?? '')} ended up.</p></div>`;
  }
  box.innerHTML = html;
  updateMeasured();
}

function updateMeasured() {
  if (!stage) return;
  for (const c of checks) {
    const el = document.querySelector<HTMLElement>(`[data-measured="${CSS.escape(c.id)}"]`);
    if (!el) continue;
    const T = periodFrom(stage.samples.get(c.id) ?? []);
    if (T === null) el.textContent = stage.sim.time > 0 ? 'measuring…' : 'run it to measure';
    else { const pct = ((T - c.predicted) / c.predicted) * 100; el.textContent = `${T.toFixed(2)} s (${Math.abs(pct) < 0.05 ? "matches" : `${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}% from`} the formula)`; }
  }
}

