import { z } from 'zod';
import {
  AskRequestSchema,
  AskResponseSchema,
  ChannelSummarySchema,
  SearchRequestSchema,
  SearchResponseSchema,
  TranscriptResponseSchema,
} from './schemas';

const schema = (s: z.ZodType) => z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' });

function envelope(data: z.ZodType) {
  return {
    description: 'OK',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: { success: { type: 'boolean' }, data: schema(data) },
          required: ['success', 'data'],
        },
      },
    },
  };
}

const errorResponse = { description: 'Error', content: { 'application/json': { schema: { type: 'object', properties: { success: { const: false }, error: { type: 'string' } } } } } };

/** OpenAPI 3.1 for the agent API, generated from the same zod schemas that validate requests. */
export function buildOpenApi(serverUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Channel Knowledge API',
      version: '1.0.0',
      description:
        'Search and question-answering over transcripts of indexed YouTube channels. Every passage carries a deep link to the exact moment in the video.',
    },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
        bearer: { type: 'http', scheme: 'bearer' },
      },
    },
    security: [{ apiKey: [] }, { bearer: [] }],
    paths: {
      '/api/kb/channels': {
        get: {
          operationId: 'listChannels',
          summary: 'List the channels in the knowledge base',
          responses: { 200: envelope(z.array(ChannelSummarySchema)) },
        },
      },
      '/api/kb/search': {
        post: {
          operationId: 'searchKnowledge',
          summary: 'Semantic search for transcript passages across channels (no LLM)',
          requestBody: { required: true, content: { 'application/json': { schema: schema(SearchRequestSchema) } } },
          responses: { 200: envelope(SearchResponseSchema), 400: errorResponse, 404: errorResponse },
        },
      },
      '/api/kb/ask': {
        post: {
          operationId: 'askKnowledge',
          summary: 'Answer a question from the transcripts, with [n] citations into the returned passages',
          requestBody: { required: true, content: { 'application/json': { schema: schema(AskRequestSchema) } } },
          responses: { 200: envelope(AskResponseSchema), 400: errorResponse, 404: errorResponse },
        },
      },
      '/api/kb/channels/{channelId}/videos/{videoId}': {
        get: {
          operationId: 'getTranscript',
          summary: 'Full indexed transcript of one video, as ordered passages',
          parameters: [
            { name: 'channelId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'videoId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: envelope(TranscriptResponseSchema), 404: errorResponse },
        },
      },
    },
  };
}
