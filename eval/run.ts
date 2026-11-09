/**
 * Accuracy test: sends every eval doodle to Gemini with the app's own prompt
 * and schema, then scores the reading against what was drawn.
 *
 * Usage: npm run eval -- [--model gemini-3.1-flash-lite] [--split dev|test|all] [--fresh]
 * Needs GEMINI_API_KEY in .dev.vars (read here, never printed).
 * Answers are cached in eval/out/<model>/ so scoring can be re-run offline.
 * Writes eval/results/<model>.json; the README numbers come from those files.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { geminiJson } from '../src/read/gemini.ts';
import { type ModelReading, READ_SCHEMA, READ_SYSTEM, type Reading, fromModel } from '../src/read/schema.ts';
import { execFileSync } from 'node:child_process';
import { inkMap, refine } from '../src/read/refine.ts';
import { horizonFor, scoreCase } from './score.ts';

const FFMPEG = process.env.FFMPEG ?? new URL('../../video/tools/ffmpeg/bin/ffmpeg.exe', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
/** Grey pixels of a JPEG, decoded with ffmpeg (the browser uses a canvas instead). */
function grey(file: URL, w: number, h: number): Uint8Array {
  const path = decodeURIComponent(file.pathname).replace(/^\/([A-Za-z]:)/, '$1');
  const buf = execFileSync(FFMPEG, ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 64 * 1024 * 1024 });
  if (buf.length !== w * h) throw new Error(`unexpected size for ${path}`);
  return new Uint8Array(buf);
}

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const model = arg('model', 'gemini-3.1-flash-lite');
const split = arg('split', 'all');
const fresh = process.argv.includes('--fresh');

function apiKey(): string {
  const vars = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
  const m = vars.match(/^GEMINI_API_KEY\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error('GEMINI_API_KEY missing from .dev.vars');
  return m[1]!;
}

interface Meta {
  id: string;
  title: string;
  tests: string;
  split: 'dev' | 'test';
  hard: boolean;
  physics: boolean;
}

const cases = (JSON.parse(readFileSync(new URL('./cases/index.json', import.meta.url), 'utf8')) as Meta[]).filter((c) => split === 'all' || c.split === split);
const outDir = new URL(`./out/${model}/`, import.meta.url);
mkdirSync(outDir, { recursive: true });
const key = apiKey();
import type { CaseScore } from './score.ts';
const rows: (Meta & { ms: number; error: string; score: CaseScore; scoreRaw: CaseScore })[] = [];

for (const c of cases) {
  const cacheFile = new URL(`${c.id}.json`, outDir);
  const t = JSON.parse(readFileSync(new URL(`./cases/${c.id}.truth.json`, import.meta.url), 'utf8')) as { width: number; height: number; truth: Reading };
  let raw: ModelReading | null = null;
  let ms = 0;
  let error = '';
  if (!fresh && existsSync(cacheFile)) ({ raw, ms } = JSON.parse(readFileSync(cacheFile, 'utf8')));
  else {
    const image = readFileSync(new URL(`./cases/${c.id}.jpg`, import.meta.url)).toString('base64');
    const started = Date.now();
    try {
      const res = await geminiJson<ModelReading>({ apiKey: key, models: [model], system: READ_SYSTEM, user: 'Read this drawing.', image: { mimeType: 'image/jpeg', data: image }, schema: READ_SCHEMA, rounds: 4, waitMs: 5000, timeoutMs: 60_000 });
      raw = res.data;
      ms = Date.now() - started;
      writeFileSync(cacheFile, JSON.stringify({ model, ms, raw }, null, 1));
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const flat = fromModel(raw);
  // What the app does: the AI's reading, snapped to the pencil lines in the photo.
  const refined = flat ? refine(flat, inkMap(grey(new URL(`./cases/${c.id}.jpg`, import.meta.url), t.width, t.height), t.width, t.height)).reading : null;
  const scoreRaw = scoreCase(t.truth, flat, t.width, t.height, horizonFor(c.id));
  const score = scoreCase(t.truth, refined, t.width, t.height, horizonFor(c.id));
  rows.push({ ...c, ms, error, score, scoreRaw });
  console.log(`${score.pass ? 'PASS' : 'FAIL'} ${scoreRaw.pass ? '(ai PASS)' : '(ai FAIL)'}  ${c.id.padEnd(26)} ${String(ms).padStart(6)} ms  ${error || score.reasons.slice(0, 3).join('; ')}`);
}

const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
const group = (filter: (r: (typeof rows)[number]) => boolean, which: 'score' | 'scoreRaw' = 'score') => {
  const rs = rows.filter(filter).map((r) => ({ ...r, score: r[which] }));
  const sum = (f: (r: (typeof rows)[number]) => number) => rs.reduce((s, r) => s + f(r), 0);
  const phys = rs.filter((r) => r.physics);
  const pos = phys.map((r) => r.score.positionError).filter((x): x is number => x !== null);
  return {
    cases: rs.length,
    passed: rs.filter((r) => r.score.pass).length,
    detection: `${rs.filter((r) => r.score.detectionOk).length}/${rs.length}`,
    objectsFound: `${sum((r) => r.score.objects.found)}/${sum((r) => r.score.objects.expected)}`,
    objectsInvented: sum((r) => r.score.objects.extra),
    surfaces: `${sum((r) => r.score.surfaces.matched)}/${sum((r) => r.score.surfaces.expected)}`,
    labels: `${sum((r) => r.score.labels.correct)}/${sum((r) => r.score.labels.expected)}`,
    links: `${sum((r) => r.score.links.correct)}/${sum((r) => r.score.links.expected)}`,
    sameOutcome: `${phys.filter((r) => r.score.outcome.ok).length}/${phys.length}`,
    meanPositionError: pos.length ? Number((pos.reduce((a, b) => a + b, 0) / pos.length).toFixed(1)) : null,
    medianMs: rs.length ? [...rs.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(rs.length / 2)] : null,
  };
};
const summary = {
  model,
  split,
  date: new Date().toISOString().slice(0, 10),
  all: group(() => true),
  normal: group((r) => r.physics && !r.hard),
  notPhysics: group((r) => !r.physics),
  hard: group((r) => r.hard),
  aiAloneNormal: group((r) => r.physics && !r.hard, 'scoreRaw'),
  aiAloneHard: group((r) => r.hard, 'scoreRaw'),
  passRate: `${pct(rows.filter((r) => r.score.pass).length, rows.length)}%`,
};
mkdirSync(new URL('./results/', import.meta.url), { recursive: true });
writeFileSync(new URL(`./results/${model}${split === 'all' ? '' : `-${split}`}.json`, import.meta.url), JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
