import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { ask } from '../lib/retrieval/advisor';
import { getCollectionStats } from '../lib/youtube-vectorstore';
import { getChannel, listChannels, type Channel } from '../channels/registry';
import { getLibrary, suggestQuestions } from '../channels/library';
import {
  clearRecentSearches,
  listRecentSearches,
  recordSearch,
} from '../channels/recent-searches';

const channels = new Hono();

const QUESTION_MAX_CHARS = 1000;
const HISTORY_MAX_TURNS = 12;

const ChatTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
});

const ChannelAskSchema = z.object({
  question: z.string().trim().min(3).max(QUESTION_MAX_CHARS),
  history: z.array(ChatTurnSchema).max(HISTORY_MAX_TURNS).optional(),
});

const ClientIdSchema = z.string().uuid();

/** Anonymous per-browser id for recent searches; null when absent or malformed. */
function clientIdFrom(c: Context): string | null {
  const parsed = ClientIdSchema.safeParse(c.req.header('x-client-id'));
  return parsed.success ? parsed.data : null;
}

function notFound(c: Context, id: string) {
  return c.json({ success: false, error: `Unknown channel '${id}'` }, 404);
}

async function describe(channel: Channel) {
  const stats = await getCollectionStats(channel.collection).catch(error => {
    console.warn(`Stats unavailable for channel '${channel.id}':`, error);
    return null;
  });
  return {
    id: channel.id,
    name: channel.name,
    handle: channel.handle,
    channelUrl: channel.channelUrl,
    topic: channel.topic,
    description: channel.profile.description,
    graphEnabled: channel.profile.graphEnabled,
    videos: getLibrary(channel).length,
    chunks: stats?.totalChunks ?? null,
  };
}

/** GET /api/channels — every channel the app can answer from, with library size. */
channels.get('/', async (c) => {
  const data = await Promise.all(listChannels().map(describe));
  return c.json({ success: true, data });
});

/** GET /api/channels/:id/suggestions — rotating starter questions. */
channels.get('/:id/suggestions', (c) => {
  const channel = getChannel(c.req.param('id'));
  if (!channel) return notFound(c, c.req.param('id'));
  return c.json({ success: true, data: suggestQuestions(channel) });
});

/** GET /api/channels/:id/recent — this browser's recent questions (x-client-id). */
channels.get('/:id/recent', async (c) => {
  const channel = getChannel(c.req.param('id'));
  if (!channel) return notFound(c, c.req.param('id'));
  const clientId = clientIdFrom(c);
  if (!clientId) return c.json({ success: true, data: [] });
  return c.json({ success: true, data: await listRecentSearches(channel.id, clientId) });
});

/** DELETE /api/channels/:id/recent — forget this browser's history for a channel. */
channels.delete('/:id/recent', async (c) => {
  const channel = getChannel(c.req.param('id'));
  if (!channel) return notFound(c, c.req.param('id'));
  const clientId = clientIdFrom(c);
  if (clientId) await clearRecentSearches(channel.id, clientId);
  return c.json({ success: true, data: [] });
});

/** POST /api/channels/:id/ask — grounded answer from this channel's transcripts. */
channels.post('/:id/ask', async (c) => {
  const channel = getChannel(c.req.param('id'));
  if (!channel) return notFound(c, c.req.param('id'));

  let body: z.infer<typeof ChannelAskSchema>;
  try {
    body = ChannelAskSchema.parse(await c.req.json());
  } catch (error) {
    const issues = error instanceof z.ZodError ? error.issues : undefined;
    return c.json({ success: false, error: 'Invalid request', issues }, 400);
  }

  try {
    const result = await ask(body.question, undefined, {
      domain: channel.profile,
      collectionName: channel.collection,
      history: body.history,
    });
    const clientId = clientIdFrom(c);
    // history is best-effort: never make the answer wait on it
    if (clientId) {
      recordSearch(channel.id, clientId, body.question).catch(error =>
        console.warn('recordSearch failed:', error)
      );
    }
    return c.json({ success: true, data: result });
  } catch (error) {
    console.error(`Ask failed for channel '${channel.id}':`, error);
    return c.json({ success: false, error: 'Could not answer right now. Try again in a moment.' }, 500);
  }
});

export default channels;
