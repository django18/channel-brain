import { z } from 'zod';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { config } from '../config';

export const ChannelStatusSchema = z.enum(['queued', 'listing', 'indexing', 'ready', 'paused', 'failed']);
export type ChannelStatus = z.infer<typeof ChannelStatusSchema>;

const ProgressSchema = z.object({
  total: z.number(),
  done: z.number(),
  ingested: z.number(),
  failed: z.number(),
  chunks: z.number(),
});
export type ChannelProgress = z.infer<typeof ProgressSchema>;

export const UserChannelSchema = z.object({
  id: z.string(),
  name: z.string(),
  handle: z.string(),
  channelUrl: z.string().url(),
  topic: z.string(),
  description: z.string().default(''),
  domain: z.literal('general'),
  collection: z.string(),
  trackerFile: z.string(),
  /** '@handle' or UC… id, lowercase handle: used to refuse duplicates */
  youtubeKey: z.string(),
  maxVideos: z.number().int().positive(),
  addedAt: z.string(),
  status: ChannelStatusSchema,
  progress: ProgressSchema.nullable().default(null),
  error: z.string().nullable().default(null),
});
export type UserChannel = z.infer<typeof UserChannelSchema>;

const path = () => resolve(process.cwd(), config.userChannelsFile);

let channels: readonly UserChannel[] | null = null;

function load(): readonly UserChannel[] {
  if (channels) return channels;
  if (!existsSync(path())) {
    channels = [];
    return channels;
  }
  try {
    channels = z.array(UserChannelSchema).parse(JSON.parse(readFileSync(path(), 'utf-8')));
  } catch (error) {
    // never overwrite a file we couldn't read: fail loudly instead of losing channels
    throw new Error(`Could not read ${config.userChannelsFile}: ${error instanceof Error ? error.message : error}`);
  }
  return channels;
}

function persist(next: readonly UserChannel[]): void {
  mkdirSync(dirname(path()), { recursive: true });
  const tmp = `${path()}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
  renameSync(tmp, path());
  channels = next;
}

export function listUserChannels(): readonly UserChannel[] {
  return load();
}

export function getUserChannel(id: string): UserChannel | null {
  return load().find(channel => channel.id === id) ?? null;
}

export function addUserChannel(channel: UserChannel): void {
  persist([...load(), channel]);
}

export function updateUserChannel(id: string, patch: Partial<Omit<UserChannel, 'id'>>): UserChannel | null {
  const current = getUserChannel(id);
  if (!current) return null;
  const updated = { ...current, ...patch };
  persist(load().map(channel => (channel.id === id ? updated : channel)));
  return updated;
}

export function removeUserChannel(id: string): void {
  persist(load().filter(channel => channel.id !== id));
}
