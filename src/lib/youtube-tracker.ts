/**
 * Video tracking system to avoid re-scraping already processed videos
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { config } from '../config';

const TRACKER_FILE = resolve(process.cwd(), config.youtubeTrackerFile);
const DATA_DIR = dirname(TRACKER_FILE);

export interface ScrapedVideoRecord {
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  channelId?: string;
  channelTitle?: string;
  scrapedAt: string;
  chunksCount: number;
  transcriptLength: number;
  status: 'success' | 'failed' | 'no-transcript';
  errorMessage?: string;
}

export interface VideoTracker {
  version: string;
  totalVideosProcessed: number;
  totalSuccessful: number;
  totalFailed: number;
  videos: Record<string, ScrapedVideoRecord>;
}

/**
 * Initialize tracker file if it doesn't exist
 */
function initializeTracker(): VideoTracker {
  // Ensure data directory exists
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  return {
    version: '1.0',
    totalVideosProcessed: 0,
    totalSuccessful: 0,
    totalFailed: 0,
    videos: {},
  };
}

/**
 * Load tracker data from disk
 */
export function loadTracker(): VideoTracker {
  if (!existsSync(TRACKER_FILE)) {
    return initializeTracker();
  }

  try {
    const data = readFileSync(TRACKER_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to load tracker, creating new one:', error);
    return initializeTracker();
  }
}

/**
 * Save tracker data to disk
 */
export function saveTracker(tracker: VideoTracker): void {
  try {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    writeFileSync(TRACKER_FILE, JSON.stringify(tracker, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save tracker:', error);
    throw error;
  }
}

/**
 * Check if a video has already been scraped
 */
export function isVideoScraped(videoId: string): boolean {
  const tracker = loadTracker();
  return videoId in tracker.videos;
}

/**
 * Check if a video was successfully scraped
 */
export function isVideoScrapedSuccessfully(videoId: string): boolean {
  const tracker = loadTracker();
  return tracker.videos[videoId]?.status === 'success';
}

/**
 * Get scraped video record
 */
export function getVideoRecord(videoId: string): ScrapedVideoRecord | null {
  const tracker = loadTracker();
  return tracker.videos[videoId] || null;
}

/**
 * Mark video as scraped successfully
 */
export function markVideoAsScraped(record: Omit<ScrapedVideoRecord, 'scrapedAt' | 'status'>): void {
  const tracker = loadTracker();

  const fullRecord: ScrapedVideoRecord = {
    ...record,
    scrapedAt: new Date().toISOString(),
    status: 'success',
  };

  tracker.videos[record.videoId] = fullRecord;
  tracker.totalVideosProcessed++;
  tracker.totalSuccessful++;

  saveTracker(tracker);
}

/**
 * Mark video as failed
 */
export function markVideoAsFailed(
  videoId: string,
  videoTitle: string,
  videoUrl: string,
  errorMessage: string,
  noTranscript: boolean = false
): void {
  const tracker = loadTracker();

  const record: ScrapedVideoRecord = {
    videoId,
    videoTitle,
    videoUrl,
    scrapedAt: new Date().toISOString(),
    status: noTranscript ? 'no-transcript' : 'failed',
    chunksCount: 0,
    transcriptLength: 0,
    errorMessage,
  };

  tracker.videos[videoId] = record;
  tracker.totalVideosProcessed++;
  tracker.totalFailed++;

  saveTracker(tracker);
}

/**
 * Get list of successfully scraped video IDs
 */
export function getScrapedVideoIds(): string[] {
  const tracker = loadTracker();
  return Object.keys(tracker.videos).filter(
    (id) => tracker.videos[id].status === 'success'
  );
}

/**
 * Get list of failed video IDs
 */
export function getFailedVideoIds(): string[] {
  const tracker = loadTracker();
  return Object.keys(tracker.videos).filter(
    (id) => tracker.videos[id].status === 'failed' || tracker.videos[id].status === 'no-transcript'
  );
}

/**
 * Get tracker statistics
 */
export function getTrackerStats(): {
  totalProcessed: number;
  successful: number;
  failed: number;
  noTranscript: number;
  successRate: string;
} {
  const tracker = loadTracker();

  const noTranscript = Object.values(tracker.videos).filter(
    (v) => v.status === 'no-transcript'
  ).length;

  const successRate =
    tracker.totalVideosProcessed > 0
      ? ((tracker.totalSuccessful / tracker.totalVideosProcessed) * 100).toFixed(1)
      : '0';

  return {
    totalProcessed: tracker.totalVideosProcessed,
    successful: tracker.totalSuccessful,
    failed: tracker.totalFailed - noTranscript,
    noTranscript,
    successRate: successRate + '%',
  };
}

/**
 * Filter out already scraped videos from a list
 */
export function filterUnscrapedVideos<T extends { videoId: string }>(
  videos: T[]
): T[] {
  const tracker = loadTracker();
  return videos.filter((video) => !(video.videoId in tracker.videos));
}

/**
 * Get recently scraped videos
 */
export function getRecentlyScrapedVideos(limit: number = 10): ScrapedVideoRecord[] {
  const tracker = loadTracker();

  return Object.values(tracker.videos)
    .filter((v) => v.status === 'success')
    .sort((a, b) => new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime())
    .slice(0, limit);
}

/**
 * Clear all tracked videos (use with caution!)
 */
export function clearTracker(): void {
  const tracker = initializeTracker();
  saveTracker(tracker);
  console.log('Tracker cleared');
}

/**
 * Export tracker data as JSON
 */
export function exportTrackerData(): string {
  const tracker = loadTracker();
  return JSON.stringify(tracker, null, 2);
}
