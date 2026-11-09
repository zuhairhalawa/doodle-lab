/** The public test report: scores per model, how each part is tested, and every failure drawn over its photo. */
import '@fontsource-variable/recursive/full.css';
import './style.css';
import type { Reading } from '../read/schema.ts';

interface Row {
  id: string;
  ms: number;
  error: string;
  hard: boolean;
  physics: boolean;
  score: { pass: boolean; reasons: string[] };
  scoreRaw: { pass: boolean; reasons: string[] };
}
interface Summary {
  passRate: string;
  all: Record<string, unknown>;
  normal: { cases: number; passed: number; objectsFound: string; objectsInvented: number; labels: string; links: string; sameOutcome: string; meanPositionError: number | null; medianMs: number | null };
  notPhysics: { cases: number; passed: number };
  hard: { cases: number; passed: number };
  aiAloneNormal?: { passed: number };
}
interface Data {
  generated: string;
  models: { model: string; summary: Summary; rows: Row[] }[];
  cases: { id: string; title: string; tests: string; hard: boolean; physics: boolean; width: number; height: number; truth: Reading; reads: Record<string, Reading | null> }[];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const nice = (m: string) => m.replace('@low', ' (low thinking)').replace('gemini-', 'Gemini ').replace('-preview', '').replace('-flash-lite', ' Flash-Lite').replace('-flash', ' Flash');

async function main() {
  const root = document.getElementById('report')!;
  let data: Data;
  try {
    data = (await (await fetch('/report/data.json')).json()) as Data;
  } catch {
    root.innerHTML = '<p>The test report could not be loaded.</p>';
    return;
  }
  const rowsHtml = data.models
    .map((m) => {
      const n = m.summary.normal;
      const answered = m.rows.filter((r) => !r.error);
      const alone = answered.filter((r) => r.physics && !r.hard && r.scoreRaw.pass).length;
      const normal = answered.filter((r) => r.physics && !r.hard);
      return `<tr><th scope="row">${esc(nice(m.model))}</th>
        <td class="num">${answered.length}</td>
        <td class="num">${normal.filter((r) => r.score.pass).length}/${normal.length}</td>
        <td class="num">${alone}/${normal.length}</td>
        <td class="num">${answered.filter((r) => !r.physics && r.score.pass).length}/${answered.filter((r) => !r.physics).length}</td>
        <td class="num">${answered.filter((r) => r.hard && r.score.pass).length}/${answered.filter((r) => r.hard).length}</td>
        <td class="num">${n.meanPositionError ?? '–'}</td>
        <td class="num">${n.medianMs ? (n.medianMs / 1000).toFixed(1) + ' s' : '–'}</td></tr>`;
    })
    .join('');

  root.innerHTML = `
    <section class="report-intro">
      <h1>Test report</h1>
      <p class="lede">Every number here comes from <code>npm run eval</code>: ${data.cases.length} pencil drawings generated from known scenes, each sent to Gemini with the app's own prompt and schema, then scored against the scene that was drawn. Generated ${esc(data.generated)}.</p>
      <p>A case <strong>passes</strong> only when every ball and box is found and nothing is invented, every surface is traced within 2% of the image, every written mass, friction, speed and spring constant is read exactly, every rope, rod, spring and pivot is attached to the right thing, the scale is right, and the engine moves the read scene the same way as the drawn one (every object within 8% of the image after 1.5 s; 0.4 s for the chaotic tower and double pendulum). Drawings that are not physics pass when the reader says so.</p>
    </section>
    <section>
      <h2>Scores</h2>
      <div class="table-wrap"><table class="objects report-table">
        <thead><tr><th scope="col">Model</th><th scope="col">Answered</th><th scope="col">Normal drawings passed</th><th scope="col">Same, AI alone (no snapping)</th><th scope="col">Not physics, refused</th><th scope="col">Hard cases passed</th><th scope="col">Position error (/1000)</th><th scope="col">Median time</th></tr></thead>
        <tbody>${rowsHtml}</tbody></table></div>
      <p class="muted">"AI + snap" is what the app does: the AI's reading, with each shape snapped to the pencil lines in the photo. The free tier allows 20 requests a day for Gemini 3 Flash and 3.5 Flash, so not every model has answered every case yet.</p>
    </section>
    <section>
      <h2>How the rest is tested</h2>
      <ul class="tested">
        <li><strong>The engine against textbook physics</strong> (unit tests): a free fall matches √(2h/g) within 2%; a pendulum's period matches 2π√(L/g) with the large-angle correction within 2%; a mass on a spring matches 2π√(m/k) within 3%; a block on a 30° ramp holds at μ = 0.7 and slides at g(sin θ − μ cos θ) at μ = 0.2 (within 5%); a swinging rod loses under 1% of its energy per second; the same scene always runs the same way.</li>
        <li><strong>The checker against bad readings</strong> (unit tests): non-physics drawings, garbage JSON, objects inside the floor, wrong box tilt, impossible masses and lengths, links to objects that do not exist, duplicate names and overlapping balls.</li>
        <li><strong>The scorer itself</strong>: a perfect reading must pass all ${data.cases.length} cases, and a missed object, a wrong mass and an invented scene must fail.</li>
        <li><strong>The app in a real browser</strong>: Playwright drives Edge through the samples, the draw pad, prediction and a phone-sized screen.</li>
      </ul>
    </section>
    <section>
      <h2>Every case</h2>
      <p><label>Model <select id="model-pick">${data.models.map((m, i) => `<option value="${i}">${esc(nice(m.model))}</option>`).join('')}</select></label>
      <label class="toggle"><input type="checkbox" id="only-fail" checked> Failures only</label></p>
      <p class="legend"><span class="sw sw-truth"></span> what was drawn <span class="sw sw-ai"></span> what the AI read</p>
      <div id="gallery" class="gallery"></div>
    </section>`;

  const images = new Map<string, HTMLImageElement>();
  const gallery = document.getElementById('gallery')!;
  const render = () => {
    const mi = Number((document.getElementById('model-pick') as HTMLSelectElement).value);
    const onlyFail = (document.getElementById('only-fail') as HTMLInputElement).checked;
    const m = data.models[mi]!;
    gallery.innerHTML = '';
    for (const c of data.cases) {
      const row = m.rows.find((r) => r.id === c.id);
      if (!row) continue;
      if (onlyFail && row.score.pass && !row.error) continue;
      const fig = document.createElement('figure');
      fig.className = `case ${row.score.pass ? 'case-pass' : 'case-fail'}`;
      const canvas = document.createElement('canvas');
      canvas.width = c.width;
      canvas.height = c.height;
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${c.title}: drawn scene and AI reading`);
      fig.append(canvas);
      const cap = document.createElement('figcaption');
      cap.innerHTML = `<strong>${row.error ? 'NO ANSWER' : row.score.pass ? 'PASS' : 'FAIL'}</strong> ${esc(c.id)}${c.hard ? ' <span class="tag">hard</span>' : ''}<br><span class="muted">${esc(c.tests)}</span>${row.error ? `<br>${esc(row.error)}` : row.score.reasons.length ? `<ul>${row.score.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
      fig.append(cap);
      gallery.append(fig);
      const draw = (img: HTMLImageElement) => {
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(0, 0, c.width, c.height);
        overlay(ctx, c.truth, c.width, c.height, '#1f7a3f', [10, 6]);
        const read = c.reads[m.model];
        if (read) overlay(ctx, read, c.width, c.height, '#2448c8', []);
      };
      const cached = images.get(c.id);
      if (cached?.complete) draw(cached);
      else {
        const img = cached ?? new Image();
        img.addEventListener('load', () => draw(img));
        img.src = `/report/cases/${c.id}.jpg`;
        images.set(c.id, img);
      }
    }
    if (!gallery.children.length) gallery.innerHTML = '<p>No failures for this model.</p>';
  };
  document.getElementById('model-pick')!.addEventListener('change', render);
  document.getElementById('only-fail')!.addEventListener('change', render);
  render();
}

function overlay(ctx: CanvasRenderingContext2D, r: Reading, W: number, H: number, colour: string, dash: number[]) {
  const P = (p: [number, number]) => [(p[1] / 1000) * W, (p[0] / 1000) * H] as const;
  ctx.save();
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = 4;
  ctx.setLineDash(dash);
  ctx.font = '600 22px "Recursive Variable", system-ui';
  for (const o of r.objects ?? []) {
    ctx.beginPath();
    if (o.kind === 'surface' && o.points?.length) {
      o.points.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
    } else if (o.box_2d?.length === 4) {
      const [y0, x0, y1, x1] = o.box_2d;
      const cx = ((x0 + x1) / 2000) * W;
      const cy = ((y0 + y1) / 2000) * H;
      if (o.kind === 'ball') ctx.arc(cx, cy, (((x1 - x0) / 1000) * W + ((y1 - y0) / 1000) * H) / 4, 0, Math.PI * 2);
      else if (o.kind === 'box') {
        ctx.translate(cx, cy);
        ctx.rotate(-((o.angleDeg ?? 0) * Math.PI) / 180);
        const a = Math.abs(((o.angleDeg ?? 0) * Math.PI) / 180);
        const BW = ((x1 - x0) / 1000) * W;
        const BH = ((y1 - y0) / 1000) * H;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const det = c * c - s * s;
        let w = Math.abs(det) > 0.25 ? (BW * c - BH * s) / det : (BW + BH) / (2 * (c + s));
        let h = Math.abs(det) > 0.25 ? (BH * c - BW * s) / det : w;
        if (!(w > 0 && h > 0)) w = h = (BW + BH) / (2 * (c + s));
        ctx.rect(-w / 2, -h / 2, w, h);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      } else ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    }
    ctx.stroke();
  }
  for (const l of r.links ?? []) {
    if (!l.fromPoint || !l.toPoint) continue;
    ctx.beginPath();
    ctx.moveTo(...P(l.fromPoint));
    ctx.lineTo(...P(l.toPoint));
    ctx.stroke();
  }
  ctx.restore();
}

void main();
