// Debug helper: prints the drawn, AI-read and snapped scenes for one case and where the engine moves them.
// Usage: node --experimental-strip-types eval/trace.ts <case-id> <model>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { inkMap, refine } from '../src/read/refine.ts';
import { fromModel } from '../src/read/schema.ts';
import { validate } from '../src/scene/validate.ts';
import { buildSim } from '../src/sim/world.ts';
const [id, model] = process.argv.slice(2);
const t = JSON.parse(readFileSync(`eval/cases/${id}.truth.json`, 'utf8'));
const r = fromModel(JSON.parse(readFileSync(`eval/out/${model}/${id}.json`, 'utf8')).raw)!;
const buf = execFileSync('../video/tools/ffmpeg/bin/ffmpeg.exe', ['-v', 'error', '-i', `eval/cases/${id}.jpg`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 });
const ref = refine(r, inkMap(new Uint8Array(buf), t.width, t.height)).reading;
for (const [name, rd] of [['truth', t.truth], ['ai', r], ['ref', ref]] as const) {
  const sc = validate(rd, t.width, t.height);
  console.log(name, sc.bodies.map(b => b.kind === 'surface' ? `${b.id}[${b.points.map(p=>`${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' ')}]` : `${b.id}(${b.x.toFixed(0)},${b.y.toFixed(0)} ${b.w.toFixed(0)}x${b.h.toFixed(0)} r${b.r.toFixed(0)} a${(b.angle*57.3).toFixed(1)})`).join(' '), sc.joints.map(j => `${j.kind}@${j.aPoint.x.toFixed(0)},${j.aPoint.y.toFixed(0)}`).join(' '), '|', sc.notes.filter(n=>n.level!=='assumed').map(n=>n.text).join(' | '));
  const sim = buildSim(sc, { pageFloor: true });
  for (const T of [0.3, 0.8, 1.5]) { sim.step(T - sim.time); console.log('  t', T, [...sim.bodies].filter(([, b]) => b.isDynamic()).map(([i, b]) => { const p = sim.toImage(b.getPosition()); return `${i}:${p.x.toFixed(0)},${p.y.toFixed(0)} a${(b.getAngle()*57.3).toFixed(0)}`; }).join(' ')); }
}
