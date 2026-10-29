import { describe, expect, test } from 'bun:test';
import { rankPassages, toPassage } from './search';
import { selectChannels } from './channels';

const hit = (collection: string, title: string, timestamp: string, similarity: number, startTime = 61_500) => ({
  id: `${collection}-${title}-${timestamp}-${similarity}`,
  collection,
  videoId: 'abcdefghijk',
  videoTitle: title,
  videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
  text: `${title} text`,
  startTime,
  endTime: startTime + 5000,
  timestamp,
  similarity,
  metadata: {},
});

const byCollection = new Map([
  ['internachi_transcripts', { id: 'internachi', name: 'InterNACHI' }],
  ['channel_fireship', { id: 'fireship', name: 'Fireship' }],
]);

const hits = [
  hit('internachi_transcripts', 'Roof hail', '1:01', 0.62),
  hit('internachi_transcripts', 'Roof hail', '1:01', 0.6), // overlapping chunk, same moment
  hit('channel_fireship', 'Rust rewrite', '2:00', 0.71),
  hit('channel_fireship', 'Low match', '0:10', 0.2),
];

describe('rankPassages', () => {
  test('merges channels by similarity and drops repeated moments', () => {
    const passages = rankPassages(hits, byCollection, { limit: 10 });
    expect(passages.map(p => p.video.title)).toEqual(['Rust rewrite', 'Roof hail', 'Low match']);
    expect(passages[1].channel).toEqual({ id: 'internachi', name: 'InterNACHI' });
    expect(passages[1].similarity).toBe(0.62);
  });

  test('applies minSimilarity and limit', () => {
    expect(rankPassages(hits, byCollection, { limit: 1, minSimilarity: 0.5 }).map(p => p.video.title)).toEqual(['Rust rewrite']);
  });

  test('same title + time in different channels are both kept', () => {
    const twins = [hit('internachi_transcripts', 'Intro', '0:00', 0.5), hit('channel_fireship', 'Intro', '0:00', 0.4)];
    expect(rankPassages(twins, byCollection, { limit: 10 })).toHaveLength(2);
  });
});

describe('toPassage', () => {
  test('deep-links to the passage start, in whole seconds', () => {
    const passage = toPassage(hit('c', 'T', '1:01', 0.12345) as never, { id: 'c', name: 'C' });
    expect(passage.url).toBe('https://www.youtube.com/watch?v=abcdefghijk&t=61s');
    expect(passage.startSeconds).toBe(61);
    expect(passage.similarity).toBe(0.123);
  });
});

describe('selectChannels', () => {
  const all = [
    { id: 'internachi', status: 'ready' as const },
    { id: 'fireship', status: 'indexing' as const },
    { id: 'new', status: 'queued' as const },
  ];

  test('no ids is rejected and lists the searchable channels', () => {
    expect(() => selectChannels(all, [])).toThrow('Pass at least one channel id. Available: internachi, fireship');
  });

  test('explicit ids are honoured and de-duplicated', () => {
    expect(selectChannels(all, ['fireship', 'fireship']).map(c => c.id)).toEqual(['fireship']);
  });

  test('unknown ids fail and list the valid ones', () => {
    expect(() => selectChannels(all, ['nope'])).toThrow('Unknown channel(s): nope. Valid: internachi, fireship, new');
  });
});
