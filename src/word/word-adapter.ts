/**
 * Word-specific code belongs here, not in the detection engine.
 *
 * Planned responsibilities:
 * 1. Read text from supported Word ranges, including paragraphs and tables.
 * 2. Preserve document locations for each detected quotation.
 * 3. Present a review list before any document mutation.
 * 4. Revalidate anchors immediately before applying an approved replacement.
 * 5. Replace only the approved quotation range, preserving surrounding text.
 *
 * Footnotes and endnotes require a separate capability check and adapter.
 */

export interface WordTextSegment {
  text: string;
  /** Opaque adapter-owned location; core code must not interpret it. */
  location: unknown;
}

export interface WordReplacement {
  location: unknown;
  expectedOriginalText: string;
  replacementText: string;
}

export interface WordAdapter {
  readSegments(): Promise<WordTextSegment[]>;
  applyReplacement(replacement: WordReplacement): Promise<void>;
}
