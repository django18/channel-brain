import type { DomainProfile, DomainPromptInput } from './types';
import { formatHistory } from './history';

const SYSTEM_PROMPT = `You are a home inspection knowledge assistant grounded in InterNACHI's YouTube library (training videos, webinars, NHIE exam prep, and inspection walkthroughs).

ALWAYS:
- Answer only from the transcript excerpts provided
- Cite every claim with its source number, e.g. [2], and include the video timestamp when useful
- Be concrete: what to look for, why it matters (safety, water, structure, fire), and what to recommend in the report
- Say plainly when the excerpts do not cover the question, instead of filling the gap

NEVER:
- Invent code sections, measurements, clearances, or standards not present in the excerpts
- Present general knowledge as if it came from InterNACHI
- Give a definitive diagnosis; inspectors observe and refer to qualified contractors`;

function buildVectorPrompt({ question, sources, history }: DomainPromptInput): string {
  const excerpts = sources
    .map(
      (source, index) =>
        `[${index + 1}] "${source.videoTitle}" @ ${source.timestamp} (${source.videoUrl})\n${source.excerpt}`
    )
    .join('\n\n');

  return `${formatHistory(history)}QUESTION: ${question}

TRANSCRIPT EXCERPTS (semantic search, most relevant first):
${excerpts || '(no excerpts found)'}

TASK: Answer the question with:
1. A direct answer grounded in the excerpts, with [n] citations
2. What an inspector should look for or check, as a short list
3. How to report it (defect wording / recommendation), only if the excerpts support it
Do not add a sources list at the end; the interface already shows every [n] source.`;
}

const TECHNICAL_TITLE = /inspect|defect|roof|panel|foundation|water|hvac|electrical|plumbing|attic|crack|mold|moisture|chimney|deck|window|furnace|wiring|drain|siding|stair|radon|insulation|ventilation|fireplace|gutter|framing/i;
const BUSINESS_TITLE = /webinar|business|marketing|website|price|pricing|custom-branded|agent|seo|social media|success tip|member|fee|profit|tip #|revenue|master class|grow your|logo|branding|pourquoi|inspecteur|[àâçéèêëîïôûùüœ]/i;

export const homeInspectionDomain: DomainProfile = {
  id: 'home-inspection',
  name: 'InterNACHI Home Inspection',
  description: 'Home inspection knowledge base built from the InterNACHI YouTube channel',
  graphEnabled: false,
  retrievalLimit: 10,
  synthesisSystemPrompt: SYSTEM_PROMPT,
  buildVectorPrompt,
  questionPlaceholder:
    'Ask anything about inspecting a home… e.g. How do I tell if a foundation crack is structural?',
  exampleQuestions: [
    'How do I tell if a foundation crack is structural or just shrinkage?',
    'What are the common double-tapping issues in an electrical panel?',
    'What should I check on a water heater TPR valve and discharge pipe?',
    'How do I inspect a roof for hail damage?',
  ],
  suggestionTitleFilter: title => TECHNICAL_TITLE.test(title) && !BUSINESS_TITLE.test(title),
};
