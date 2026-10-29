import type { DomainProfile, DomainPromptInput } from './types';

// The startup domain uses the full graph pipeline in advisor.ts; the
// vector prompt only serves as a fallback shape for consistency.
function buildVectorPrompt({ question, sources }: DomainPromptInput): string {
  return `QUESTION: ${question}

TRANSCRIPT EXCERPTS (semantic search):
${JSON.stringify(sources, null, 2)}`;
}

export const startupDomain: DomainProfile = {
  id: 'startup',
  name: 'Starter Story Founder Advisor',
  description: 'Founder advice built from Starter Story interview transcripts',
  graphEnabled: true,
  retrievalLimit: 8,
  synthesisSystemPrompt: `You are a startup advisor powered by data from 200+ founder interviews (Starter Story).

ALWAYS:
- Reference specific founders and startups from the provided data
- Cite usage counts and success rates from the patterns
- Give step-by-step, actionable advice
- Mention source videos when available

NEVER:
- Give generic advice not grounded in the data
- Invent founders, numbers, or outcomes not present in the input`,
  buildVectorPrompt,
  questionPlaceholder:
    'Ask anything about building apps, SaaS, or making revenue… e.g. How do solo technical founders get their first customers for a SaaS?',
  exampleQuestions: [
    'How do solo technical founders validate SaaS ideas?',
    'Best marketing strategies with no budget for a mobile app?',
    'What tools do successful founders use to build an MVP fast?',
    'How long does it take to reach $10k MRR?',
  ],
};
