import { listChannels, type Channel } from '../channels/registry';
import { KnowledgeError } from './types';

type ChannelLike = Pick<Channel, 'id' | 'status'>;

/** Channels that have anything to search yet. */
function searchable(channel: ChannelLike): boolean {
  return channel.status === 'ready' || channel.status === 'indexing' || channel.status === 'paused';
}

/**
 * Resolve the channels a request targets. Callers must name them: agents
 * should choose their sources deliberately. Unknown ids fail fast so an
 * agent learns about a typo instead of silently searching less.
 */
export function resolveChannels(ids: string[]): Channel[] {
  return selectChannels(listChannels(), ids);
}

export function selectChannels<T extends ChannelLike>(all: T[], ids: string[]): T[] {
  if (ids.length === 0) {
    const valid = all.filter(searchable).map(channel => channel.id).join(', ');
    throw new KnowledgeError(`Pass at least one channel id. Available: ${valid}`);
  }
  const byId = new Map(all.map(channel => [channel.id, channel]));
  const unknown = ids.filter(id => !byId.has(id));
  if (unknown.length > 0) {
    const valid = all.map(channel => channel.id).join(', ');
    throw new KnowledgeError(`Unknown channel(s): ${unknown.join(', ')}. Valid: ${valid}`, 404);
  }
  return [...new Set(ids)].map(id => byId.get(id) as T);
}
