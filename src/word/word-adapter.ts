/**
 * Safe paragraph-level replacement planning for the Word adapter.
 *
 * This module deliberately does not call Office.js. It creates a guarded,
 * deterministic plan that a Word.Range adapter can execute only after
 * re-reading and verifying each paragraph immediately before replacement.
 */

export interface WordTextSegment {
  text: string;
  /** Opaque adapter-owned location; core code must not interpret it. */
  location: unknown;
}

export interface WordParagraphReplacement {
  start: number;
  end: number;
  expectedOriginalText: string;
  replacementText: string;
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

export interface ParagraphReplacementStep {
  paragraphIndex: number;
  start: number;
  end: number;
  expectedOriginalText: string;
  replacementText: string;
  /** Exact paragraph text expected immediately before this step. */
  expectedParagraphText: string;
  /** Exact paragraph text expected immediately after this step. */
  resultingParagraphText: string;
}

export interface ParagraphReplacementPlan {
  paragraphIndex: number;
  originalParagraphText: string;
  steps: ParagraphReplacementStep[];
}

/**
 * Validates offsets against the exact paragraph snapshot and builds a plan
 * from right to left. Earlier offsets therefore remain stable as later text
 * is replaced. Overlapping or stale ranges are rejected before Word changes.
 */
export function createParagraphReplacementPlan(
  paragraphIndex: number,
  sourceText: string,
  replacements: readonly WordParagraphReplacement[]
): ParagraphReplacementPlan {
  if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0) {
    throw new Error("Invalid Word paragraph index");
  }

  const ordered = [...replacements].sort((a, b) => b.start - a.start);
  let previousStart = sourceText.length + 1;

  for (const replacement of ordered) {
    if (
      !Number.isInteger(replacement.start) ||
      !Number.isInteger(replacement.end) ||
      replacement.start < 0 ||
      replacement.end <= replacement.start ||
      replacement.end > sourceText.length
    ) {
      throw new Error("Replacement range is outside the paragraph snapshot");
    }
    if (replacement.start < 0 || replacement.end > previousStart) {
      throw new Error("Overlapping paragraph replacements are not allowed");
    }
    if (sourceText.slice(replacement.start, replacement.end) !== replacement.expectedOriginalText) {
      throw new Error("Original text does not match the paragraph snapshot");
    }
    if (!replacement.replacementText.trim()) {
      throw new Error("Replacement text cannot be empty");
    }
    previousStart = replacement.start;
  }

  let expectedParagraphText = sourceText;
  const steps: ParagraphReplacementStep[] = [];

  for (const replacement of ordered) {
    if (
      expectedParagraphText.slice(replacement.start, replacement.end) !==
      replacement.expectedOriginalText
    ) {
      throw new Error("Replacement anchor became stale while planning");
    }

    const resultingParagraphText =
      expectedParagraphText.slice(0, replacement.start) +
      replacement.replacementText +
      expectedParagraphText.slice(replacement.end);

    steps.push({
      paragraphIndex,
      start: replacement.start,
      end: replacement.end,
      expectedOriginalText: replacement.expectedOriginalText,
      replacementText: replacement.replacementText,
      expectedParagraphText,
      resultingParagraphText
    });

    expectedParagraphText = resultingParagraphText;
  }

  return {
    paragraphIndex,
    originalParagraphText: sourceText,
    steps
  };
}

/**
 * Converts paragraph-relative JavaScript string offsets into Word's absolute
 * character positions. Supports both UTF-16 and Unicode code-point indexing;
 * rejects any coordinate system that cannot be mapped without ambiguity.
 */
export function getWordRangeOffsets(
  paragraphStart: number,
  paragraphEnd: number,
  paragraphText: string,
  sourceStart: number,
  sourceEnd: number
): { start: number; end: number } {
  if (
    !Number.isInteger(paragraphStart) ||
    !Number.isInteger(paragraphEnd) ||
    paragraphEnd < paragraphStart ||
    !Number.isInteger(sourceStart) ||
    !Number.isInteger(sourceEnd) ||
    sourceStart < 0 ||
    sourceEnd <= sourceStart ||
    sourceEnd > paragraphText.length
  ) {
    throw new Error("Invalid paragraph or source offsets");
  }

  const wordLength = paragraphEnd - paragraphStart;
  const utf16Length = paragraphText.length;
  const codePoints = Array.from(paragraphText);
  const codePointLength = codePoints.length;

  const toWordOffset = (jsOffset: number): number => {
    if (wordLength === utf16Length) return jsOffset;
    if (wordLength === codePointLength) {
      return Array.from(paragraphText.slice(0, jsOffset)).length;
    }
    throw new Error("Word and JavaScript paragraph offsets are not aligned");
  };

  const startOffset = toWordOffset(sourceStart);
  const endOffset = toWordOffset(sourceEnd);
  return {
    start: paragraphStart + startOffset,
    end: paragraphStart + endOffset
  };
}

/**
 * A final guard for the Office.js layer. It must compare the live paragraph
 * text to expectedParagraphText before resolving the range and replacing it.
 */
export function assertParagraphSnapshot(
  liveParagraphText: string,
  expectedParagraphText: string
): void {
  if (liveParagraphText !== expectedParagraphText) {
    throw new Error("Word paragraph changed after review; replacement cancelled");
  }
}
