import type { ModelReading } from '../read/schema.ts';

export interface ReadResult {
  model: string;
  ms: number;
  raw: ModelReading;
  /** Where the reading came from: read just now, or saved with a sample. */
  source: 'live' | 'saved';
  savedOn?: string;
}

export async function readDrawing(jpeg: string, signal?: AbortSignal): Promise<ReadResult> {
  let res: Response;
  try {
    res = await fetch('/api/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: jpeg, mimeType: 'image/jpeg' }),
      signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error('Doodle Lab could not reach its server. Check your connection and try again.');
  }
  const body = (await res.json().catch(() => ({}))) as Partial<ReadResult> & { error?: string };
  if (!res.ok || !body.raw) throw new Error(body.error ?? 'The drawing reader did not answer. Try again in a minute.');
  return { model: body.model ?? 'unknown', ms: body.ms ?? 0, raw: body.raw, source: 'live' };
}

/** A reading saved from a real Gemini call when the sample was made (see scripts/save-sample-reads.ts). */
export async function savedReading(sampleId: string): Promise<ReadResult> {
  const res = await fetch(`/samples/${sampleId}.read.json`);
  if (!res.ok) throw new Error('This sample has no saved reading.');
  const body = (await res.json()) as { model: string; ms: number; raw: ModelReading; date: string };
  return { model: body.model, ms: body.ms, raw: body.raw, source: 'saved', savedOn: body.date };
}
