import type { AyahMatch, AyahReference } from "../core/types.js";
import type { WordReplacement } from "./word-adapter.js";

export type ReviewDecision = "pending" | "approved" | "rejected";

export interface ReviewItem {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  originalText: string;
  replacementText: string;
  references: AyahReference[];
  confidence: number;
  status: AyahMatch["status"];
  evidence: AyahMatch["evidence"];
  decision: ReviewDecision;
}

/** Converts detector output into stable, reviewable items without mutating Word. */
export function createReviewItems(
  sourceText: string,
  matches: readonly AyahMatch[]
): ReviewItem[] {
  return matches
    .filter(match =>
      match.sourceStart >= 0 &&
      match.sourceEnd > match.sourceStart &&
      match.sourceEnd <= sourceText.length
    )
    .map(match => {
      const originalText = sourceText.slice(match.sourceStart, match.sourceEnd);
      const identity = match.references
        .map(reference => `${reference.surah}:${reference.ayah}`)
        .join(",");
      return {
        id: `${match.sourceStart}-${match.sourceEnd}-${identity}`,
        sourceStart: match.sourceStart,
        sourceEnd: match.sourceEnd,
        originalText,
        replacementText: match.canonicalText,
        references: match.references.map(reference => ({ ...reference })),
        confidence: match.confidence,
        status: match.status,
        evidence: [...match.evidence],
        decision: "pending" as const
      };
    });
}

/** Returns a new review list; ambiguous or textless matches cannot be approved. */
export function setReviewDecision(
  items: readonly ReviewItem[],
  ids: readonly string[],
  decision: Exclude<ReviewDecision, "pending">
): ReviewItem[] {
  const selected = new Set(ids);
  return items.map(item => {
    if (!selected.has(item.id)) return item;
    if (decision === "approved" &&
      (item.status === "ambiguous" || !item.replacementText.trim())) {
      throw new Error(`Cannot approve an ambiguous or textless match: ${item.id}`);
    }
    return { ...item, decision };
  });
}

/**
 * Builds guarded replacements only for explicitly approved items.
 * Offsets are retained for the adapter, which must revalidate the original
 * text immediately before changing the document.
 */
export function buildApprovedReplacements(
  items: readonly ReviewItem[]
): WordReplacement[] {
  return items
    .filter(item => item.decision === "approved")
    .sort((a, b) => b.sourceStart - a.sourceStart)
    .map(item => {
      if (!item.replacementText.trim() || item.status === "ambiguous") {
        throw new Error(`Unsafe approved replacement: ${item.id}`);
      }
      return {
        location: {
          start: item.sourceStart,
          end: item.sourceEnd,
          references: item.references
        },
        expectedOriginalText: item.originalText,
        replacementText: item.replacementText
      };
    });
}
