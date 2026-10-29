import { getRedis } from '../lib/queue/redis';

const MAX_RECENT = 20;
const REDIS_TIMEOUT_MS = 500;
const RECENT_TTL_SECONDS = 60 * 60 * 24 * 90;

export interface RecentSearch {
  question: string;
  askedAt: string;
}

// In-memory fallback when Redis is down; lost on restart, which is acceptable for history.
const memory = new Map<string, RecentSearch[]>();

function key(channelId: string, clientId: string): string {
  return `recent:${channelId}:${clientId}`;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Redis timeout')), REDIS_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Newest first, one entry per question (case/whitespace-insensitive). */
export function mergeRecent(entry: RecentSearch, existing: RecentSearch[]): RecentSearch[] {
  const normalized = entry.question.trim().toLowerCase();
  const rest = existing.filter(e => e.question.trim().toLowerCase() !== normalized);
  return [entry, ...rest].slice(0, MAX_RECENT);
}

function rememberInMemory(k: string, entry: RecentSearch): void {
  memory.set(k, mergeRecent(entry, memory.get(k) ?? []));
}

/**
 * Sorted set keyed by the question, scored by time: asking again moves it
 * to the top instead of adding a duplicate.
 */
export async function recordSearch(
  channelId: string,
  clientId: string,
  question: string
): Promise<void> {
  const askedAt = Date.now();
  const entry: RecentSearch = { question: question.trim(), askedAt: new Date(askedAt).toISOString() };
  const k = key(channelId, clientId);
  try {
    const results = await withTimeout(
      getRedis()
        .multi()
        .zadd(k, askedAt, entry.question)
        .zremrangebyrank(k, 0, -(MAX_RECENT + 1))
        .expire(k, RECENT_TTL_SECONDS)
        .exec()
    );
    // exec() resolves with per-command [error, result] pairs instead of throwing
    const failed = results?.find(([error]) => error);
    if (!results || failed) throw failed?.[0] ?? new Error('Redis transaction aborted');
  } catch (error) {
    console.warn('Recent search not saved to Redis, using memory:', error);
    rememberInMemory(k, entry);
  }
}

export async function listRecentSearches(
  channelId: string,
  clientId: string,
  limit: number = 10
): Promise<RecentSearch[]> {
  const k = key(channelId, clientId);
  try {
    const flat = await withTimeout(getRedis().zrevrange(k, 0, MAX_RECENT - 1, 'WITHSCORES'));
    let entries: RecentSearch[] = [];
    // oldest first through mergeRecent so the newest casing of a repeated question wins
    for (let i = flat.length - 2; i >= 0; i -= 2) {
      entries = mergeRecent(
        { question: flat[i], askedAt: new Date(Number(flat[i + 1])).toISOString() },
        entries
      );
    }
    return entries.slice(0, limit);
  } catch (error) {
    console.warn('Recent searches unavailable from Redis, using memory:', error);
    return (memory.get(k) ?? []).slice(0, limit);
  }
}

export async function clearRecentSearches(channelId: string, clientId: string): Promise<void> {
  const k = key(channelId, clientId);
  memory.delete(k);
  try {
    await withTimeout(getRedis().del(k));
  } catch (error) {
    console.warn('Could not clear recent searches in Redis:', error);
  }
}
