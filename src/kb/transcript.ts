import { getVideoChunks } from '../lib/youtube-vectorstore';
import { resolveChannels } from './channels';
import { toPassage } from './search';
import { KnowledgeError, type Passage } from './types';

export interface TranscriptResponse {
  channel: { id: string; name: string };
  video: { id: string; title: string; url: string };
  /** Consecutive passages; neighbours overlap slightly by design */
  passages: Passage[];
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** The full indexed transcript of one video, for agents that need more than a passage. */
export async function getTranscript(channelId: string, videoId: string): Promise<TranscriptResponse> {
  if (!VIDEO_ID.test(videoId)) throw new KnowledgeError('videoId must be an 11-character YouTube id');
  const [channel] = resolveChannels([channelId]);
  const chunks = await getVideoChunks(channel.collection, videoId);
  if (chunks.length === 0) {
    throw new KnowledgeError(`Video ${videoId} is not indexed in channel ${channel.id}`, 404);
  }
  const passages = chunks.map(chunk => toPassage(chunk, channel));
  return {
    channel: { id: channel.id, name: channel.name },
    video: passages[0].video,
    passages,
  };
}
