/** Browser entry for the generator: window.gen.render(id) → JPEG data URL + expected reading. */
import { allCases, sampleCases } from './cases.ts';
import { truthOf } from './doodle.ts';
import { renderDoodle } from './render.ts';

const cases = [...allCases(), ...sampleCases()];

async function ready() {
  await Promise.all(['Ink Free', 'Segoe Script', 'Comic Sans MS'].map((f) => document.fonts.load(`30px "${f}"`)));
}

(window as unknown as { gen: unknown }).gen = {
  async list() {
    await ready();
    return cases.map((c) => ({ id: c.doodle.id, title: c.doodle.title, tests: c.doodle.tests, split: c.split, hard: !!c.doodle.hard, physics: c.doodle.physics, sample: c.doodle.id.startsWith('sample-') }));
  },
  async render(id: string) {
    await ready();
    const c = cases.find((x) => x.doodle.id === id)!;
    const canvas = renderDoodle(c.doodle, c.seed);
    return { jpeg: canvas.toDataURL('image/jpeg', 0.85), truth: truthOf(c.doodle), width: canvas.width, height: canvas.height };
  },
};
