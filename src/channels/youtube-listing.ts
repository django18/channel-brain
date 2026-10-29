import { z } from 'zod';
import { config } from '../config';

const LIST_TIMEOUT_MS = 5 * 60 * 1000;

const HANDLE = /^@[A-Za-z0-9._-]{3,30}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

export interface ChannelRef {
  /** Canonical channel URL, e.g. https://www.youtube.com/@internachi */
  url: string;
  /** '@handle' or the UC… channel id */
  key: string;
}

/**
 * Accept '@handle', a youtube.com/@handle URL (any tab), or a
 * youtube.com/channel/UC… URL. Everything else is rejected, so nothing
 * arbitrary ever reaches the yt-dlp command line.
 */
export function parseChannelInput(input: string): ChannelRef | null {
  const raw = input.trim();
  if (HANDLE.test(raw)) return { url: `https://www.youtube.com/${raw}`, key: raw.toLowerCase() };

  let parsed: URL;
  try {
    parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!/^(www\.|m\.)?youtube\.com$/.test(parsed.hostname)) return null;

  const [first, second] = parsed.pathname.split('/').filter(Boolean);
  if (first && HANDLE.test(decodeURIComponent(first))) {
    const handle = decodeURIComponent(first);
    return { url: `https://www.youtube.com/${handle}`, key: handle.toLowerCase() };
  }
  if (first === 'channel' && second && CHANNEL_ID.test(second)) {
    return { url: `https://www.youtube.com/channel/${second}`, key: second };
  }
  return null;
}

const ListingSchema = z.object({
  channel: z.string().optional(),
  channel_id: z.string().optional(),
  uploader_id: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  entries: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().nullable().optional(),
      })
    )
    .default([]),
});

export interface ChannelListing {
  name: string;
  handle: string;
  channelId: string | null;
  description: string;
  videos: Array<{ videoId: string; title: string }>;
}

/** Turn yt-dlp's stderr into a message a person can act on; raw output stays in the server log. */
export function friendlyListingError(stderr: string): string {
  if (/not found|does not exist|404|unavailable/i.test(stderr)) {
    return "We couldn't find that channel. Check the link or @handle and try again.";
  }
  if (/private|members-only|sign in/i.test(stderr)) {
    return "That channel's videos aren't public, so they can't be indexed.";
  }
  if (/429|too many requests|rate/i.test(stderr)) {
    return 'YouTube is limiting requests right now. Try again in a few minutes.';
  }
  return "We couldn't read that channel right now. Check the link and try again.";
}

export function ytDlpAvailable(): boolean {
  return Bun.which(config.ytDlpPath) !== null;
}

/** List a channel's uploads (newest first) with yt-dlp, without downloading anything. */
export async function listChannel(ref: ChannelRef, maxVideos: number): Promise<ChannelListing> {
  if (!ytDlpAvailable()) {
    throw new Error(`yt-dlp not found (looked for '${config.ytDlpPath}'). Install it or set YT_DLP_PATH.`);
  }

  // argument array, no shell: the URL is already validated by parseChannelInput
  const proc = Bun.spawn(
    [config.ytDlpPath, '--flat-playlist', '-J', '--playlist-end', String(maxVideos), `${ref.url}/videos`],
    { stdout: 'pipe', stderr: 'pipe' }
  );
  const timer = setTimeout(() => proc.kill(), LIST_TIMEOUT_MS);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      console.warn(`yt-dlp failed for ${ref.url} (exit ${exitCode}): ${stderr.slice(-500)}`);
      throw new Error(friendlyListingError(stderr));
    }
    const data = ListingSchema.parse(JSON.parse(stdout));
    return {
      name: data.channel ?? ref.key,
      handle: data.uploader_id ?? ref.key,
      channelId: data.channel_id ?? null,
      description: (data.description ?? '').trim(),
      videos: data.entries
        .filter(entry => /^[A-Za-z0-9_-]{11}$/.test(entry.id))
        .map(entry => ({ videoId: entry.id, title: entry.title ?? entry.id })),
    };
  } finally {
    clearTimeout(timer);
  }
}
