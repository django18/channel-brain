import { searchVectorDB, type SearchResult } from '../youtube-vectorstore';
import { getLLM, hasLLM, llmModels, stripReasoning, reasoningRequestOverrides } from '../llm';
import type { ContextPatterns } from '../patterns/pattern-layer';
import type { ChatTurn, DomainProfile } from '../../domains';
import { config } from '../../config';
import type { AdvisorAnswer, TraceStage } from './advisor';

const EXCERPT_CHARS = 700;
const FOLLOW_UP_MAX_WORDS = 8;

export interface VectorAskOptions {
  collectionName?: string;
  history?: ChatTurn[];
}

/**
 * Short follow-ups ("what about older homes?") retrieve poorly on their
 * own, so they borrow the previous user question as search context.
 */
export function buildRetrievalQuery(question: string, history: ChatTurn[] = []): string {
  const isShort = question.trim().split(/\s+/).length <= FOLLOW_UP_MAX_WORDS;
  const previous = [...history].reverse().find(turn => turn.role === 'user');
  return isShort && previous ? `${previous.content} ${question}` : question;
}

function emptyPatterns(): ContextPatterns {
  return {
    context: {},
    cacheKey: 'not-applicable',
    topStrategies: [],
    topTools: [],
    workflows: [],
    outcomes: { founderCount: 0, avgMrr: null, avgUsers: null },
    computedAt: new Date().toISOString(),
    fromCache: false,
    relaxedFilters: [],
  };
}

function skipped(stage: string, reason: string): TraceStage {
  return { stage, ms: 0, status: 'skipped', detail: { reason } };
}

/**
 * Vector-only advisor for domains without a knowledge graph: semantic
 * search over transcripts, then a synthesis that must cite numbered
 * excerpts. Same response shape as the graph advisor so the explorer
 * and API clients work unchanged.
 */
export async function askVectorOnly(
  question: string,
  domain: DomainProfile,
  options: VectorAskOptions = {}
): Promise<AdvisorAnswer> {
  const { collectionName = config.youtubeCollectionName, history = [] } = options;
  const retrievalQuery = buildRetrievalQuery(question, history);
  const askStart = performance.now();
  const notApplicable = `domain '${domain.id}' has no knowledge graph`;
  const stages: TraceStage[] = [
    skipped('context-extraction', notApplicable),
    skipped('pattern-layer', notApplicable),
    skipped('graph-examples', notApplicable),
  ];

  const searchStart = performance.now();
  let vectorResults: SearchResult[] = [];
  let searchFailed = false;
  try {
    vectorResults = await searchVectorDB(retrievalQuery, domain.retrievalLimit, collectionName);
  } catch (error) {
    console.warn('Vector search failed:', error);
    searchFailed = true;
  }
  const similarities = vectorResults.map(r => r.similarity);
  stages.push({
    stage: 'vector-search',
    ms: Math.round(performance.now() - searchStart),
    status: searchFailed ? 'failed' : 'ok',
    detail: {
      chunks: vectorResults.length,
      query: retrievalQuery,
      collection: collectionName,
      topSimilarity: similarities.length > 0 ? Math.max(...similarities) : null,
      embedder: 'MiniLM-L6-v2 (384-dim, cosine)',
    },
  });

  // overlapping chunks, and the same video re-uploaded under a new id, repeat
  // a title + timestamp; one citation slot each is enough
  const seen = new Set<string>();
  const distinct = vectorResults.filter(result => {
    const key = `${result.videoTitle.trim().toLowerCase()}@${result.timestamp}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const sources = distinct.map(result => ({
    videoTitle: result.videoTitle,
    videoUrl: result.videoUrl,
    timestamp: result.timestamp,
    excerpt: result.text.slice(0, EXCERPT_CHARS),
    similarity: result.similarity,
  }));

  const base = {
    question,
    context: {},
    patterns: emptyPatterns(),
    examples: [],
    sources,
  };
  const finish = (answer: string | null, synthesized: boolean): AdvisorAnswer => ({
    ...base,
    answer,
    synthesized,
    trace: { totalMs: Math.round(performance.now() - askStart), stages },
  });

  if (!hasLLM()) {
    stages.push(skipped('synthesis', 'No LLM API key set — raw retrieval returned'));
    return finish(null, false);
  }
  if (sources.length === 0) {
    stages.push(skipped('synthesis', 'No transcript excerpts retrieved'));
    return finish(null, false);
  }

  const userPrompt = domain.buildVectorPrompt({ question, sources, history });
  const synthesisStart = performance.now();
  try {
    const response = await getLLM().chat.completions.create({
      model: llmModels().synthesis,
      messages: [
        { role: 'system', content: domain.synthesisSystemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      ...reasoningRequestOverrides(llmModels().synthesis),
    });
    stages.push({
      stage: 'synthesis',
      ms: Math.round(performance.now() - synthesisStart),
      status: 'ok',
      detail: {
        model: llmModels().synthesis,
        promptChars: userPrompt.length,
        promptTokens: response.usage?.prompt_tokens ?? null,
        completionTokens: response.usage?.completion_tokens ?? null,
      },
    });
    return finish(stripReasoning(response.choices[0]?.message?.content ?? ''), true);
  } catch (error) {
    console.error('Vector advisor synthesis failed, returning raw retrieval:', error);
    stages.push({
      stage: 'synthesis',
      ms: Math.round(performance.now() - synthesisStart),
      status: 'failed',
      detail: { error: error instanceof Error ? error.message : String(error) },
    });
    return finish(null, false);
  }
}
