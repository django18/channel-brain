import { describe, expect, test } from 'bun:test';
import { mergeRecent } from './recent-searches';

const at = (q: string, t: number) => ({ question: q, askedAt: new Date(t).toISOString() });

describe('mergeRecent', () => {
  test('re-asking moves the question to the top without duplicating it', () => {
    const merged = mergeRecent(at('Roof hail?', 3), [at('panel?', 2), at('roof hail?', 1)]);
    expect(merged.map(e => e.question)).toEqual(['Roof hail?', 'panel?']);
  });

  test('keeps at most 20 entries', () => {
    const existing = Array.from({ length: 25 }, (_, i) => at(`q${i}`, i));
    expect(mergeRecent(at('new', 99), existing)).toHaveLength(20);
  });
});
