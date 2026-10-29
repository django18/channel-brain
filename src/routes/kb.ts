import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { listChannels } from '../channels/registry';
import { getLibrary } from '../channels/library';
import { askKnowledge } from '../kb/ask';
import { buildOpenApi } from '../kb/openapi';
import { AskRequestSchema, SearchRequestSchema } from '../kb/schemas';
import { searchKnowledge } from '../kb/search';
import { getTranscript } from '../kb/transcript';
import { KnowledgeError } from '../kb/types';

/**
 * Agent-facing knowledge API: one consistent envelope, every channel
 * searchable at once, passages that carry their own citation links.
 */
const kb = new Hono();

function fail(c: Context, error: unknown) {
  if (error instanceof z.ZodError) {
    return c.json({ success: false, error: 'Invalid request', issues: error.issues }, 400);
  }
  if (error instanceof KnowledgeError) {
    return c.json({ success: false, error: error.message }, error.status);
  }
  console.error('Knowledge API error:', error);
  return c.json({ success: false, error: 'Knowledge base unavailable. Try again shortly.' }, 500);
}

async function body(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new KnowledgeError('Body must be JSON');
  }
}

kb.get('/channels', (c) =>
  c.json({
    success: true,
    data: listChannels().map(channel => ({
      id: channel.id,
      name: channel.name,
      handle: channel.handle,
      topic: channel.topic,
      url: channel.channelUrl,
      status: channel.status,
      videos: channel.status === 'ready' ? getLibrary(channel).length : channel.progress?.ingested ?? 0,
    })),
  })
);

kb.post('/search', async (c) => {
  try {
    return c.json({ success: true, data: await searchKnowledge(SearchRequestSchema.parse(await body(c))) });
  } catch (error) {
    return fail(c, error);
  }
});

kb.post('/ask', async (c) => {
  try {
    return c.json({ success: true, data: await askKnowledge(AskRequestSchema.parse(await body(c))) });
  } catch (error) {
    return fail(c, error);
  }
});

kb.get('/channels/:channelId/videos/:videoId', async (c) => {
  try {
    return c.json({ success: true, data: await getTranscript(c.req.param('channelId'), c.req.param('videoId')) });
  } catch (error) {
    return fail(c, error);
  }
});

kb.get('/openapi.json', (c) => c.json(buildOpenApi(new URL(c.req.url).origin)));

export default kb;
