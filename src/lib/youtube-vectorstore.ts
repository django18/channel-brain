import { ChromaClient, Collection, IncludeEnum } from 'chromadb';
import { pipeline } from '@xenova/transformers';
import { config } from '../config';
import type { ProcessedTranscript, TranscriptChunk } from './youtube';

let embedderPromise: Promise<any> | null = null;
let chromaClient: ChromaClient | null = null;
// one cached handle per collection: a single server can serve several channels
const collections = new Map<string, Collection>();

/**
 * Initialize the embedding model (cached)
 */
async function getEmbedder() {
  // cache the promise, not the result: parallel first calls must share one load
  if (!embedderPromise) {
    console.log('Loading embedding model...');
    embedderPromise = pipeline('feature-extraction', config.embeddingModel)
      .then(model => {
        console.log('Embedding model loaded');
        return model;
      })
      .catch(error => {
        embedderPromise = null;
        throw error;
      });
  }
  return embedderPromise;
}

/**
 * Generate embeddings for text using transformers.js
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const model = await getEmbedder();
  const output = await model(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * Generate embeddings for multiple texts in batch
 */
async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const embeddings = await Promise.all(
    texts.map(text => generateEmbedding(text))
  );
  return embeddings;
}

/**
 * Get or create the ChromaDB collection for YouTube transcripts
 */
async function getCollection(
  collectionName: string = config.youtubeCollectionName
): Promise<Collection> {
  const cached = collections.get(collectionName);
  if (cached) return cached;

  if (!chromaClient) {
    chromaClient = new ChromaClient({
      path: config.chromaUrl,
    });
  }

  try {
    const collection = await chromaClient.getOrCreateCollection({
      name: collectionName,
      metadata: {
        description: 'YouTube video transcripts with semantic embeddings',
        'hnsw:space': 'cosine',
        provider: config.embeddingModel,
        dimension: 384,
      },
    });

    const meta = (collection as any).metadata ?? {};
    if (meta.provider && meta.provider !== config.embeddingModel) {
      throw new Error(
        `YouTube collection was created with provider '${meta.provider}' but current is '${config.embeddingModel}'. ` +
        `Recreate the collection to switch providers.`
      );
    }

    console.log(`✓ Connected to collection: ${collectionName} (provider=${config.embeddingModel})`);
    collections.set(collectionName, collection);
    return collection;
  } catch (error) {
    console.error('Failed to connect to ChromaDB:', error);
    throw new Error(`ChromaDB connection failed: ${error}`);
  }
}

/**
 * Store processed transcripts in the vector database
 */
export async function storeInVectorDB(
  transcripts: ProcessedTranscript[],
  collectionName: string = config.youtubeCollectionName
): Promise<void> {
  const coll = await getCollection(collectionName);

  // Flatten all chunks from all transcripts
  const allChunks = transcripts.flatMap(t => t.chunks);

  if (allChunks.length === 0) {
    console.log('No chunks to store');
    return;
  }

  console.log(`Generating embeddings for ${allChunks.length} chunks...`);

  // Generate embeddings in batches to avoid memory issues
  const batchSize = 10;
  const ids: string[] = [];
  const embeddings: number[][] = [];
  const documents: string[] = [];
  const metadatas: any[] = [];

  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    const batchTexts = batch.map(chunk => chunk.text);
    const batchEmbeddings = await generateEmbeddings(batchTexts);

    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];

      ids.push(chunk.id);
      embeddings.push(batchEmbeddings[j]);
      documents.push(chunk.text);
      metadatas.push({
        videoId: chunk.videoId,
        videoTitle: chunk.videoTitle,
        videoUrl: chunk.videoUrl,
        startTime: chunk.startTime,
        endTime: chunk.endTime,
        timestamp: chunk.timestamp,
        chunkIndex: chunk.chunkIndex,
        ...chunk.metadata,
      });
    }

    console.log(`Processed ${Math.min(i + batchSize, allChunks.length)}/${allChunks.length} chunks`);
  }

  console.log('Storing in ChromaDB...');

  try {
    // upsert (not add): chunk IDs are deterministic (videoId_chunk_N),
    // so re-ingesting a video overwrites instead of throwing on
    // duplicate IDs.
    await coll.upsert({
      ids,
      embeddings,
      documents,
      metadatas,
    });

    console.log(`✓ Stored ${allChunks.length} chunks in vector database`);
  } catch (error) {
    console.error('Failed to store in ChromaDB:', error);
    throw error;
  }
}

/**
 * Search interface result
 */
export interface SearchResult {
  id: string;
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  text: string;
  startTime: number;
  endTime: number;
  timestamp: string;
  similarity: number;
  metadata: Record<string, any>;
}

/**
 * Semantic search across YouTube transcripts
 */
export async function searchVectorDB(
  query: string,
  limit: number = 5,
  collectionName: string = config.youtubeCollectionName
): Promise<SearchResult[]> {
  const coll = await getCollection(collectionName);

  console.log(`Searching for: "${query}"`);

  // Generate query embedding
  const queryEmbedding = await generateEmbedding(query);

  // Query ChromaDB
  const results = await coll.query({
    queryEmbeddings: [queryEmbedding],
    nResults: limit,
    include: [IncludeEnum.Documents, IncludeEnum.Metadatas, IncludeEnum.Distances],
  });

  const searchResults: SearchResult[] = [];

  if (results.ids && results.ids[0]) {
    for (let i = 0; i < results.ids[0].length; i++) {
      const metadata = results.metadatas?.[0]?.[i] as any;
      const document = results.documents?.[0]?.[i];
      const distance = results.distances?.[0]?.[i];

      if (metadata && document) {
        searchResults.push({
          id: results.ids[0][i],
          videoId: metadata.videoId,
          videoTitle: metadata.videoTitle,
          videoUrl: metadata.videoUrl,
          text: document,
          startTime: metadata.startTime,
          endTime: metadata.endTime,
          timestamp: metadata.timestamp,
          similarity: distance !== undefined ? 1 - distance : 0,
          metadata: {
            channelTitle: metadata.channelTitle,
            thumbnailUrl: metadata.thumbnailUrl,
            chunkIndex: metadata.chunkIndex,
          },
        });
      }
    }
  }

  console.log(`Found ${searchResults.length} results`);

  return searchResults;
}

/**
 * Get collection statistics
 */
export async function getCollectionStats(
  collectionName: string = config.youtubeCollectionName
) {
  const coll = await getCollection(collectionName);

  const count = await coll.count();

  return {
    totalChunks: count,
    collectionName,
  };
}

/**
 * Delete all YouTube transcripts from the collection
 */
export async function clearCollection(): Promise<void> {
  const coll = await getCollection();

  // Get all IDs
  const results = await coll.get();

  if (results.ids && results.ids.length > 0) {
    await coll.delete({
      ids: results.ids,
    });

    console.log(`Deleted ${results.ids.length} chunks from collection`);
  }
}

/**
 * Drop a whole collection (used when a user removes a channel they added).
 * Missing collections are not an error.
 */
export async function deleteCollection(collectionName: string): Promise<void> {
  if (!chromaClient) {
    chromaClient = new ChromaClient({ path: config.chromaUrl });
  }
  collections.delete(collectionName);
  try {
    await chromaClient.deleteCollection({ name: collectionName });
  } catch (error) {
    if (!String(error).toLowerCase().includes('does not exist')) throw error;
  }
}
