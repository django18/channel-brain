import { describe, expect, test } from 'bun:test';
import { resolveDomain } from './index';

describe('resolveDomain', () => {
  test('startup domain keeps the graph pipeline', () => {
    expect(resolveDomain('startup').graphEnabled).toBe(true);
  });

  test('home-inspection domain is vector-only', () => {
    expect(resolveDomain('home-inspection').graphEnabled).toBe(false);
  });

  test('unknown domain fails fast with valid options', () => {
    expect(() => resolveDomain('cooking')).toThrow(/startup, home-inspection/);
  });
});

describe('home-inspection prompt', () => {
  const domain = resolveDomain('home-inspection');

  test('numbers sources so the answer can cite them', () => {
    const prompt = domain.buildVectorPrompt({
      question: 'What is double tapping?',
      sources: [
        {
          videoTitle: 'Panel Defects',
          videoUrl: 'https://www.youtube.com/watch?v=abc&t=60s',
          timestamp: '1:00',
          excerpt: 'Two conductors under one lug...',
          similarity: 0.71,
        },
      ],
    });
    expect(prompt).toContain('[1] "Panel Defects" @ 1:00');
    expect(prompt).toContain('Two conductors under one lug');
  });

  test('says so when retrieval returned nothing', () => {
    const prompt = domain.buildVectorPrompt({ question: 'x?', sources: [] });
    expect(prompt).toContain('(no excerpts found)');
  });
});
