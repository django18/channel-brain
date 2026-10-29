import { describe, expect, test } from 'bun:test';
import { parseChannels } from './registry';

const base = {
  id: 'internachi',
  name: 'InterNACHI',
  handle: '@internachi',
  channelUrl: 'https://www.youtube.com/@internachi',
  topic: 'Home inspection',
  domain: 'home-inspection',
  collection: 'internachi_transcripts',
  trackerFile: './data/youtube/internachi-scraped.json',
};

describe('parseChannels', () => {
  test('attaches the domain profile to each channel', () => {
    const [channel] = parseChannels([base]);
    expect(channel.profile.id).toBe('home-inspection');
  });

  test('rejects unknown domains', () => {
    expect(() => parseChannels([{ ...base, domain: 'cooking' }])).toThrow(/Unknown KNOWLEDGE_DOMAIN/);
  });

  test('rejects duplicate ids', () => {
    expect(() => parseChannels([base, { ...base }])).toThrow(/Duplicate channel id/);
  });

  test('rejects ids that are not url-safe', () => {
    expect(() => parseChannels([{ ...base, id: 'Inter NACHI' }])).toThrow();
  });

  test('rejects an empty list', () => {
    expect(() => parseChannels([])).toThrow();
  });
});

describe('the shipped channels.json', () => {
  test('parses', async () => {
    const raw = await Bun.file('./channels.json').json();
    expect(parseChannels(raw).length).toBeGreaterThan(0);
  });
});
