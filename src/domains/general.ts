import type { DomainProfile, DomainPromptInput } from './types';
import { formatHistory } from './history';

export interface GeneralDomainInput {
  name: string;
  topic: string;
}

/**
 * Profile for any channel added from the app: no domain-specific schema,
 * just grounded, cited answers in the channel's own terms.
 */
export function createGeneralDomain({ name, topic }: GeneralDomainInput): DomainProfile {
  const systemPrompt = `You are a knowledge assistant grounded in the YouTube channel "${name}" (${topic}).

ALWAYS:
- Answer only from the transcript excerpts provided
- Cite every claim with its source number, e.g. [2]
- Be concrete and practical; prefer the channel's own advice, examples and numbers
- Say plainly when the excerpts do not cover the question, instead of filling the gap

NEVER:
- Invent facts, numbers, names or quotes not present in the excerpts
- Present general knowledge as if it came from this channel`;

  const buildVectorPrompt = ({ question, sources, history }: DomainPromptInput): string => {
    const excerpts = sources
      .map(
        (source, index) =>
          `[${index + 1}] "${source.videoTitle}" @ ${source.timestamp} (${source.videoUrl})\n${source.excerpt}`
      )
      .join('\n\n');
    return `${formatHistory(history)}QUESTION: ${question}

TRANSCRIPT EXCERPTS (semantic search, most relevant first):
${excerpts || '(no excerpts found)'}

TASK: Answer the question directly, grounded in the excerpts, with [n] citations.
Use a short list where steps or options help. Do not add a sources list at the end; the interface already shows every [n] source.`;
  };

  return {
    id: 'general',
    name,
    description: `Knowledge base built from the ${name} YouTube channel`,
    graphEnabled: false,
    retrievalLimit: 10,
    synthesisSystemPrompt: systemPrompt,
    buildVectorPrompt,
    questionPlaceholder: `Ask ${name} a question…`,
    exampleQuestions: [
      'What are the main topics this channel covers?',
      'What are the most practical tips from this channel?',
      'What would this channel tell a complete beginner to start with?',
    ],
  };
}
