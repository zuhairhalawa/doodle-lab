/**
 * POST /api/read  { image: base64 JPEG/PNG/WebP, mimeType }  →  { model, ms, reading }
 * The model only describes the drawing. The browser validates the reading and
 * the physics engine computes all motion.
 */
import { GeminiError, geminiJson } from '../../src/read/gemini.ts';
import { READ_SCHEMA, READ_SYSTEM } from '../../src/read/schema.ts';
import { type Env, MAX_IMAGE_CHARS, dailyCap, guard, json, models } from '../../src/server/guard.ts';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const blocked = guard(request, 'read', 40, env);
  if (blocked) return blocked;
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_IMAGE_CHARS + 2_000) return json({ error: 'This photo is too large. Try a smaller one.' }, 413);
  let image: unknown;
  let mimeType: unknown;
  try {
    ({ image, mimeType } = (await request.json()) as { image?: unknown; mimeType?: unknown });
  } catch {
    return json({ error: 'Send JSON.' }, 400);
  }
  if (typeof mimeType !== 'string' || !TYPES.includes(mimeType)) return json({ error: 'Send a JPEG, PNG or WebP photo.' }, 415);
  if (typeof image !== 'string' || image.length < 500 || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 2000))) return json({ error: 'That photo could not be read. Try another one.' }, 400);
  if (image.length > MAX_IMAGE_CHARS) return json({ error: 'This photo is too large. Try a smaller one.' }, 413);
  const capped = await dailyCap(env);
  if (capped) return capped;
  const started = Date.now();
  try {
    const { data, model } = await geminiJson<Record<string, unknown>>({
      apiKey: env.GEMINI_API_KEY,
      models: models(env),
      system: READ_SYSTEM,
      user: 'Read this drawing.',
      image: { mimeType, data: image },
      schema: READ_SCHEMA,
      // One pass down the model list; each model gets 35 s (Gemini 3 Flash usually answers in 5-15 s).
      rounds: 1,
      timeoutMs: 35_000,
    });
    return json({ model, ms: Date.now() - started, raw: data });
  } catch (e) {
    const status = e instanceof GeminiError && e.status === 429 ? 429 : 502;
    return json(
      { error: status === 429 ? 'The free AI quota is busy. Try again in a minute, or open a sample drawing.' : 'The drawing reader is busy right now. Try again in a minute.' },
      status,
    );
  }
};
