import type { QuranIndex, AyahReference } from "../core/types.js";
import { normalizeArabic } from "../core/normalizer.js";
import type { QuranCitationIssue } from "./citation-validator.js";

interface ExactMatch {
  reference: AyahReference;
  surahNameArabic: string;
}

/**
 * Suggests a citation only when the complete text inside canonical Qur'anic
 * brackets exactly matches one unique ayah after the project's conservative
 * Arabic normalization. Partial quotations are intentionally not corrected.
 */
export function suggestExactAyahCitation(
  paragraphText: string,
  issue: QuranCitationIssue,
  index: QuranIndex
): string | undefined {
  const beforeCitation = paragraphText.slice(0, issue.start);
  const quoted = beforeCitation.match(/﴿([^﴿﴾]{3,2000})﴾[\s،؛,.!?؟]*$/u);
  if (!quoted?.[1]) return undefined;

  const normalizedQuote = normalizeArabic(quoted[1]).replace(/\s/gu, "");
  if (!normalizedQuote) return undefined;

  const matches = new Map<string, ExactMatch>();
  for (const record of index.all()) {
    const forms = new Set([
      normalizeArabic(record.uthmani).replace(/\s/gu, ""),
      normalizeArabic(record.imlaei).replace(/\s/gu, "")
    ]);
    if (forms.has(normalizedQuote)) {
      matches.set(`${record.surah}:${record.ayah}`, {
        reference: { surah: record.surah, ayah: record.ayah },
        surahNameArabic: record.surahNameArabic
      });
    }
  }

  // A text shared by more than one ayah is not safe for automatic correction.
  if (matches.size !== 1) return undefined;
  const match = [...matches.values()][0]!;
  const canonical = `[${match.surahNameArabic}: ${match.reference.ayah}]`;
  return canonical === issue.original ? undefined : canonical;
}

/** Enriches detected citations with text-grounded, unique correction suggestions. */
export function analyzeCitationText(
  paragraphText: string,
  issues: QuranCitationIssue[],
  index: QuranIndex
): QuranCitationIssue[] {
  return issues.map(issue => {
    const suggestedCitation = suggestExactAyahCitation(paragraphText, issue, index);
    if (!suggestedCitation) return issue;
    return {
      ...issue,
      status: "mismatch",
      suggestedCitation,
      message: "نص الآية الكاملة يطابق مرجعًا آخر في المصحف؛ راجع التصحيح المقترح قبل اعتماده."
    };
  });
}
