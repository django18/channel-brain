/** A transcript passage as handed to agents: everything needed to quote and cite it. */
export interface Passage {
  id: string;
  channel: { id: string; name: string };
  video: { id: string; title: string; url: string };
  /** "12:34" */
  timestamp: string;
  startSeconds: number;
  /** Video URL that opens at this passage */
  url: string;
  text: string;
  /** Cosine similarity to the query, 0–1 (1 for direct fetches) */
  similarity: number;
}

export class KnowledgeError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 422 = 400) {
    super(message);
  }
}
