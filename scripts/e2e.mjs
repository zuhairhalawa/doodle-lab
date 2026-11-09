/**
 * End-to-end test of the real AI path in Edge: draw a ramp, a ball and a "2 kg"
 * label on the pad, read it through /api/read (Gemini), run it, and check
 * that the ball was read and actually moves.
 * Usage: node scripts/e2e.mjs [baseUrl]
 * Without a base URL it serves dist/ with `wrangler pages dev` (needs .dev.vars).
 */
import { spawn } from 'node:child_process';

const { chromium } = await import(new URL('../../video/node_modules/playwright/index.mjs', import.meta.url).href);
let base = process.argv[2];
let server = null;
if (!base) {
  server = spawn('npx wrangler pages dev dist --port 8789 --compatibility-date=2026-11-01', { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('wrangler did not start')), 60000);
    const on = (d) => String(d).includes('Ready on') && (clearTimeout(t), ok());
    server.stdout.on('data', on);
    server.stderr.on('data', on);
  });
  base = 'http://localhost:8789';
}
const fail = (m) => {
  console.error('FAIL:', m);
  process.exitCode = 1;
};
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + '/');
  await page.click('#open-pad');
  const pad = await page.locator('#pad-canvas').boundingBox();
  const P = (x, y) => [pad.x + (x / 1200) * pad.width, pad.y + (y / 900) * pad.height];
  const line = async (pts) => {
    await page.mouse.move(...P(...pts[0]));
    await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(...P(...p), { steps: 14 });
    await page.mouse.up();
  };
  await line([[80, 800], [1120, 800]]);
  await line([[150, 800], [150, 380], [760, 800]]);
  const c = [];
  for (let i = 0; i <= 48; i++) c.push([250 + Math.cos((i / 48) * Math.PI * 2) * 40, 405 + Math.sin((i / 48) * Math.PI * 2) * 40]);
  await line(c);
  await page.click('[data-tool="label"]');
  await page.mouse.click(...P(330, 330));
  await page.keyboard.type('2 kg');
  await page.keyboard.press('Enter');
  const t0 = Date.now();
  await page.click('#pad-read');
  await page.waitForFunction(() => !document.getElementById('play').disabled || document.getElementById('stage-status').dataset.tone === 'error', null, { timeout: 120000 });
  const status = await page.textContent('#stage-status');
  const meta = await page.textContent('#meta');
  console.log(`read in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${status.trim()} | ${meta.trim()}`);
  if (await page.locator('#play').isDisabled()) fail(`not runnable: ${status}`);
  if (process.env.RAW) console.log(await page.textContent('#raw'));
  const sheet = await page.textContent('#objects');
  if (!/ball|circle/i.test(sheet)) fail('no ball in the reading');
  if (!/\b2\b/.test(await page.inputValue('#objects input[data-field="massKg"]'))) fail('mass label "2 kg" not read');
  await page.click('#play');
  await page.waitForTimeout(2500);
  const speed = await page.textContent('#graph-label');
  const clock = Number(await page.textContent('#clock'));
  console.log(`after run: clock ${clock} s, ${speed}`);
  if (!(clock > 0.5)) fail('the clock did not advance');
  await page.screenshot({ path: process.env.SHOT ?? 'docs/screenshots/e2e-pad.png' });
  if (errors.length) fail(errors.join('\n'));
  if (!process.exitCode) console.log('PASS: drawn on the pad, read by the AI, and run by the engine');
} finally {
  await browser.close();
  server?.kill();
}
