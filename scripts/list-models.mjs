import { readFileSync } from 'node:fs';
const key = readFileSync('.dev.vars', 'utf8').match(/^GEMINI_API_KEY\s*=\s*"?([^"\r\n]+)"?/m)[1];
let url = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200';
const r = await (await fetch(url, { headers: { 'x-goog-api-key': key } })).json();
for (const m of r.models ?? []) if (m.supportedGenerationMethods?.includes('generateContent')) console.log(m.name.replace('models/', ''), '|', m.displayName);
