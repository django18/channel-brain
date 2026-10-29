import { processVideo, type ProcessedTranscript } from '../youtube';
import { storeInVectorDB } from '../youtube-vectorstore';
import { config } from '../../config';
import type { VideoLedger } from './video-ledger';

export interface IngestVideo {
  videoId: string;
  title: string;
}

export interface IngestProgress {
  total: number;
  done: number;
  ingested: number;
  failed: number;
  chunks: number;
}

export interface IngestOptions {
  collectionName: string;
  ledger: VideoLedger;
  onProgress?: (progress: IngestProgress) => void;
  /** Checked between batches; return true to stop early (resumable). */
  shouldStop?: () => boolean;
  log?: (message: string) => void;
}

export type IngestOutcome = IngestProgress & { stopped: 'done' | 'rate-limited' | 'cancelled' };

const BATCH_SIZE = 3;
const DELAY_BETWEEN_BATCHES_MS = 1500;
const RATE_LIMIT_BACKOFF_MS = 10 * 60 * 1000;
const MAX_RATE_LIMIT_RETRIES = 3;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function isRateLimited(message: string): boolean {
  return /too many requests|captcha|429/i.test(message);
}

export function isNoTranscript(message: string): boolean {
  return /transcript is disabled|no transcript|not available/i.test(message);
}

/**
 * Fetch transcripts, embed and store a list of videos into one collection.
 * Resumable: videos already in the ledger are skipped. Throttled, and backs
 * off when YouTube rate-limits.
 */
export async function ingestVideos(
  videos: IngestVideo[],
  options: IngestOptions
): Promise<IngestOutcome> {
  const { collectionName, ledger, onProgress, shouldStop, log = console.log } = options;
  const pending = videos.filter(video => !ledger.has(video.videoId));
  const progress: IngestProgress = {
    total: videos.length,
    done: videos.length - pending.length,
    ...ledger.summarize(videos.map(video => video.videoId)),
  };
  onProgress?.({ ...progress });

  let rateLimitRetries = 0;
  for (let i = 0; i < pending.length; ) {
    if (shouldStop?.()) return { ...progress, stopped: 'cancelled' };

    // filter on every pass: a rate-limit retry must not re-fetch videos already recorded
    const batch = pending.slice(i, i + BATCH_SIZE).filter(video => !ledger.has(video.videoId));
    const results = await Promise.allSettled(
      batch.map(video => processVideo(video.videoId, config.chunkSize, config.chunkOverlap))
    );

    const processed: ProcessedTranscript[] = [];
    let rateLimited = false;
    results.forEach((result, index) => {
      const video = batch[index];
      if (result.status === 'fulfilled') {
        processed.push(result.value);
        return;
      }
      const message = result.reason?.message ?? String(result.reason);
      if (isRateLimited(message)) {
        rateLimited = true; // leave unrecorded so the retry picks it up
        return;
      }
      ledger.markFailed(
        { videoId: video.videoId, videoTitle: video.title, videoUrl: `https://www.youtube.com/watch?v=${video.videoId}` },
        message,
        isNoTranscript(message)
      );
      progress.failed++;
      progress.done++;
      log(`  ✗ ${video.videoId} (${video.title.slice(0, 50)}): ${message.slice(0, 160)}`);
    });

    if (processed.length > 0) {
      // store first, record second: a crash between them re-ingests (upsert) rather than loses
      await storeInVectorDB(processed, collectionName);
      for (const transcript of processed) {
        ledger.markSuccess({
          videoId: transcript.videoId,
          videoTitle: transcript.videoTitle,
          videoUrl: transcript.videoUrl,
          channelTitle: transcript.chunks[0]?.metadata?.channelTitle,
          chunksCount: transcript.chunks.length,
          transcriptLength: transcript.fullTranscript.length,
        });
        progress.chunks += transcript.chunks.length;
      }
      progress.ingested += processed.length;
      progress.done += processed.length;
    }
    ledger.flush();
    onProgress?.({ ...progress });

    if (rateLimited) {
      rateLimitRetries++;
      if (rateLimitRetries > MAX_RATE_LIMIT_RETRIES) return { ...progress, stopped: 'rate-limited' };
      log(`Rate-limited by YouTube. Backing off ${RATE_LIMIT_BACKOFF_MS / 60000} min (retry ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES})`);
      await sleep(RATE_LIMIT_BACKOFF_MS);
      continue;
    }

    rateLimitRetries = 0;
    i += BATCH_SIZE;
    log(`Progress: ${progress.done}/${progress.total} (ok=${progress.ingested}, failed=${progress.failed}, chunks=${progress.chunks})`);
    if (i < pending.length) await sleep(DELAY_BETWEEN_BATCHES_MS);
  }

  return { ...progress, stopped: 'done' };
}
