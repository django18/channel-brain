import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { VideoLedger } from './video-ledger';

const dirs: string[] = [];
function ledgerFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  dirs.push(dir);
  return join(dir, 'nested', 'ledger.json');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const video = (id: string) => ({ videoId: id, videoTitle: `t-${id}`, videoUrl: `u-${id}` });

describe('VideoLedger', () => {
  test('records survive a flush and reload', () => {
    const file = ledgerFile();
    const ledger = new VideoLedger(file);
    ledger.markSuccess({ ...video('a'), chunksCount: 4, transcriptLength: 100 });
    ledger.markFailed(video('b'), 'Transcript is disabled', true);
    ledger.flush();

    const reloaded = new VideoLedger(file);
    expect(reloaded.has('a')).toBe(true);
    expect(reloaded.has('b')).toBe(true);
    expect(reloaded.successCount()).toBe(1);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  test('summarize seeds resume progress from earlier runs', () => {
    const ledger = new VideoLedger(ledgerFile());
    ledger.markSuccess({ ...video('a'), chunksCount: 4, transcriptLength: 100 });
    ledger.markSuccess({ ...video('b'), chunksCount: 6, transcriptLength: 100 });
    ledger.markFailed(video('c'), 'nope', false);
    expect(ledger.summarize(['a', 'b', 'c', 'd'])).toEqual({ ingested: 2, failed: 1, chunks: 10 });
  });

  test('re-recording a video does not double count totals', () => {
    const file = ledgerFile();
    const ledger = new VideoLedger(file);
    ledger.markSuccess({ ...video('a'), chunksCount: 1, transcriptLength: 1 });
    ledger.markSuccess({ ...video('a'), chunksCount: 1, transcriptLength: 1 });
    ledger.flush();
    expect(new VideoLedger(file).successCount()).toBe(1);
  });
});
