/**
 * Renders every eval case and sample drawing in Edge and writes
 * eval/cases/<id>.jpg + <id>.truth.json and public/samples/<id>.jpg.
 * Usage: npm run gen
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const PLAYWRIGHT = process.env.PLAYWRIGHT ?? '../video/node_modules/playwright/index.mjs';
const { chromium } = await import(new URL(PLAYWRIGHT, new URL('../../', import.meta.url)).href);

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:5199/eval/gen/index.html');
  await page.waitForFunction(() => 'gen' in window);
  const list = await page.evaluate(() => window.gen.list());
  mkdirSync('eval/cases', { recursive: true });
  mkdirSync('public/samples', { recursive: true });
  mkdirSync('eval/samples', { recursive: true });
  for (const c of list) {
    const r = await page.evaluate((id) => window.gen.render(id), c.id);
    const jpg = Buffer.from(r.jpeg.split(',')[1], 'base64');
    const dir = c.sample ? 'public/samples' : 'eval/cases';
    writeFileSync(`${dir}/${c.id}.jpg`, jpg);
    writeFileSync(`${c.sample ? 'eval/samples' : 'eval/cases'}/${c.id}.truth.json`, JSON.stringify({ ...c, width: r.width, height: r.height, truth: r.truth }, null, 1));
    console.log(`${c.id.padEnd(28)} ${(jpg.length / 1024).toFixed(0)} KB`);
  }
  writeFileSync('eval/cases/index.json', JSON.stringify(list.filter((c) => !c.sample), null, 1));
} finally {
  await browser.close();
  await server.close();
}
