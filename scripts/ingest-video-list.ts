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
import { ingestVideos, type IngestVideo } from '../src/lib/ingest/ingest-videos';
import { VideoLedger } from '../src/lib/ingest/video-ledger';
import { config } from '../src/config';

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

function parseList(text: string): IngestVideo[] {
  const seen = new Set<string>();
  const videos: IngestVideo[] = [];
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

  const ledger = new VideoLedger(config.youtubeTrackerFile);
  const listed = parseList(await Bun.file(listPath).text());
  const videos = listed.filter(video => !ledger.has(video.videoId)).slice(0, limit);

  console.log(`List: ${listed.length} videos, ${videos.length} to ingest`);
  console.log(`Chroma: ${config.chromaUrl} → ${config.youtubeCollectionName}`);
  console.log(`Tracker: ${config.youtubeTrackerFile}\n`);

  const outcome = await ingestVideos(videos, {
    collectionName: config.youtubeCollectionName,
    ledger,
  });

  if (outcome.stopped === 'rate-limited') {
    console.error('\nStill rate-limited after retries. Stopping; re-run later to resume.');
  }
  console.log(`\nDone. Ingested ${outcome.ingested} videos (${outcome.chunks} chunks), ${outcome.failed} failed.`);
}

main().catch(error => {
  console.error('Ingest failed:', error);
  process.exit(1);
});
