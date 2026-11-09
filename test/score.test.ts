import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Reading } from '../src/read/schema.ts';
import { scoreCase } from '../eval/score.ts';

const dir = new URL('../eval/cases/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.truth.json'));

describe('eval scorer', () => {
  it('has the whole eval set', () => {
    expect(files.length).toBeGreaterThanOrEqual(45);
  });

  // A perfect reader must score a pass on every case, or the scorer (or the case) is wrong.
  for (const f of files) {
    it(`a perfect reading passes: ${f}`, () => {
      const t = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as { width: number; height: number; truth: Reading };
      const s = scoreCase(t.truth, structuredClone(t.truth), t.width, t.height);
      expect(s.reasons).toEqual([]);
      expect(s.pass).toBe(true);
    });
  }

  it('catches a missed object, a wrong label and a hallucinated scene', () => {
    const t = JSON.parse(readFileSync(new URL('collision-1.truth.json', dir), 'utf8')) as { width: number; height: number; truth: Reading };
    const missing = structuredClone(t.truth);
    missing.objects = missing.objects.filter((o) => o.id !== 'ball2');
    expect(scoreCase(t.truth, missing, t.width, t.height).pass).toBe(false);
    const wrongMass = structuredClone(t.truth);
    wrongMass.objects.find((o) => o.id === 'ball1')!.massKg = 7;
    const s = scoreCase(t.truth, wrongMass, t.width, t.height);
    expect(s.pass).toBe(false);
    expect(s.labels.wrong[0]).toMatch(/ball1 mass/);
    const neg = JSON.parse(readFileSync(new URL('not-physics-house.truth.json', dir), 'utf8')) as { width: number; height: number; truth: Reading };
    expect(scoreCase(neg.truth, { ...t.truth }, neg.width, neg.height).pass).toBe(false);
  });
});
