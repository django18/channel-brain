import { z } from 'zod';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config';
import { resolveDomain, type DomainProfile } from '../domains';

const ChannelSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/, 'id must be lowercase letters, digits, dashes'),
  name: z.string().min(1),
  handle: z.string().min(1),
  channelUrl: z.string().url(),
  topic: z.string().min(1),
  domain: z.string().min(1),
  collection: z.string().min(3),
  trackerFile: z.string().min(1),
});

const ChannelListSchema = z.array(ChannelSchema).min(1);

export type ChannelConfig = z.infer<typeof ChannelSchema>;

export interface Channel extends ChannelConfig {
  profile: DomainProfile;
}

let channels: Channel[] | null = null;

/**
 * Parse and validate a channel list. Fails fast on unknown domains or
 * duplicate ids so a bad channels.json never half-loads.
 */
export function parseChannels(raw: unknown): Channel[] {
  const parsed = ChannelListSchema.parse(raw);
  const seen = new Set<string>();
  return parsed.map(channel => {
    if (seen.has(channel.id)) {
      throw new Error(`Duplicate channel id '${channel.id}' in channels file`);
    }
    seen.add(channel.id);
    return { ...channel, profile: resolveDomain(channel.domain) };
  });
}

export function listChannels(): Channel[] {
  if (!channels) {
    const path = resolve(process.cwd(), config.channelsFile);
    channels = parseChannels(JSON.parse(readFileSync(path, 'utf-8')));
  }
  return channels;
}

export function getChannel(id: string): Channel | null {
  return listChannels().find(channel => channel.id === id) ?? null;
}
