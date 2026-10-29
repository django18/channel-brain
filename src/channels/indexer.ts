import { ingestVideos } from '../lib/ingest/ingest-videos';
import { VideoLedger } from '../lib/ingest/video-ledger';
import { invalidateLibrary } from './library';
import { listChannel, parseChannelInput } from './youtube-listing';
import { getUserChannel, listUserChannels, updateUserChannel } from './user-channels';

/**
 * Builds knowledge bases for channels added in the app, one at a time
 * (YouTube rate-limits transcript fetches per IP, so parallel jobs only
 * slow each other down). Progress is persisted, and unfinished channels
 * resume on server start.
 */
const queue: string[] = [];
const cancelled = new Set<string>();
let running: string | null = null;

const log = (id: string) => (message: string) => console.log(`[indexer:${id}] ${message}`);

export function enqueueIndexing(channelId: string): void {
  cancelled.delete(channelId);
  if (running === channelId || queue.includes(channelId)) return;
  queue.push(channelId);
  void drain();
}

/** Stop a channel's indexing at the next batch boundary (used on delete). */
export function cancelIndexing(channelId: string): void {
  cancelled.add(channelId);
  const index = queue.indexOf(channelId);
  if (index >= 0) queue.splice(index, 1);
}

export function resumeUnfinishedIndexing(): void {
  for (const channel of listUserChannels()) {
    if (channel.status === 'queued' || channel.status === 'listing' || channel.status === 'indexing') {
      enqueueIndexing(channel.id);
    }
  }
}

async function drain(): Promise<void> {
  if (running) return;
  const next = queue.shift();
  if (!next) return;
  running = next;
  try {
    await indexChannel(next);
  } catch (error) {
    console.error(`[indexer:${next}] failed:`, error);
    if (getUserChannel(next)) {
      updateUserChannel(next, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Indexing failed',
      });
    }
  } finally {
    running = null;
    void drain();
  }
}

async function indexChannel(id: string): Promise<void> {
  const channel = getUserChannel(id);
  if (!channel || cancelled.has(id)) return;
  const ref = parseChannelInput(channel.channelUrl);
  if (!ref) throw new Error('Stored channel URL is no longer valid');

  updateUserChannel(id, { status: 'listing', error: null });
  const listing = await listChannel(ref, channel.maxVideos);
  if (listing.videos.length === 0) throw new Error('This channel has no public videos');
  if (cancelled.has(id)) return;

  updateUserChannel(id, { status: 'indexing' });
  const outcome = await ingestVideos(listing.videos, {
    collectionName: channel.collection,
    ledger: new VideoLedger(channel.trackerFile),
    log: log(id),
    shouldStop: () => cancelled.has(id),
    onProgress: progress => {
      if (getUserChannel(id)) updateUserChannel(id, { progress });
    },
  });
  invalidateLibrary(id);
  if (outcome.stopped === 'cancelled' || !getUserChannel(id)) return;

  if (outcome.stopped === 'rate-limited') {
    updateUserChannel(id, {
      status: 'paused',
      error: 'YouTube is rate-limiting transcript requests. Try resuming in an hour.',
    });
    return;
  }
  const indexedAny = new VideoLedger(channel.trackerFile).successCount() > 0;
  updateUserChannel(
    id,
    indexedAny
      ? { status: 'ready', error: null }
      : { status: 'failed', error: 'None of these videos have transcripts, so there is nothing to search.' }
  );
}
