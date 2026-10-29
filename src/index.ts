import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import youtubeRouter from './routes/youtube';
import knowledgeRouter from './routes/knowledge';
import evalRouter from './routes/eval';
import explorerRouter from './routes/explorer';
import channelsRouter from './routes/channels';
import appRouter from './routes/app';
import kbRouter from './routes/kb';
import mcpRouter from './routes/mcp';
import { resumeUnfinishedIndexing } from './channels/indexer';
import { config } from './config';
import { startWorker } from './lib/queue/worker';
import { initGraph } from './lib/extraction/graph-store';
import { apiKeyAuth, rateLimit } from './middleware/security';
import { bodyLimit } from 'hono/body-limit';

const app = new Hono();

app.use('*', cors());
app.use('*', logger());
const MAX_BODY_BYTES = 256 * 1024;
const tooLarge = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => c.json({ success: false, error: 'Request body too large' }, 413),
});
app.use('/api/*', tooLarge);
app.use('/api/*', rateLimit());
app.use('/api/*', apiKeyAuth());
app.use('/mcp', rateLimit());
app.use('/mcp', apiKeyAuth());

app.get('/', (c) =>
  c.json({
    name: 'YouTube Knowledge Engine API',
    version: '2.0.0',
    status: 'healthy',
    endpoints: {
      youtube: {
        scrapeVideo: 'POST /api/youtube/scrape-video',
        scrapeChannel: 'POST /api/youtube/scrape-channel',
        search: 'POST /api/youtube/search',
        chat: 'POST /api/youtube/chat',
        stats: 'GET /api/youtube/stats',
      },
      knowledge: {
        ask: 'POST /api/knowledge/ask',
        patterns: 'GET /api/knowledge/patterns',
        generatePlaybook: 'POST /api/knowledge/generate-playbook',
        stats: 'GET /api/knowledge/stats',
      },
      eval: {
        run: 'POST /api/eval/run',
        latest: 'GET /api/eval/latest',
        history: 'GET /api/eval/history',
      },
      channels: {
        list: 'GET /api/channels',
        add: 'POST /api/channels { channelUrl, maxVideos?, topic? }',
        resume: 'POST /api/channels/:id/resume',
        remove: 'DELETE /api/channels/:id',
        suggestions: 'GET /api/channels/:id/suggestions',
        recent: 'GET|DELETE /api/channels/:id/recent (x-client-id)',
        ask: 'POST /api/channels/:id/ask',
      },
      kb: {
        channels: 'GET /api/kb/channels',
        search: 'POST /api/kb/search { query, channels, limit?, minSimilarity? }',
        ask: 'POST /api/kb/ask { question, channels, history? }',
        transcript: 'GET /api/kb/channels/:channelId/videos/:videoId',
        openapi: 'GET /api/kb/openapi.json',
        mcp: 'POST /mcp (Streamable HTTP, stateless)',
      },
      ui: {
        app: 'GET /app',
        explorer: 'GET /explorer',
      },
    },
  })
);

app.get('/health', (c) =>
  c.json({ status: 'ok', timestamp: new Date().toISOString() })
);

app.route('/api', youtubeRouter);
app.route('/api/knowledge', knowledgeRouter);
app.route('/api/channels', channelsRouter);
app.route('/api/kb', kbRouter);
app.route('/mcp', mcpRouter);
app.route('/api/eval', evalRouter);
app.route('/explorer', explorerRouter);
app.route('/app', appRouter);

console.log(`🚀 Server starting on port ${config.port}`);
console.log(`📊 ChromaDB URL: ${config.chromaUrl}`);
console.log(`🤖 Embedding: ${config.embeddingModel}`);
console.log(`🕸️  Neo4j URI: ${config.neo4jUri}`);

try {
  resumeUnfinishedIndexing();
} catch (err) {
  console.error('Could not resume channel indexing:', err);
}

initGraph()
  .catch((err) => console.error('Neo4j init failed (continuing):', err))
  .finally(() => {
    startWorker().catch((err) => console.error('Worker failed to start:', err));
  });

export default {
  port: config.port,
  fetch: app.fetch,
};
