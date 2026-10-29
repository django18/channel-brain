export const config = {
  // Server
  port: parseInt(process.env.PORT || '3100'),

  // ChromaDB (host port 8100 → container 8000, see docker-compose.yml)
  chromaUrl: process.env.CHROMA_URL || 'http://localhost:8100',

  // Chunking (transcript chunks)
  chunkSize: parseInt(process.env.CHUNK_SIZE || '1000'),
  chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '200'),

  // Embedding
  embeddingModel: process.env.EMBEDDING_MODEL || 'Xenova/all-MiniLM-L6-v2',
  useJinaEmbeddings: process.env.USE_JINA_EMBEDDINGS === 'true',
  jinaEmbeddingApiKey: process.env.JINA_EMBEDDING_API_KEY || '',

  // YouTube collection in Chroma
  youtubeCollectionName: process.env.YOUTUBE_COLLECTION_NAME || 'youtube_transcripts',

  // Scraped-video tracker (one per corpus, so instances don't skip each other's videos)
  youtubeTrackerFile: process.env.YOUTUBE_TRACKER_FILE || './data/youtube/scraped-videos.json',

  // Domain profile: 'startup' (Starter Story, graph + vector) or
  // 'home-inspection' (InterNACHI, vector-only). See src/domains/.
  domain: process.env.KNOWLEDGE_DOMAIN || 'startup',

  // Channels the app serves (each: own collection, tracker, domain profile)
  channelsFile: process.env.CHANNELS_FILE || './channels.json',
  // Channels added from the app at runtime (status + progress live here too)
  userChannelsFile: process.env.USER_CHANNELS_FILE || './data/channels.user.json',
  // yt-dlp lists a channel's videos when one is added from the app
  ytDlpPath: process.env.YT_DLP_PATH || 'yt-dlp',
  // Upper bound on videos indexed per added channel
  maxVideosPerChannel: parseInt(process.env.MAX_VIDEOS_PER_CHANNEL || '5000'),

  // Redis key prefix for the job queue, so instances on one Redis don't share jobs
  queuePrefix: process.env.QUEUE_PREFIX || 'knowledge_engine',

  // Neo4j
  neo4jUri: process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4jUser: process.env.NEO4J_USER || 'neo4j',
  neo4jPassword: process.env.NEO4J_PASSWORD || 'password',

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // Security
  // If API_KEY is set, all /api/* routes require the `x-api-key` header.
  // Leave unset for local development (no auth).
  apiKey: process.env.API_KEY || '',
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '60'),

  // Pattern layer cache (seconds). Default 6h.
  patternCacheTtlSeconds: parseInt(process.env.PATTERN_CACHE_TTL_SECONDS || '21600'),

  // Eval
  evalOutputDir: process.env.EVAL_OUTPUT_DIR || './eval/results',
  evalGoldenPath: process.env.EVAL_GOLDEN_PATH || './eval/golden.jsonl',
};
