import { readFileSync } from 'node:fs';
const key = readFileSync('.dev.vars', 'utf8').match(/^GEMINI_API_KEY\s*=\s*"?([^"\r\n]+)"?/m)[1];
for (const m of process.argv.slice(2)) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify({ contents: [{ parts: [{ text: 'Say ok' }] }], generationConfig: {} }) });
  const t = await r.text();
  const j = (() => { try { return JSON.parse(t); } catch { return {}; } })();
  const v = j.error?.details?.find?.((d) => d.violations)?.violations?.map((x) => `${x.quotaId} limit=${x.quotaValue}`);
  const retry = j.error?.details?.find?.((d) => d.retryDelay)?.retryDelay;
  console.log(m, r.status, v ?? '', retry ?? '');
}
