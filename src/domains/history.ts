import type { ChatTurn } from './types';

const MAX_TURNS = 6;
const MAX_TURN_CHARS = 600;

/**
 * Render recent conversation turns for a prompt. Assistant answers are
 * truncated: they give the model the thread, the excerpts give it facts.
 */
export function formatHistory(history: ChatTurn[] | undefined): string {
  if (!history || history.length === 0) return '';
  const turns = history
    .slice(-MAX_TURNS)
    .map(turn => {
      const text = turn.content.length > MAX_TURN_CHARS
        ? `${turn.content.slice(0, MAX_TURN_CHARS)}…`
        : turn.content;
      return `${turn.role === 'user' ? 'USER' : 'ASSISTANT'}: ${text}`;
    })
    .join('\n');
  return `CONVERSATION SO FAR (for resolving follow-ups only; facts must come from the excerpts):\n${turns}\n\n`;
}
