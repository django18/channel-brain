import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { ask } from '../lib/retrieval/advisor';
import { unlinkSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config';
import { deleteCollection, getCollectionStats } from '../lib/youtube-vectorstore';
import { getChannel, listChannels, type Channel } from '../channels/registry';
import { getLibrary, invalidateLibrary, suggestQuestions } from '../channels/library';
import { listChannel, parseChannelInput } from '../channels/youtube-listing';
import { addUserChannel, listUserChannels, removeUserChannel, updateUserChannel } from '../channels/user-channels';
import { cancelIndexing, enqueueIndexing } from '../channels/indexer';
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

const DEFAULT_MAX_VIDEOS = 200;

const AddChannelSchema = z.object({
  channelUrl: z.string().trim().min(2).max(300),
  topic: z.string().trim().max(60).optional(),
  maxVideos: z.number().int().min(1).max(config.maxVideosPerChannel).default(DEFAULT_MAX_VIDEOS),
});

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
    userAdded: channel.userAdded,
    status: channel.status,
    progress: channel.progress,
    error: channel.error,
    // while indexing, the live counter is fresher than the cached library
    videos: channel.status === 'ready' ? getLibrary(channel).length : channel.progress?.ingested ?? 0,
    chunks: stats?.totalChunks ?? null,
  };
}

function slugify(text: string): string {
  const slug = text.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36);
  return slug.length >= 2 ? slug : 'channel';
}

function uniqueId(base: string): string {
  const taken = new Set(listChannels().map(channel => channel.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

function findExisting(keys: string[]): Channel | null {
  const wanted = new Set(keys.map(key => key.toLowerCase()));
  const userKeys = new Map(listUserChannels().map(c => [c.id, c.youtubeKey.toLowerCase()]));
  return (
    listChannels().find(
      channel => wanted.has(channel.handle.toLowerCase()) || wanted.has(userKeys.get(channel.id) ?? '')
    ) ?? null
  );
}

/** GET /api/channels — every channel the app can answer from, with library size. */
channels.get('/', async (c) => {
  const data = await Promise.all(listChannels().map(describe));
  return c.json({ success: true, data });
});

/**
 * POST /api/channels — add a channel and start building its knowledge base
 * in the background. Reads the channel once up front so a bad URL fails
 * here, with a clear message, instead of later in the queue.
 */
channels.post('/', async (c) => {
  let body: z.infer<typeof AddChannelSchema>;
  try {
    body = AddChannelSchema.parse(await c.req.json());
  } catch (error) {
    const issues = error instanceof z.ZodError ? error.issues : undefined;
    return c.json({ success: false, error: 'Invalid request', issues }, 400);
  }

  const ref = parseChannelInput(body.channelUrl);
  if (!ref) {
    return c.json({ success: false, error: 'Enter a YouTube channel link like youtube.com/@channel or an @handle.' }, 400);
  }
  const already = findExisting([ref.key]);
  if (already) return c.json({ success: false, error: `${already.name} is already added.`, data: { id: already.id } }, 409);

  let listing;
  try {
    listing = await listChannel(ref, 1);
  } catch (error) {
    console.warn('Channel lookup failed:', error);
    const message = error instanceof Error ? error.message : 'Could not read that channel.';
    return c.json({ success: false, error: message }, 422);
  }
  const duplicate = findExisting([listing.handle, ...(listing.channelId ? [listing.channelId] : [])]);
  if (duplicate) return c.json({ success: false, error: `${duplicate.name} is already added.`, data: { id: duplicate.id } }, 409);

  const id = uniqueId(slugify(listing.handle || listing.name));
  addUserChannel({
    id,
    name: listing.name,
    handle: listing.handle.startsWith('@') ? listing.handle : ref.key,
    channelUrl: ref.url,
    topic: body.topic || 'YouTube channel',
    description: listing.description.slice(0, 500),
    domain: 'general',
    collection: `channel_${id.replace(/-/g, '_')}`,
    trackerFile: `./data/youtube/${id}-scraped.json`,
    youtubeKey: ref.key,
    maxVideos: body.maxVideos,
    addedAt: new Date().toISOString(),
    status: 'queued',
    progress: null,
    error: null,
  });
  enqueueIndexing(id);

  const channel = getChannel(id);
  return c.json({ success: true, data: channel ? await describe(channel) : { id } }, 202);
});

/** POST /api/channels/:id/resume — retry a paused or failed channel (picks up where it stopped). */
channels.post('/:id/resume', async (c) => {
  const channel = getChannel(c.req.param('id'));
  if (!channel) return notFound(c, c.req.param('id'));
  if (!channel.userAdded) return c.json({ success: false, error: 'Built-in channels are indexed from the CLI.' }, 400);
  if (channel.status !== 'paused' && channel.status !== 'failed') {
    return c.json({ success: false, error: `Channel is ${channel.status}, nothing to resume.` }, 409);
  }
  updateUserChannel(channel.id, { status: 'queued', error: null });
  enqueueIndexing(channel.id);
  const updated = getChannel(channel.id);
  return c.json({ success: true, data: updated ? await describe(updated) : null }, 202);
});

/** DELETE /api/channels/:id — remove a channel added in the app, with its index and history file. */
channels.delete('/:id', async (c) => {
  const channel = getChannel(c.req.param('id'));
  if (!channel) return notFound(c, c.req.param('id'));
  if (!channel.userAdded) return c.json({ success: false, error: 'Built-in channels can only be removed from channels.json.' }, 400);

  cancelIndexing(channel.id);
  removeUserChannel(channel.id);
  invalidateLibrary(channel.id);
  try {
    await deleteCollection(channel.collection);
    const ledger = resolve(process.cwd(), channel.trackerFile);
    if (existsSync(ledger)) unlinkSync(ledger);
  } catch (error) {
    console.error(`Cleanup after removing channel '${channel.id}' failed:`, error);
  }
  return c.json({ success: true, data: { id: channel.id } });
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
