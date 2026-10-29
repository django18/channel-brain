/**
 * A domain profile tells the engine what kind of corpus it is serving.
 * The vector pipeline is channel-agnostic; the graph schema, context
 * extraction and synthesis voice are not. A profile switches those.
 */
export interface DomainSource {
  videoTitle: string;
  videoUrl: string;
  timestamp: string;
  excerpt: string;
  similarity: number;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface DomainPromptInput {
  question: string;
  sources: DomainSource[];
  /** Earlier turns of the conversation, oldest first. */
  history?: ChatTurn[];
}

export interface DomainProfile {
  id: string;
  name: string;
  /** Corpus description surfaced in the API root and explorer. */
  description: string;
  /**
   * Whether the Founder → Startup → Strategy graph applies. When false,
   * /ask runs vector-only retrieval and skips context extraction,
   * pattern layer and multi-hop graph stages.
   */
  graphEnabled: boolean;
  /** How many transcript chunks to retrieve for synthesis. */
  retrievalLimit: number;
  synthesisSystemPrompt: string;
  /** Builds the user prompt for vector-only domains. */
  buildVectorPrompt: (input: DomainPromptInput) => string;
  /** Explorer UI question box placeholder. */
  questionPlaceholder: string;
  /** Example questions for the explorer UI. */
  exampleQuestions: string[];
  /** Which video titles make good suggested questions; all titles when absent. */
  suggestionTitleFilter?: (title: string) => boolean;
}
