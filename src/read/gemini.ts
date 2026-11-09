/** A small Gemini client with JSON output, shared by the server function and the eval. */

export interface GeminiOptions {
  apiKey: string;
  models: string[];
  system: string;
  user: string;
  /** Optional image sent before the text, base64 without a data: prefix. */
  image?: { mimeType: string; data: string };
  schema: object;
  timeoutMs?: number;
}

export class GeminiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const BUSY = [404, 429, 500, 503];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Calls each model in turn until one answers; returns the parsed JSON and the
 * model used. When every model is busy, waits and tries the list again
 * (`rounds` times in all).
 */
export async function geminiJson<T>(o: GeminiOptions & { rounds?: number; waitMs?: number }): Promise<{ data: T; model: string }> {
  let last: GeminiError = new GeminiError('No model configured', 500);
  const rounds = o.rounds ?? 3;
  for (let round = 0; round < rounds; round++) {
    if (round > 0) await sleep((o.waitMs ?? 2000) * round);
    try {
      return await tryModels<T>(o);
    } catch (e) {
      last = e as GeminiError;
      if (!BUSY.includes(last.status)) throw last;
    }
  }
  throw last;
}

async function tryModels<T>(o: GeminiOptions): Promise<{ data: T; model: string }> {
  let last: GeminiError = new GeminiError('No model configured', 500);
  for (const model of o.models) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 45_000);
    try {
      // "model@low" picks a thinking level for models that support one.
      const [name, thinking] = model.split('@');
      const res = await fetch(`${BASE}/${name}:generateContent`, {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': o.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: o.system }] },
          contents: [{ role: 'user', parts: [...(o.image ? [{ inlineData: o.image }] : []), { text: o.user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema: o.schema,
            ...(thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}),
          },
        }),
      });
      if (!res.ok) {
        last = new GeminiError(`Gemini ${model} answered ${res.status}`, res.status);
        // Busy, rate-limited or retired model: try the next one.
        if (BUSY.includes(res.status)) continue;
        throw last;
      }
      const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      return { data: JSON.parse(text) as T, model };
    } catch (e) {
      if (e instanceof GeminiError && !BUSY.includes(e.status)) throw e;
      last = e instanceof GeminiError ? e : new GeminiError(`Gemini ${model} failed: ${(e as Error).message}`, 502);
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}
