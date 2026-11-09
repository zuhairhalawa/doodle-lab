/**
 * Screenshots of the app in Edge, for review and for the README.
 * Usage: node scripts/shots.mjs [baseUrl] [outDir]
 * Without a base URL it starts a Vite dev server (samples use saved readings, so no key is needed).
 */
import { mkdirSync } from 'node:fs';
import { createServer } from 'vite';

const PLAYWRIGHT = new URL('../../video/node_modules/playwright/index.mjs', import.meta.url).href;
const { chromium } = await import(PLAYWRIGHT);
let base = process.argv[2];
const out = process.argv[3] ?? 'docs/screenshots';
mkdirSync(out, { recursive: true });
let server = null;
if (!base || base === '-') {
  server = await createServer({ server: { port: 5198, strictPort: true }, logLevel: 'error' });
  await server.listen();
  base = 'http://localhost:5198';
}
const browser = await chromium.launch({ channel: 'msedge' });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + '/');
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${out}/home.png` });

  // Sample: block on a ramp.
  await page.click('.sample:has-text("Block on a ramp")');
  await page.waitForSelector('#play:not([disabled])', { timeout: 15000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/read.png`, fullPage: false });
  await page.click('#play');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${out}/run.png` });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}/run-end.png`, fullPage: true });

  // Pendulum with the formula check.
  await page.click('#new');
  await page.click('.sample:has-text("Pendulum")');
  await page.waitForSelector('#play:not([disabled])', { timeout: 15000 });
  await page.waitForTimeout(1600);
  await page.click('#play');
  await page.waitForTimeout(7000);
  await page.screenshot({ path: `${out}/pendulum.png` });

  // Prediction on the collision.
  await page.click('#new');
  await page.click('.sample:has-text("Two balls collide")');
  await page.waitForSelector('#play:not([disabled])', { timeout: 15000 });
  await page.waitForTimeout(1600);
  await page.click('#predict');
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.8);
  await page.click('#play');
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${out}/predict.png` });

  // Draw pad.
  await page.click('#new');
  await page.click('#open-pad');
  const pad = await page.locator('#pad-canvas').boundingBox();
  const P = (x, y) => [pad.x + (x / 1200) * pad.width, pad.y + (y / 900) * pad.height];
  const line = async (pts) => {
    await page.mouse.move(...P(...pts[0]));
    await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(...P(...p), { steps: 12 });
    await page.mouse.up();
  };
  await line([[80, 780], [1120, 780]]);
  await line([[150, 780], [150, 380], [700, 780]]);
  const circle = [];
  for (let i = 0; i <= 40; i++) circle.push([260 + Math.cos((i / 40) * Math.PI * 2) * 34, 420 + Math.sin((i / 40) * Math.PI * 2) * 34]);
  await line(circle);
  await page.screenshot({ path: `${out}/pad.png` });

  // Phone.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  phone.on('pageerror', (e) => errors.push(String(e)));
  await phone.goto(base + '/');
  await phone.waitForTimeout(2500);
  await phone.screenshot({ path: `${out}/phone-home.png` });
  await phone.click('.sample:has-text("Seesaw")');
  await phone.waitForSelector('#play:not([disabled])', { timeout: 15000 });
  await phone.waitForTimeout(1500);
  await phone.click('#play');
  await phone.waitForTimeout(2500);
  await phone.screenshot({ path: `${out}/phone-lab.png`, fullPage: true });
} finally {
  await browser.close();
  await server?.close();
}
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
