import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { ScrapedVideoRecord, VideoTracker } from '../youtube-tracker';

/**
 * Per-channel record of which videos were ingested, in the same file
 * format as youtube-tracker.ts. Held in memory and flushed explicitly, so a
 * 3k-video ingest doesn't rewrite the file for every video.
 */
export class VideoLedger {
  private readonly path: string;
  private tracker: VideoTracker;

  constructor(file: string) {
    this.path = resolve(process.cwd(), file);
    this.tracker = VideoLedger.read(this.path);
  }

  private static read(path: string): VideoTracker {
    const empty: VideoTracker = {
      version: '1.0',
      totalVideosProcessed: 0,
      totalSuccessful: 0,
      totalFailed: 0,
      videos: {},
    };
    if (!existsSync(path)) return empty;
    try {
      return { ...empty, ...JSON.parse(readFileSync(path, 'utf-8')) };
    } catch (error) {
      console.error(`Unreadable video ledger at ${path}, starting fresh:`, error);
      return empty;
    }
  }

  has(videoId: string): boolean {
    return videoId in this.tracker.videos;
  }

  /** Totals for videos already recorded among `videoIds` (seeds progress on resume). */
  summarize(videoIds: string[]): { ingested: number; failed: number; chunks: number } {
    return videoIds.reduce(
      (acc, id) => {
        const entry = this.tracker.videos[id];
        if (!entry) return acc;
        return entry.status === 'success'
          ? { ...acc, ingested: acc.ingested + 1, chunks: acc.chunks + (entry.chunksCount ?? 0) }
          : { ...acc, failed: acc.failed + 1 };
      },
      { ingested: 0, failed: 0, chunks: 0 }
    );
  }

  successCount(): number {
    return Object.values(this.tracker.videos).filter(v => v.status === 'success').length;
  }

  private record(entry: ScrapedVideoRecord): void {
    const isNew = !this.has(entry.videoId);
    const ok = entry.status === 'success';
    this.tracker = {
      ...this.tracker,
      totalVideosProcessed: this.tracker.totalVideosProcessed + (isNew ? 1 : 0),
      totalSuccessful: this.tracker.totalSuccessful + (isNew && ok ? 1 : 0),
      totalFailed: this.tracker.totalFailed + (isNew && !ok ? 1 : 0),
      videos: { ...this.tracker.videos, [entry.videoId]: entry },
    };
  }

  markSuccess(entry: Omit<ScrapedVideoRecord, 'scrapedAt' | 'status'>): void {
    this.record({ ...entry, scrapedAt: new Date().toISOString(), status: 'success' });
  }

  markFailed(
    video: { videoId: string; videoTitle: string; videoUrl: string },
    errorMessage: string,
    noTranscript: boolean
  ): void {
    this.record({
      ...video,
      scrapedAt: new Date().toISOString(),
      status: noTranscript ? 'no-transcript' : 'failed',
      chunksCount: 0,
      transcriptLength: 0,
      errorMessage,
    });
  }

  /** Write atomically: a crash mid-write must not corrupt the ledger. */
  flush(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.tracker, null, 2), 'utf-8');
    renameSync(tmp, this.path);
  }
}
