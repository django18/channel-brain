import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { Channel } from './registry';

const CACHE_TTL_MS = 10 * 60 * 1000;
const MIN_TITLE_LENGTH = 20;

export interface LibraryVideo {
  videoId: string;
  title: string;
}

interface TrackerShape {
  videos?: Record<string, { videoId: string; videoTitle: string; status: string }>;
}

const cache = new Map<string, { videos: LibraryVideo[]; loadedAt: number }>();

/**
 * Successfully ingested videos for a channel, read from its tracker file.
 * Cached briefly: the tracker is rewritten while an ingest is running.
 */
export function getLibrary(channel: Channel): LibraryVideo[] {
  const cached = cache.get(channel.id);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.videos;

  const path = resolve(process.cwd(), channel.trackerFile);
  let videos: LibraryVideo[] = [];
  if (existsSync(path)) {
    try {
      const tracker = JSON.parse(readFileSync(path, 'utf-8')) as TrackerShape;
      videos = Object.values(tracker.videos ?? {})
        .filter(video => video.status === 'success')
        .map(video => ({ videoId: video.videoId, title: video.videoTitle }));
    } catch (error) {
      console.error(`Failed to read tracker for channel '${channel.id}':`, error);
    }
  }
  cache.set(channel.id, { videos, loadedAt: Date.now() });
  return videos;
}

function sample<T>(items: T[], count: number): T[] {
  const pool = [...items];
  const picked: T[] = [];
  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool[index]);
    pool.splice(index, 1);
  }
  return picked;
}

/**
 * Starter questions: the domain's curated examples plus a few drawn from
 * real video titles, so suggestions rotate and always point at content
 * that exists in this channel's library.
 */
export function suggestQuestions(channel: Channel, count: number = 6): string[] {
  const curated = sample(channel.profile.exampleQuestions, Math.ceil(count / 2));
  const keep = channel.profile.suggestionTitleFilter ?? (() => true);
  const titles = getLibrary(channel).filter(
    video => video.title.length >= MIN_TITLE_LENGTH && keep(video.title)
  );
  const fromLibrary = sample(titles, count - curated.length).map(video =>
    // a title that is already a question reads better asked directly
    video.title.trim().endsWith('?')
      ? video.title.trim()
      : `What are the key takeaways from "${video.title}"?`
  );
  return [...curated, ...fromLibrary];
}
