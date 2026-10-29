import type { Passage } from '../kb/types';

/** Passages as compact, citable text: what an LLM agent reads best. */
export function formatPassages(passages: Passage[]): string {
  if (passages.length === 0) return 'No matching passages.';
  return passages
    .map(
      (p, i) =>
        `[${i + 1}] ${p.channel.name} — "${p.video.title}" @ ${p.timestamp} (similarity ${p.similarity})\n` +
        `${p.url}\n${p.text.trim()}`
    )
    .join('\n\n');
}
