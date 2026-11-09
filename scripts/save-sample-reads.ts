/**
 * Reads each sample drawing once with the app's own model, prompt and schema
 * and saves the answer as public/samples/<id>.read.json, so samples open
 * instantly. The app labels these as saved readings and offers a live read.
 * Usage: node --experimental-strip-types scripts/save-sample-reads.ts [model]
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { geminiJson } from '../src/read/gemini.ts';
import { type ModelReading, READ_SCHEMA, READ_SYSTEM } from '../src/read/schema.ts';

const model = process.argv[2] ?? 'gemini-3-flash-preview@low';
const vars = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
const key = vars.match(/^GEMINI_API_KEY\s*=\s*"?([^"\r\n]+)"?/m)![1]!;
const dir = new URL('../public/samples/', import.meta.url);
const only = process.argv[3];
for (const f of readdirSync(dir).filter((f) => f.endsWith('.jpg') && (!only || f.startsWith(only)))) {
  const id = f.replace('.jpg', '');
  const started = Date.now();
  const res = await geminiJson<ModelReading>({ apiKey: key, models: [model], system: READ_SYSTEM, user: 'Read this drawing.', image: { mimeType: 'image/jpeg', data: readFileSync(new URL(f, dir)).toString('base64') }, schema: READ_SCHEMA, rounds: 4, waitMs: 8000, timeoutMs: 90_000 });
  const ms = Date.now() - started;
  writeFileSync(new URL(`${id}.read.json`, dir), JSON.stringify({ model: res.model, ms, date: new Date().toISOString().slice(0, 10), raw: res.data }, null, 1));
  console.log(id, res.model, ms, 'ms', res.data.balls?.length, 'balls', res.data.boxes?.length, 'boxes', res.data.surfaces?.length, 'surfaces', res.data.links?.length, 'links');
}
