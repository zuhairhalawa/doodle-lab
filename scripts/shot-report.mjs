// Screenshot of the test report page. Usage: node scripts/shot-report.mjs [baseUrl] [out.png]
import { createServer } from 'vite';
const { chromium } = await import(new URL('../../video/node_modules/playwright/index.mjs', import.meta.url).href);
let base = process.argv[2];
let server = null;
if (!base || base === '-') {
  server = await createServer({ server: { port: 5197, strictPort: true }, logLevel: 'error' });
  await server.listen();
  base = 'http://localhost:5197';
}
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base + '/report.html');
await page.waitForSelector('.case canvas');
await page.waitForTimeout(2500);
await page.screenshot({ path: process.argv[3] ?? 'docs/screenshots/report.png', fullPage: true });
await browser.close();
await server?.close();
console.log(errors.length ? errors.join('\n') : 'no page errors');
