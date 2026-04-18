/**
 * Markdown Chunker
 *
 * Splits memory Markdown files into semantically meaningful chunks
 * suitable for embedding. Preserves heading hierarchy as context.
 */

import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryChunk {
  id: string;        // deterministic: source + heading path
  source: string;    // origin filename, e.g. "MEMORY.md"
  text: string;      // chunk content including heading breadcrumb
  hash: string;      // SHA-256 of text for change detection
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CHUNK_CHARS = 800;
const MIN_CHUNK_CHARS = 60;
const HEADING_RE = /^(#{1,6})\s+(.+)$/;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function makeId(source: string, headings: string[], index: number): string {
  const path = [source, ...headings, String(index)].join('/');
  return sha256(path);
}

/**
 * Split a Markdown string into chunks, each annotated with its heading context.
 *
 * Strategy:
 * 1. Split by heading boundaries (##, ###, etc.)
 * 2. If a section is too long, split by paragraph boundaries
 * 3. Tiny fragments are merged upward
 */
export function chunkMarkdown(source: string, content: string): MemoryChunk[] {
  if (!content.trim()) return [];

  const lines = content.split('\n');
  const sections = splitByHeadings(lines);
  const chunks: MemoryChunk[] = [];
  let idx = 0;

  for (const section of sections) {
    const breadcrumb = section.headings.length > 0
      ? section.headings.join(' > ') + '\n\n'
      : '';

    const body = section.lines.join('\n').trim();
    if (!body) continue;

    const fullText = breadcrumb + body;

    if (fullText.length <= MAX_CHUNK_CHARS) {
      if (fullText.length >= MIN_CHUNK_CHARS) {
        chunks.push({
          id: makeId(source, section.headings, idx),
          source,
          text: fullText,
          hash: sha256(fullText),
        });
        idx++;
      }
    } else {
      const paragraphs = splitParagraphs(body);
      let buffer = breadcrumb;

      for (const para of paragraphs) {
        if (buffer.length + para.length > MAX_CHUNK_CHARS && buffer.length > breadcrumb.length) {
          if (buffer.trim().length >= MIN_CHUNK_CHARS) {
            chunks.push({
              id: makeId(source, section.headings, idx),
              source,
              text: buffer.trim(),
              hash: sha256(buffer.trim()),
            });
            idx++;
          }
          buffer = breadcrumb;
        }
        buffer += para + '\n\n';
      }

      if (buffer.trim().length >= MIN_CHUNK_CHARS) {
        chunks.push({
          id: makeId(source, section.headings, idx),
          source,
          text: buffer.trim(),
          hash: sha256(buffer.trim()),
        });
        idx++;
      }
    }
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface Section {
  headings: string[];   // ancestor heading chain
  lines: string[];
}

function splitByHeadings(lines: string[]): Section[] {
  const sections: Section[] = [];
  const headingStack: Array<{ level: number; text: string }> = [];
  let currentLines: string[] = [];

  function flush() {
    if (currentLines.length > 0) {
      sections.push({
        headings: headingStack.map((h) => h.text),
        lines: [...currentLines],
      });
      currentLines = [];
    }
  }

  for (const line of lines) {
    const match = HEADING_RE.exec(line);
    if (match) {
      flush();
      const level = match[1].length;
      const text = match[2].trim();

      // Pop headings at same or deeper level
      while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text });
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return sections;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}
