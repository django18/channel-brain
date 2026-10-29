import { getLLM, hasLLM, llmModels, reasoningRequestOverrides, stripReasoning } from '../lib/llm';
import { formatHistory, type ChatTurn } from '../domains';
import { buildRetrievalQuery } from '../lib/retrieval/vector-advisor';
import { resolveChannels } from './channels';
import { searchKnowledge } from './search';
import type { Passage } from './types';

const ASK_PASSAGES = 10;
const EXCERPT_CHARS = 700;
// follow-ups prepend the previous question; keep the embedded query within the search cap
const MAX_RETRIEVAL_QUERY_CHARS = 500;

export interface AskRequest {
  question: string;
  channels: string[];
  history?: ChatTurn[];
}

export interface AskResponse {
  question: string;
  answer: string | null;
  /** false when no LLM is configured or synthesis failed: passages are still returned */
  synthesized: boolean;
  channelsSearched: string[];
  passages: Passage[];
  model: string | null;
  ms: number;
}

function systemPrompt(channelNames: string[]): string {
  return `You are a knowledge assistant grounded in transcripts from these YouTube channels: ${channelNames.join(', ')}.

ALWAYS:
- Answer only from the numbered passages provided
- Cite every claim with its passage number, e.g. [2]
- Name the channel when passages from different channels disagree or add different angles
- Say plainly when the passages do not cover the question

NEVER:
- Invent facts, numbers, names or quotes not present in the passages
- Present general knowledge as if it came from these channels`;
}

function userPrompt(question: string, passages: Passage[], history?: ChatTurn[]): string {
  const numbered = passages
    .map(
      (p, i) =>
        `[${i + 1}] ${p.channel.name} — "${p.video.title}" @ ${p.timestamp}\n${p.text.slice(0, EXCERPT_CHARS)}`
    )
    .join('\n\n');
  return `${formatHistory(history)}QUESTION: ${question}

PASSAGES (semantic search across channels, most relevant first):
${numbered || '(no passages found)'}

TASK: Answer directly with [n] citations. Use a short list where it helps.`;
}

/** Cross-channel answer with citations that index into `passages`. */
export async function askKnowledge(request: AskRequest): Promise<AskResponse> {
  const started = performance.now();
  const channels = resolveChannels(request.channels);
  const query = buildRetrievalQuery(request.question, request.history ?? []).slice(-MAX_RETRIEVAL_QUERY_CHARS);
  const { passages, channelsSearched } = await searchKnowledge({
    query,
    channels: channels.map(channel => channel.id),
    limit: ASK_PASSAGES,
  });

  const base = { question: request.question, channelsSearched, passages };
  const finish = (answer: string | null, model: string | null): AskResponse => ({
    ...base,
    answer,
    synthesized: answer !== null,
    model,
    ms: Math.round(performance.now() - started),
  });

  if (!hasLLM() || passages.length === 0) return finish(null, null);

  const model = llmModels().synthesis;
  try {
    const response = await getLLM().chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt(channels.map(channel => channel.name)) },
        { role: 'user', content: userPrompt(request.question, passages, request.history) },
      ],
      temperature: 0.2,
      ...reasoningRequestOverrides(model),
    });
    return finish(stripReasoning(response.choices[0]?.message?.content ?? ''), model);
  } catch (error) {
    console.error('Cross-channel synthesis failed, returning passages only:', error);
    return finish(null, null);
  }
}
