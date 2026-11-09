import type { AyahMatch, AyahReference } from "../core/types.js";
import type { WordReplacement } from "./word-adapter.js";

export type ReviewDecision = "pending" | "approved" | "rejected" | "applied";

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


/**
 * Combines separately detected ayahs only when they form one uninterrupted
 * quotation enclosed by a single outer bracket pair. Text between ayahs is
 * retained verbatim; prose inside the bracket prevents grouping.
 */
export function groupBracketedAyahMatches(
  sourceText: string,
  matches: readonly AyahMatch[]
): AyahMatch[] {
  const ordered = [...matches].sort((a, b) =>
    a.sourceStart - b.sourceStart || a.sourceEnd - b.sourceEnd
  );
  const consumed = new Set<AyahMatch>();
  const grouped: AyahMatch[] = [];
  const bracketPairs: ReadonlyArray<readonly [string, string]> = [
    ["﴿", "﴾"],
    ["", ""],
    ["ﭽ", "ﭼ"],
    ["ﭿ", "ﭾ"],
    ["ﮁ", "ﮀ"],
    ["ﮃ", "ﮂ"],
    ["ﮅ", "ﮄ"],
    ["ﮇ", "ﮆ"],
    ["ﮉ", "ﮈ"],
    ["ﮋ", "ﮊ"],
    ["ﵡ", "ﵠ"]
  ];
  // Separators and printed ayah markers are internal to one quoted passage.
  // Arabic/Western digits are admitted only as standalone markers, never as
  // arbitrary prose; words between matches still prevent grouping.
  const separatorOnly = (value: string): boolean =>
    /^[\s*،؛,:.\-–—ـ۞۝۩|٠-٩0-9۞۝۩ۣ۟۠ۡۢۤۥۦۧۨ۩۪ۭ۫۬۞۝]*$/u.test(value);

  const areConsecutiveAyahs = (items: readonly AyahMatch[]): boolean => {
    const refs = items.map(item => item.references.length === 1 ? item.references[0] : undefined);
    if (refs.some(reference => !reference)) return true;
    const first = refs[0]!;
    return refs.every((reference, index) =>
      reference!.surah === first!.surah && reference!.ayah === first!.ayah + index
    );
  };

  for (const [opening, closing] of bracketPairs) {
    let cursor = 0;
    while (cursor < sourceText.length) {
      const openAt = sourceText.indexOf(opening, cursor);
      if (openAt < 0) break;
      const closeAt = sourceText.indexOf(closing, openAt + opening.length);
      if (closeAt < 0) break;
      cursor = closeAt + closing.length;

      const inside = ordered.filter(match =>
        !consumed.has(match) &&
        match.sourceStart >= openAt + opening.length &&
        match.sourceEnd <= closeAt &&
        match.sourceEnd > match.sourceStart
      );
      if (inside.length < 2) continue;

      const first = inside[0]!;
      const last = inside[inside.length - 1]!;
      const contentStart = openAt + opening.length;
      const content = sourceText.slice(contentStart, closeAt);
      let previousEnd = contentStart;
      let valid = separatorOnly(sourceText.slice(contentStart, first.sourceStart));
      for (const match of inside) {
        if (match.status === "ambiguous" ||
            !(match.replacementText ?? match.canonicalText).trim() ||
            match.sourceStart < previousEnd ||
            !separatorOnly(sourceText.slice(previousEnd, match.sourceStart))) {
          valid = false;
          break;
        }
        previousEnd = match.sourceEnd;
      }
      valid = valid &&
        separatorOnly(sourceText.slice(last.sourceEnd, closeAt)) &&
        areConsecutiveAyahs(inside);
      if (!valid) continue;

      let replacementBody = content;
      for (const match of [...inside].reverse()) {
        const localStart = match.sourceStart - contentStart;
        const localEnd = match.sourceEnd - contentStart;
        replacementBody =
          replacementBody.slice(0, localStart) +
          (match.replacementText ?? match.canonicalText) +
          replacementBody.slice(localEnd);
      }

      const references = inside.flatMap(match => match.references);
      const uniqueReferences = references.filter((reference, index) =>
        references.findIndex(candidate =>
          candidate.surah === reference.surah && candidate.ayah === reference.ayah
        ) === index
      );
      const evidence = inside.flatMap(match => match.evidence);
      evidence.push({
        type: "context",
        detail: "آيات متعددة داخل اقتباس واحد؛ حُفظت الفواصل الأصلية ووُحّدت الأقواس الخارجية"
      });

      grouped.push({
        sourceStart: openAt,
        sourceEnd: closeAt + closing.length,
        matchedText: sourceText.slice(openAt, closeAt + closing.length),
        canonicalText: replacementBody,
        replacementText: replacementBody,
        references: uniqueReferences,
        confidence: Math.min(...inside.map(match => match.confidence)),
        evidence,
        status: inside.every(match => match.status === "high-confidence")
          ? "high-confidence"
          : "needs-review"
      });
      inside.forEach(match => consumed.add(match));
    }
  }

  return [...ordered.filter(match => !consumed.has(match)), ...grouped]
    .sort((a, b) => a.sourceStart - b.sourceStart);
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
        replacementText: match.replacementText ?? match.canonicalText,
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
  decision: "approved" | "rejected"
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
