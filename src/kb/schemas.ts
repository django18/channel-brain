import { z } from 'zod';
import { SEARCH_MAX_LIMIT } from './search';

export const ChannelIds = z
  .array(z.string().regex(/^[a-z0-9-]{2,40}$/))
  .min(1, 'Pass at least one channel id (see GET /api/kb/channels)')
  .max(20)
  .describe('Channel ids to search (see GET /api/kb/channels). Required: at least one.');

export const QueryText = z.string().trim().min(2).max(500);
export const QuestionText = z.string().trim().min(3).max(1000);

export const SearchRequestSchema = z.object({
  query: QueryText.describe('What to look for, in natural language'),
  channels: ChannelIds,
  limit: z.number().int().min(1).max(SEARCH_MAX_LIMIT).optional().describe(`Passages to return (default 8, max ${SEARCH_MAX_LIMIT})`),
  minSimilarity: z.number().min(0).max(1).optional().describe('Drop passages below this cosine similarity (0–1)'),
});

export const AskRequestSchema = z.object({
  question: QuestionText.describe('The question to answer from the transcripts'),
  channels: ChannelIds,
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(8000) }))
    .max(12)
    .optional()
    .describe('Earlier turns, oldest first, so follow-up questions resolve'),
});

const PassageSchema = z.object({
  id: z.string(),
  channel: z.object({ id: z.string(), name: z.string() }),
  video: z.object({ id: z.string(), title: z.string(), url: z.string() }),
  timestamp: z.string(),
  startSeconds: z.number(),
  url: z.string().describe('Opens the video at this passage'),
  text: z.string(),
  similarity: z.number(),
});

export const SearchResponseSchema = z.object({
  query: z.string(),
  channelsSearched: z.array(z.string()),
  passages: z.array(PassageSchema),
});

export const AskResponseSchema = z.object({
  question: z.string(),
  answer: z.string().nullable().describe('Markdown with [n] citations indexing into passages (1-based)'),
  synthesized: z.boolean(),
  channelsSearched: z.array(z.string()),
  passages: z.array(PassageSchema),
  model: z.string().nullable(),
  ms: z.number(),
});

export const ChannelSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  handle: z.string(),
  topic: z.string(),
  url: z.string(),
  status: z.string(),
  videos: z.number(),
});

export const TranscriptResponseSchema = z.object({
  channel: z.object({ id: z.string(), name: z.string() }),
  video: z.object({ id: z.string(), title: z.string(), url: z.string() }),
  passages: z.array(PassageSchema),
});
