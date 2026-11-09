// Usage: node --experimental-strip-types eval/check-samples.ts
// Scores each sample's saved reading against the scene it was drawn from (same scorer as the eval).
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { inkMap, refine } from '../src/read/refine.ts';
import { fromModel } from '../src/read/schema.ts';
import { horizonFor, scoreCase } from './score.ts';
for (const f of readdirSync('public/samples').filter((f) => f.endsWith('.read.json'))) {
  const id = f.replace('.read.json', '');
  const t = JSON.parse(readFileSync(`eval/samples/${id}.truth.json`, 'utf8'));
  const saved = JSON.parse(readFileSync(`public/samples/${f}`, 'utf8'));
  const grey = execFileSync('../video/tools/ffmpeg/bin/ffmpeg.exe', ['-v', 'error', '-i', `public/samples/${id}.jpg`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 });
  const flat = fromModel(saved.raw);
  const s = scoreCase(t.truth, flat ? refine(flat, inkMap(new Uint8Array(grey), t.width, t.height)).reading : null, t.width, t.height, horizonFor(id.replace('sample-', '').replace('tower', 'stack')));
  console.log(`${s.pass ? 'PASS' : 'FAIL'} ${id.padEnd(18)} ${saved.model.padEnd(28)} ${s.reasons.join('; ')}`);
}
