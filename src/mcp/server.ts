import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { listChannels } from '../channels/registry';
import { getLibrary } from '../channels/library';
import { askKnowledge } from '../kb/ask';
import { searchKnowledge, SEARCH_MAX_LIMIT } from '../kb/search';
import { getTranscript } from '../kb/transcript';
import { KnowledgeError } from '../kb/types';
import { ChannelIds, QueryText, QuestionText } from '../kb/schemas';
import { formatPassages } from './format';

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });

async function run(fn: () => Promise<string>): Promise<ToolResult> {
  try {
    return text(await fn());
  } catch (error) {
    // agents can act on these messages (e.g. unknown channel id lists the valid ones)
    const message = error instanceof KnowledgeError ? error.message : 'Knowledge base unavailable. Try again shortly.';
    if (!(error instanceof KnowledgeError)) console.error('MCP tool error:', error);
    return { ...text(message), isError: true };
  }
}

// same rules as the REST API, so both doors validate identically
const channelsParam = ChannelIds.describe('Channel ids from list_channels (at least one). Call list_channels first if unsure.');

export interface ChannelSummary {
  id: string;
  name: string;
  topic: string;
  status: string;
  videos: number;
}

export interface KnowledgeDeps {
  listChannels: () => ChannelSummary[];
  search: typeof searchKnowledge;
  ask: typeof askKnowledge;
  transcript: typeof getTranscript;
}

const defaultDeps: KnowledgeDeps = {
  listChannels: () =>
    listChannels().map(channel => ({
      id: channel.id,
      name: channel.name,
      topic: channel.topic,
      status: channel.status,
      videos: channel.status === 'ready' ? getLibrary(channel).length : channel.progress?.ingested ?? 0,
    })),
  search: searchKnowledge,
  ask: askKnowledge,
  transcript: getTranscript,
};

/**
 * MCP server over the knowledge base. Built per request (stateless
 * transport), so it holds no state of its own. Dependencies are
 * injectable for tests.
 */
export function createKnowledgeMcpServer(deps: KnowledgeDeps = defaultDeps): McpServer {
  const server = new McpServer({ name: 'channel-knowledge', version: '1.0.0' });

  server.registerTool(
    'list_channels',
    {
      title: 'List channels',
      description: 'List the YouTube channels in the knowledge base with their topic and number of indexed videos.',
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () =>
        deps
          .listChannels()
          .map(c => `- ${c.id}: ${c.name} (${c.topic}) — ${c.videos} videos, ${c.status}`)
          .join('\n')
      )
  );

  server.registerTool(
    'search_knowledge',
    {
      title: 'Search transcripts',
      description:
        'Semantic search over the transcripts of the channels you name. Returns the most relevant passages with channel, video title, timestamp and a link that opens the video at that moment. Use this to gather evidence before answering.',
      inputSchema: {
        query: QueryText.describe('What to look for, in natural language'),
        channels: channelsParam,
        limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).optional().describe('Passages to return (default 8)'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ query, channels, limit }) =>
      run(async () => {
        const result = await deps.search({ query, channels, limit });
        return `Searched: ${result.channelsSearched.join(', ')}\n\n${formatPassages(result.passages)}`;
      })
  );

  server.registerTool(
    'ask_knowledge',
    {
      title: 'Ask the channels',
      description:
        'Answer a question using only the channels\' transcripts. Returns a written answer with [n] citations followed by the cited passages. Prefer search_knowledge when you want to reason over raw evidence yourself.',
      inputSchema: {
        question: QuestionText.describe('The question to answer'),
        channels: channelsParam,
      },
      annotations: { readOnlyHint: true },
    },
    ({ question, channels }) =>
      run(async () => {
        const result = await deps.ask({ question, channels });
        const answer = result.answer ?? '(No written answer available; the passages below are the best matches.)';
        return `${answer}\n\n---\nPassages:\n\n${formatPassages(result.passages)}`;
      })
  );

  server.registerTool(
    'get_video_transcript',
    {
      title: 'Read a video transcript',
      description:
        'Fetch the full indexed transcript of one video, in order, when a passage is not enough context. Use the channel id and video id from a search result.',
      inputSchema: {
        channel: z.string().regex(/^[a-z0-9-]{2,40}$/).describe('Channel id, e.g. internachi'),
        video_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/).describe('11-character YouTube video id'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ channel, video_id }) =>
      run(async () => {
        const transcript = await deps.transcript(channel, video_id);
        const body = transcript.passages.map(p => `[${p.timestamp}] ${p.text.trim()}`).join('\n\n');
        return `${transcript.channel.name} — "${transcript.video.title}"\n${transcript.video.url}\n\n${body}`;
      })
  );

  return server;
}
