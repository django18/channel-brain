import { describe, expect, test } from 'bun:test';
import { friendlyListingError, parseChannelInput } from './youtube-listing';

describe('parseChannelInput', () => {
  test.each([
    ['@internachi', 'https://www.youtube.com/@internachi'],
    ['https://www.youtube.com/@internachi', 'https://www.youtube.com/@internachi'],
    ['https://www.youtube.com/@internachi/videos', 'https://www.youtube.com/@internachi'],
    ['youtube.com/@starterstory', 'https://www.youtube.com/@starterstory'],
    ['https://m.youtube.com/@starterstory/shorts?x=1', 'https://www.youtube.com/@starterstory'],
    [
      'https://www.youtube.com/channel/UChhw6DlKKTQ9mYSpTfXUYqA',
      'https://www.youtube.com/channel/UChhw6DlKKTQ9mYSpTfXUYqA',
    ],
  ])('%s → %s', (input, url) => {
    expect(parseChannelInput(input)?.url).toBe(url);
  });

  test.each([
    'https://evil.com/@internachi',
    'https://www.youtube.com/watch?v=abc',
    'https://www.youtube.com/channel/not-an-id',
    '@a',
    '@bad handle',
    '--exec rm',
    'javascript:alert(1)',
    '',
  ])('rejects %p', input => {
    expect(parseChannelInput(input)).toBeNull();
  });
});

describe('friendlyListingError', () => {
  test('missing channel', () => {
    expect(friendlyListingError('WARNING: [youtube:tab] YouTube said: ERROR - Requested entity was not found.')).toMatch(/couldn't find/);
  });
  test('never echoes raw yt-dlp output', () => {
    expect(friendlyListingError('ERROR: something odd /usr/bin/x')).not.toContain('/usr/bin');
  });
});
