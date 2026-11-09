/**
 * Shared checks for the server functions: same-origin requests only, a size
 * cap, and a per-visitor rate limit so nobody can use up the free model quota.
 * Drawings are never logged or stored.
 */

export interface Env {
  GEMINI_API_KEY: string;
  GEMINI_MODELS?: string;
}

/** Base64 characters of one photo (about 1.5 MB of JPEG). The page sends about 200 KB. */
export const MAX_IMAGE_CHARS = 2_000_000;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/** Per-isolate counters. Best effort: Cloudflare may run several isolates. */
const hits = new Map<string, number[]>();

export function rateLimited(ip: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return false;
}

/** Returns an error response, or null when the request may go ahead. */
export function guard(request: Request, bucket: string, limitPerHour: number, env?: Env): Response | null {
  if (env && !env.GEMINI_API_KEY) return json({ error: 'Doodle Lab is not set up yet (no AI key on the server).' }, 503);
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) return json({ error: 'Requests must come from the Doodle Lab page.' }, 403);
  if (!(request.headers.get('Content-Type') ?? '').includes('application/json')) return json({ error: 'Send JSON.' }, 415);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (rateLimited(`${bucket}:${ip}`, limitPerHour, 3_600_000))
    return json({ error: 'You have read a lot of drawings in the last hour. Please try again later.' }, 429);
  return null;
}

export function models(env: Env): string[] {
  return (env.GEMINI_MODELS ?? 'gemini-3-flash-preview@low,gemini-3.5-flash@low,gemini-3.5-flash-lite@low,gemini-3.1-flash-lite')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}
