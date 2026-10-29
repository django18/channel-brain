import { describe, expect, test } from 'bun:test';
import { buildRetrievalQuery } from './vector-advisor';
import { formatHistory } from '../../domains';

describe('buildRetrievalQuery', () => {
  const history = [
    { role: 'user' as const, content: 'How do I inspect a TPR valve?' },
    { role: 'assistant' as const, content: 'Check the discharge pipe…' },
  ];

  test('short follow-ups borrow the previous user question', () => {
    expect(buildRetrievalQuery('what about gas heaters?', history)).toBe(
      'How do I inspect a TPR valve? what about gas heaters?'
    );
  });

  test('full questions stand on their own', () => {
    const q = 'What are the most common defects found when inspecting an attic for ventilation problems?';
    expect(buildRetrievalQuery(q, history)).toBe(q);
  });

  test('no history leaves the question unchanged', () => {
    expect(buildRetrievalQuery('roof hail?')).toBe('roof hail?');
  });
});

describe('formatHistory', () => {
  test('empty history renders nothing', () => {
    expect(formatHistory([])).toBe('');
    expect(formatHistory(undefined)).toBe('');
  });

  test('keeps only the most recent turns and truncates long answers', () => {
    const turns = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: i === 9 ? 'x'.repeat(2000) : `turn ${i}`,
    }));
    const out = formatHistory(turns);
    expect(out).not.toContain('turn 3');
    expect(out).toContain('turn 4');
    expect(out).toContain('…');
    expect(out.length).toBeLessThan(1500);
  });
});
