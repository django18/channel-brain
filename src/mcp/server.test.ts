import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createKnowledgeMcpServer, type KnowledgeDeps } from './server';
import { KnowledgeError } from '../kb/types';

const passage = {
  id: 'p1',
  channel: { id: 'internachi', name: 'InterNACHI' },
  video: { id: 'abcdefghijk', title: 'Roof hail', url: 'https://www.youtube.com/watch?v=abcdefghijk' },
  timestamp: '1:01',
  startSeconds: 61,
  url: 'https://www.youtube.com/watch?v=abcdefghijk&t=61s',
  text: 'Look for bruised shingles.',
  similarity: 0.62,
};

let client: Client;

beforeAll(async () => {
  const deps: KnowledgeDeps = {
    listChannels: () => [{ id: 'internachi', name: 'InterNACHI', topic: 'Home inspection', status: 'ready', videos: 3358 }],
    search: async ({ query, channels }) => {
      if (channels?.includes('nope')) throw new KnowledgeError('Unknown channel(s): nope. Valid: internachi', 404);
      return { query, channelsSearched: ['internachi'], passages: [passage] };
    },
    ask: async ({ question }) => ({
      question,
      answer: 'Bruised shingles [1].',
      synthesized: true,
      channelsSearched: ['internachi'],
      passages: [passage],
      model: 'test',
      ms: 1,
    }),
    transcript: async () => ({ channel: passage.channel, video: passage.video, passages: [passage] }),
  };
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createKnowledgeMcpServer(deps).connect(serverSide);
  client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientSide);
});

const textOf = (result: unknown) => (result as { content: Array<{ text: string }> }).content[0].text;

describe('knowledge MCP server', () => {
  test('exposes the four read-only tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map(t => t.name).sort()).toEqual(['ask_knowledge', 'get_video_transcript', 'list_channels', 'search_knowledge']);
    expect(tools.every(t => t.annotations?.readOnlyHint)).toBe(true);
  });

  test('search returns citable passages with deep links', async () => {
    const text = textOf(await client.callTool({ name: 'search_knowledge', arguments: { query: 'hail', channels: ['internachi'] } }));
    expect(text).toContain('[1] InterNACHI — "Roof hail" @ 1:01');
    expect(text).toContain('&t=61s');
  });

  test('ask returns the answer followed by its passages', async () => {
    const text = textOf(await client.callTool({ name: 'ask_knowledge', arguments: { question: 'hail?', channels: ['internachi'] } }));
    expect(text.startsWith('Bruised shingles [1].')).toBe(true);
    expect(text).toContain('Passages:');
  });

  test('knowledge errors come back as tool errors the agent can act on', async () => {
    const result = await client.callTool({ name: 'search_knowledge', arguments: { query: 'roof', channels: ['nope'] } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Valid: internachi');
  });

  test('list_channels shows ids agents can pass back', async () => {
    const text = textOf(await client.callTool({ name: 'list_channels', arguments: {} }));
    expect(text).toContain('internachi: InterNACHI (Home inspection) — 3358 videos, ready');
  });

  test('transcript tool prints timestamped passages', async () => {
    const text = textOf(await client.callTool({ name: 'get_video_transcript', arguments: { channel: 'internachi', video_id: 'abcdefghijk' } }));
    expect(text).toContain('[1:01] Look for bruised shingles.');
  });

  test('channels are required', async () => {
    const result = await client.callTool({ name: 'search_knowledge', arguments: { query: 'roof' } });
    expect(result.isError).toBe(true);
  });
});
