import type { QuranCitationOperationOptions, QuranCitationReview } from "./quran-citation.js";
import { resolveQuranCitationOperationOptions } from "./quran-citation.js";

export type CitationEditPlan =
  | { kind: "insert"; text: string; separator: string }
  | { kind: "replace"; text: string; start: number; end: number }
  | { kind: "none" };

export interface WordApplyPlan {
  convertVerse: boolean;
  citationEdit: CitationEditPlan;
}

export interface WordApplyPlanInput {
  convertVerse: boolean;
  addMissingCitation: boolean;
  correctExistingCitation: boolean;
  review?: QuranCitationReview;
  expectedCitation?: string;
}

/**
 * Creates an operation plan without composing verse and citation into one
 * replacement string. The verse and citation therefore remain separate Word
 * ranges and can be changed independently.
 */
export function createWordApplyPlan(input: WordApplyPlanInput): WordApplyPlan {
  const citationOptions: QuranCitationOperationOptions =
    resolveQuranCitationOperationOptions(
      input.addMissingCitation,
      input.correctExistingCitation
    );
  const review = input.review;
  const citation = input.expectedCitation;

  if (!review?.editable || !citation) {
    return { convertVerse: input.convertVerse, citationEdit: { kind: "none" } };
  }

  if (review.status === "missing" && citationOptions.addMissing) {
    return {
      convertVerse: input.convertVerse,
      citationEdit: {
        kind: "insert",
        text: citation,
        separator: review.separator ?? " "
      }
    };
  }

  if (review.status === "incorrect" && citationOptions.correctExisting &&
      Number.isInteger(review.start) && Number.isInteger(review.end) &&
      review.start! >= 0 && review.end! > review.start!) {
    return {
      convertVerse: input.convertVerse,
      citationEdit: {
        kind: "replace",
        text: citation,
        start: review.start!,
        end: review.end!
      }
    };
  }

  return { convertVerse: input.convertVerse, citationEdit: { kind: "none" } };
}
