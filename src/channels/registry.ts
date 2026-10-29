import { z } from 'zod';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config';
import { resolveDomain, type DomainProfile } from '../domains';
import { createGeneralDomain } from '../domains/general';
import { listUserChannels, type ChannelProgress, type ChannelStatus } from './user-channels';

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
  /** Added from the app (removable), as opposed to channels.json */
  userAdded: boolean;
  status: ChannelStatus;
  progress: ChannelProgress | null;
  error: string | null;
}

let staticChannels: Channel[] | null = null;

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
    return {
      ...channel,
      profile: resolveDomain(channel.domain),
      userAdded: false,
      status: 'ready' as const,
      progress: null,
      error: null,
    };
  });
}

/** Static channels from channels.json, then channels added in the app. */
export function listChannels(): Channel[] {
  if (!staticChannels) {
    const path = resolve(process.cwd(), config.channelsFile);
    staticChannels = parseChannels(JSON.parse(readFileSync(path, 'utf-8')));
  }
  const added = listUserChannels().map(
    (channel): Channel => ({
      id: channel.id,
      name: channel.name,
      handle: channel.handle,
      channelUrl: channel.channelUrl,
      topic: channel.topic,
      domain: channel.domain,
      collection: channel.collection,
      trackerFile: channel.trackerFile,
      profile: createGeneralDomain({ name: channel.name, topic: channel.topic }),
      userAdded: true,
      status: channel.status,
      progress: channel.progress,
      error: channel.error,
    })
  );
  return [...staticChannels, ...added];
}

export function getChannel(id: string): Channel | null {
  return listChannels().find(channel => channel.id === id) ?? null;
}
