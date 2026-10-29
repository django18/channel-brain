/**
 * Ingest a channel from a pre-listed set of videos — the reliable path for
 * large channels (thousands of videos), where the in-app channel scraper
 * cannot paginate without an API key.
 *
 * List the channel once with yt-dlp (one "id|title|duration" per line):
 *   yt-dlp --flat-playlist --print "%(id)s|%(title)s|%(duration)s" \
 *     "https://www.youtube.com/@internachi/videos" > data/youtube/internachi-videos.txt
 *
 * Then ingest (resumable: tracked videos are skipped, re-run to continue):
 *   KNOWLEDGE_DOMAIN=home-inspection \
 *   YOUTUBE_COLLECTION_NAME=internachi_transcripts \
 *   YOUTUBE_TRACKER_FILE=./data/youtube/internachi-scraped.json \
 *   bun run scripts/ingest-video-list.ts data/youtube/internachi-videos.txt [limit]
 *
 * Writes go to whatever collection/tracker the env points at, so double-check
 * them before a long run — the Starter Story corpus is the default.
 */
import { processVideo, type ProcessedTranscript } from '../src/lib/youtube';
import { storeInVectorDB } from '../src/lib/youtube-vectorstore';
import { isVideoScraped, markVideoAsFailed, markVideoAsScraped } from '../src/lib/youtube-tracker';
import { config } from '../src/config';

interface ListedVideo {
  videoId: string;
  title: string;
}

const BATCH_SIZE = 3;
const DELAY_BETWEEN_BATCHES_MS = 1500;
const RATE_LIMIT_BACKOFF_MS = 10 * 60 * 1000;
const MAX_RATE_LIMIT_RETRIES = 3;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function parseList(text: string): ListedVideo[] {
  const seen = new Set<string>();
  const videos: ListedVideo[] = [];
  for (const line of text.split('\n')) {
    const [videoId, ...rest] = line.trim().split('|');
    if (!videoId || !VIDEO_ID_PATTERN.test(videoId) || seen.has(videoId)) continue;
    seen.add(videoId);
    // title may itself contain '|'; duration is the last field
    const title = rest.length > 1 ? rest.slice(0, -1).join('|') : rest[0] ?? videoId;
    videos.push({ videoId, title });
  }
  return videos;
}

function isRateLimited(message: string): boolean {
  return /too many requests|captcha|429/i.test(message);
}

function isNoTranscript(message: string): boolean {
  return /transcript is disabled|no transcript|not available/i.test(message);
}

async function processBatch(
  batch: ListedVideo[]
): Promise<{ processed: ProcessedTranscript[]; failed: number; rateLimited: boolean }> {
  const results = await Promise.allSettled(
    batch.map(video => processVideo(video.videoId, config.chunkSize, config.chunkOverlap))
  );

  const processed: ProcessedTranscript[] = [];
  let failed = 0;
  let rateLimited = false;

  results.forEach((result, index) => {
    const video = batch[index];
    if (result.status === 'fulfilled') {
      processed.push(result.value);
      return;
    }
    const message = result.reason?.message ?? String(result.reason);
    if (isRateLimited(message)) {
      // leave untracked so the retry (or next run) picks it up
      rateLimited = true;
      return;
    }
    failed++;
    const url = `https://www.youtube.com/watch?v=${video.videoId}`;
    markVideoAsFailed(video.videoId, video.title, url, message, isNoTranscript(message));
    console.warn(`  ✗ ${video.videoId} (${video.title.slice(0, 50)}): ${message.slice(0, 160)}`);
  });

  return { processed, failed, rateLimited };
}

function markStored(transcripts: ProcessedTranscript[]): void {
  for (const transcript of transcripts) {
    markVideoAsScraped({
      videoId: transcript.videoId,
      videoTitle: transcript.videoTitle,
      videoUrl: transcript.videoUrl,
      channelTitle: transcript.chunks[0]?.metadata?.channelTitle,
      chunksCount: transcript.chunks.length,
      transcriptLength: transcript.fullTranscript.length,
    });
  }
}

async function main() {
  const listPath = process.argv[2];
  if (!listPath) {
    console.error('Usage: bun run scripts/ingest-video-list.ts <list-file> [limit]');
    process.exit(1);
  }
  const limitArg = process.argv[3];
  const limit = limitArg ? parseInt(limitArg, 10) : Infinity;
  if (Number.isNaN(limit) || limit <= 0) {
    console.error(`Invalid limit '${limitArg}'`);
    process.exit(1);
  }

  const listed = parseList(await Bun.file(listPath).text());
  const pending = listed.filter(video => !isVideoScraped(video.videoId)).slice(0, limit);

  console.log(`List: ${listed.length} videos, ${pending.length} to ingest`);
  console.log(`Chroma: ${config.chromaUrl} → ${config.youtubeCollectionName}`);
  console.log(`Tracker: ${config.youtubeTrackerFile}\n`);

  let ok = 0;
  let failed = 0;
  let chunks = 0;
  let rateLimitRetries = 0;

  for (let i = 0; i < pending.length; ) {
    // filter on every pass: a rate-limit retry must not re-fetch videos already tracked
    const batch = pending.slice(i, i + BATCH_SIZE).filter(video => !isVideoScraped(video.videoId));
    const result = await processBatch(batch);

    if (result.processed.length > 0) {
      // store first, track second: a crash between them re-ingests (upsert) rather than loses
      await storeInVectorDB(result.processed);
      markStored(result.processed);
      ok += result.processed.length;
      chunks += result.processed.reduce((sum, t) => sum + t.chunks.length, 0);
    }
    failed += result.failed;

    if (result.rateLimited) {
      rateLimitRetries++;
      if (rateLimitRetries > MAX_RATE_LIMIT_RETRIES) {
        console.error('\nStill rate-limited after retries. Stopping; re-run later to resume.');
        break;
      }
      console.warn(`\nRate-limited by YouTube. Backing off ${RATE_LIMIT_BACKOFF_MS / 60000} min (retry ${rateLimitRetries}/${MAX_RATE_LIMIT_RETRIES})`);
      await sleep(RATE_LIMIT_BACKOFF_MS);
      continue; // retry the same batch
    }

    rateLimitRetries = 0;
    i += BATCH_SIZE;
    console.log(`Progress: ${Math.min(i, pending.length)}/${pending.length} (ok=${ok}, failed=${failed}, chunks=${chunks})`);
    await sleep(DELAY_BETWEEN_BATCHES_MS);
  }

  console.log(`\nDone. Ingested ${ok} videos (${chunks} chunks), ${failed} failed.`);
}

main().catch(error => {
  console.error('Ingest failed:', error);
  process.exit(1);
});
