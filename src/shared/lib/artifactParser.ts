import type { Artifact, ArtifactType } from '../types/artifact';

const VALID_TYPES: Set<string> = new Set([
  'quote-card',
  'kline-chart',
  'news-list',
  'finance-breakfast',
  'ai-hot-news',
  'bar-chart',
  'line-chart',
  'data-table',
  'stock-snapshot',
  'sector-heatmap',
  'research-consensus',
  'financial-health',
  'news-feed',
]);

const ARTIFACT_BLOCK_RE = /```artifact:([\w-]+)\s*\n([\s\S]*?)```/g;

let idCounter = 0;

export interface ExtractResult {
  cleanText: string;
  artifacts: Artifact[];
}

/**
 * Extract artifact blocks from agent text output.
 *
 * Pattern: ```artifact:TYPE\n{...json...}\n```
 *
 * Returns cleaned text (markers removed) and parsed artifacts.
 * Incomplete blocks (opened but not closed) are stripped from the
 * visible text to prevent raw markup from flashing in the UI during
 * streaming — the block will be parsed once it completes.
 */
export function extractArtifacts(text: string): ExtractResult {
  const artifacts: Artifact[] = [];

  if (hasIncompleteBlock(text)) {
    // Strip the incomplete artifact block from visible text so users
    // don't see raw ```artifact:... markup while data is streaming in.
    const lastOpen = text.lastIndexOf('```artifact:');
    const cleanText = lastOpen > 0 ? text.slice(0, lastOpen).trim() : '';
    return { cleanText, artifacts };
  }

  const cleanText = text.replace(ARTIFACT_BLOCK_RE, (_match, type, body) => {
    const trimmedType = (type as string).trim();
    if (!VALID_TYPES.has(trimmedType)) return '';

    try {
      const data = JSON.parse(body as string);
      artifacts.push({
        id: `art_${Date.now()}_${++idCounter}`,
        type: trimmedType as ArtifactType,
        data,
      });
    } catch {
      // JSON parse failed — drop the block silently
    }
    return '';
  });

  return { cleanText: cleanText.trim(), artifacts };
}

/**
 * Check if text contains an opened but unclosed artifact block.
 * Used during streaming to defer extraction until the block completes.
 */
export function hasIncompleteBlock(text: string): boolean {
  const lastOpen = text.lastIndexOf('```artifact:');
  if (lastOpen === -1) return false;
  const afterOpen = text.slice(lastOpen);
  const closingFence = afterOpen.indexOf('```', '```artifact:'.length);
  return closingFence === -1;
}
