import { searchCollections, type SearchResult } from '../lib/youtube-vectorstore';
import type { Channel } from '../channels/registry';
import { resolveChannels } from './channels';
import type { Passage } from './types';

export const SEARCH_DEFAULT_LIMIT = 8;
export const SEARCH_MAX_LIMIT = 25;

export interface SearchRequest {
  query: string;
  channels: string[];
  limit?: number;
  minSimilarity?: number;
}

export interface SearchResponse {
  query: string;
  channelsSearched: string[];
  passages: Passage[];
}

export function toPassage(result: SearchResult, channel: Pick<Channel, 'id' | 'name'>): Passage {
  const startSeconds = Math.floor((result.startTime ?? 0) / 1000);
  const separator = result.videoUrl.includes('?') ? '&' : '?';
  return {
    id: result.id,
    channel: { id: channel.id, name: channel.name },
    video: { id: result.videoId, title: result.videoTitle, url: result.videoUrl },
    timestamp: result.timestamp,
    startSeconds,
    url: `${result.videoUrl}${separator}t=${startSeconds}s`,
    text: result.text,
    similarity: Math.round(result.similarity * 1000) / 1000,
  };
}

type CollectionHit = SearchResult & { collection: string };

/**
 * Merge per-collection hits into one ranked list: filter by similarity,
 * best first, one passage per channel + title + timestamp (overlapping
 * chunks and re-uploads repeat those), then cap.
 */
export function rankPassages(
  results: CollectionHit[],
  byCollection: Map<string, Pick<Channel, 'id' | 'name'>>,
  options: { limit: number; minSimilarity?: number }
): Passage[] {
  const seen = new Set<string>();
  return results
    .filter(result => result.similarity >= (options.minSimilarity ?? 0) && byCollection.has(result.collection))
    .sort((a, b) => b.similarity - a.similarity)
    .filter(result => {
      const key = `${result.collection}|${result.videoTitle.trim().toLowerCase()}@${result.timestamp}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, options.limit)
    .map(result => toPassage(result, byCollection.get(result.collection) as Pick<Channel, 'id' | 'name'>));
}

/**
 * Semantic search across the named channels (one or several). No LLM involved:
 * fast, deterministic, and the raw material agents should reason over.
 */
export async function searchKnowledge(request: SearchRequest): Promise<SearchResponse> {
  const channels = resolveChannels(request.channels);
  const limit = Math.min(request.limit ?? SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT);
  const byCollection = new Map(channels.map(channel => [channel.collection, channel]));

  const results = await searchCollections(request.query, [...byCollection.keys()], limit);
  const passages = rankPassages(results, byCollection, { limit, minSimilarity: request.minSimilarity });

  return { query: request.query, channelsSearched: channels.map(channel => channel.id), passages };
}
