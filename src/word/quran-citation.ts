import type { AyahReference, QuranIndex, QuranAyahRecord } from "../core/types.js";
import { normalizeArabic } from "../core/normalizer.js";
import { normalizeArabicDigits } from "../core/arabic-digits.js";

export type QuranCitationReviewStatus =
  | "missing"
  | "correct"
  | "incorrect"
  | "ambiguous"
  | "outside-scope"
  | "unavailable";

export interface QuranCitationReview {
  status: QuranCitationReviewStatus;
  expectedCitation: string;
  existingCitation?: string;
  separator?: string;
  /** UTF-16 offsets of the adjacent bracketed citation in the inspected text. */
  start?: number;
  end?: number;
  editable: boolean;
  detail: string;
}

export interface CitationReviewScope {
  start: number;
  end: number;
}

/** Independent user choices for citation insertion and correction. */
export interface QuranCitationOperationOptions {
  /** Add a citation only when the adjacent citation is missing. */
  addMissing: boolean;
  /** Replace a clearly identified incorrect citation; never insert missing ones. */
  correctExisting: boolean;
}

/**
 * Resolves the mutually exclusive citation modes.
 * Correction/verification always takes precedence: it must never add a
 * citation to a quotation that currently has no adjacent reference.
 */
export function resolveQuranCitationOperationOptions(
  addMissingSelected: boolean,
  correctExistingSelected: boolean
): QuranCitationOperationOptions {
  return correctExistingSelected
    ? { addMissing: false, correctExisting: true }
    : { addMissing: addMissingSelected, correctExisting: false };
}

/**
 * Applies citation actions without conflating insertion with correction.
 * Existing incorrect citations are preserved unless correction is explicitly
 * enabled. Ambiguous, out-of-scope and unavailable cases are never modified.
 */
export function composeQuranCitationReplacement(
  verseText: string,
  review: QuranCitationReview | undefined,
  expectedCitation: string | undefined,
  options: QuranCitationOperationOptions
): string {
  if (!review) return verseText;

  const { addMissing, correctExisting } = resolveQuranCitationOperationOptions(
    options.addMissing,
    options.correctExisting
  );
  const separator = review.separator ?? " ";
  switch (review.status) {
    case "missing":
      return addMissing && expectedCitation
        ? `${verseText}${separator}${expectedCitation}`
        : verseText;

    case "incorrect": {
      const citation = correctExisting
        ? expectedCitation
        : review.existingCitation;
      return citation ? `${verseText}${separator}${citation}` : verseText;
    }

    case "correct":
    case "ambiguous":
    case "outside-scope":
    case "unavailable":
      return verseText;
  }
}

/**
 * Revalidates the citation against the current source text, then prepares the
 * requested addition/correction from that fresh result. Keeping inspection
 * and composition together prevents correction from relying on stale scan
 * metadata.
 */
export function verifyAndComposeQuranCitationReplacement(
  verseText: string,
  sourceText: string,
  verseEnd: number,
  expectedCitation: string | undefined,
  expectedReferences: readonly AyahReference[],
  index: QuranIndex,
  options: QuranCitationOperationOptions,
  scope?: CitationReviewScope
): { review: QuranCitationReview; replacementText: string } {
  const review = inspectAdjacentQuranCitation(
    sourceText,
    verseEnd,
    expectedCitation,
    expectedReferences,
    index,
    scope
  );
  return {
    review,
    replacementText: composeQuranCitationReplacement(
      verseText,
      review,
      expectedCitation,
      options
    )
  };
}

/** Build source-backed citations from verified dataset identities only. */
export function formatQuranCitation(references: readonly AyahReference[], index: QuranIndex): string | undefined {
  if (!references.length) return undefined;
  const records = references.map(reference => index.get(reference));
  if (records.some(record => !record)) return undefined;
  const resolved = records as QuranAyahRecord[];
  const groups = new Map<number, QuranAyahRecord[]>();
  for (const record of resolved) {
    const group = groups.get(record.surah) ?? [];
    if (group.length && group[0]!.surahNameArabic !== record.surahNameArabic) return undefined;
    if (!group.some(item => item.ayah === record.ayah)) group.push(record);
    groups.set(record.surah, group);
  }
  const citations: string[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => a.ayah - b.ayah);
    const first = group[0]!;
    const consecutive = group.every((record, position) => record.ayah === first.ayah + position);
    const ayahs = consecutive && group.length > 1
      ? `${first.ayah}–${group[group.length - 1]!.ayah}`
      : group.map(record => String(record.ayah)).join("؛ ");
    citations.push(`${first.surahNameArabic}: ${ayahs}`);
  }
  return `[${citations.join("؛ ")}]`;
}

function normalizeCitation(value: string): string {
  return normalizeArabic(normalizeArabicDigits(value))
    .replace(/[\sـ]/gu, "")
    .replace(/[–—−]/gu, "-");
}

/** Recognize the same citation immediately following the verse, without duplicating it. */
export function hasMatchingQuranCitation(trailingText: string, expectedCitation: string): boolean {
  const match = trailingText.match(/^\s*[،؛,.;:!?؟]*\s*\[([^\]\r\n]{1,180})\]/u);
  if (!match) return false;
  return normalizeCitation(match[1]!) === normalizeCitation(expectedCitation.slice(1, -1));
}

const surahNameIndexes = new WeakMap<QuranIndex, Map<string, number>>();
function getSurahNameIndex(index: QuranIndex): Map<string, number> {
  const cached = surahNameIndexes.get(index);
  if (cached) return cached;
  const names = new Map<string, number>();
  for (const record of index.all()) {
    const key = normalizeCitation(record.surahNameArabic);
    const existing = names.get(key);
    if (existing !== undefined && existing !== record.surah) {
      names.delete(key);
      continue;
    }
    names.set(key, record.surah);
  }
  surahNameIndexes.set(index, names);
  return names;
}

function resolveSurahNumber(name: string, index: QuranIndex): number | undefined {
  const cleaned = name.trim().replace(/^سورة\s*/u, "");
  return getSurahNameIndex(index).get(normalizeCitation(cleaned));
}

type ParsedCitation =
  | { status: "valid"; references: AyahReference[] }
  | { status: "invalid" }
  | { status: "ambiguous" };

/**
 * Parse the compact citation syntax emitted by formatQuranCitation, including
 * several surahs and non-consecutive ayahs. Unknown labels stay ambiguous.
 */
function parseCitationContent(value: string, index: QuranIndex): ParsedCitation {
  const sections = value.split(/[؛;]/u).map(part => part.trim()).filter(Boolean);
  if (!sections.length) return { status: "ambiguous" };
  const references: AyahReference[] = [];
  let currentSurah: number | undefined;

  for (const section of sections) {
    const separator = section.search(/[:：،]/u);
    let ayahSpec = section;
    if (separator >= 0) {
      const surahName = section.slice(0, separator).trim();
      currentSurah = resolveSurahNumber(surahName, index);
      if (!currentSurah) return { status: "ambiguous" };
      ayahSpec = section.slice(separator + 1).trim();
    }
    if (!currentSurah) return { status: "ambiguous" };

    const tokens = ayahSpec
      .replace(/^الآيات?\s*/u, "")
      .split(/[،,]/u)
      .map(token => token.trim())
      .filter(Boolean);
    if (!tokens.length) return { status: "ambiguous" };

    for (const token of tokens) {
      const match = token.match(/^([0-9٠-٩۰-۹]{1,3})(?:\s*[-–—]\s*([0-9٠-٩۰-۹]{1,3}))?$/u);
      if (!match) return { status: "ambiguous" };
      const first = Number(normalizeArabicDigits(match[1]!));
      const last = Number(normalizeArabicDigits(match[2] ?? match[1]!));
      if (!Number.isInteger(first) || !Number.isInteger(last) ||
          first < 1 || last < first || last - first > 286) {
        return { status: "invalid" };
      }
      for (let ayah = first; ayah <= last; ayah += 1) {
        if (!index.get({ surah: currentSurah, ayah })) return { status: "invalid" };
        references.push({ surah: currentSurah, ayah });
      }
    }
  }

  const unique = references.filter((reference, position) =>
    references.findIndex(candidate =>
      candidate.surah === reference.surah && candidate.ayah === reference.ayah
    ) === position
  );
  return unique.length ? { status: "valid", references: unique } : { status: "ambiguous" };
}

function sameReferences(
  actual: readonly AyahReference[],
  expected: readonly AyahReference[]
): boolean {
  const actualKeys = new Set(actual.map(reference => `${reference.surah}:${reference.ayah}`));
  const expectedKeys = new Set(expected.map(reference => `${reference.surah}:${reference.ayah}`));
  return actualKeys.size === expectedKeys.size &&
    [...expectedKeys].every(key => actualKeys.has(key));
}

/**
 * Inspects only a bracketed reference immediately after a detected quotation.
 * A known but incorrect Qur'anic citation can be corrected; unknown or
 * bibliographic-looking references are deliberately left untouched.
 */
export function inspectAdjacentQuranCitation(
  text: string,
  verseEnd: number,
  expectedCitation: string | undefined,
  expectedReferences: readonly AyahReference[],
  index: QuranIndex,
  scope?: CitationReviewScope
): QuranCitationReview {
  if (!expectedCitation || !expectedReferences.length) {
    return {
      status: "unavailable",
      expectedCitation: expectedCitation ?? "",
      editable: false,
      detail: "تعذر توليد تخريج موثوق من مراجع الآية."
    };
  }

  const trailing = text.slice(verseEnd);
  const match = trailing.match(/^([\s،؛,.;:!?؟]*)(\[[^\]\r\n]{1,180}\])/u);
  if (!match) {
    if (scope && verseEnd >= scope.end) {
      return {
        status: "outside-scope",
        expectedCitation,
        editable: false,
        detail: "انتهى النص المحدد عند نهاية الآية؛ لم يُفحص ما بعدها خارج التحديد، لذلك لن يُضاف تخريج قد يكون موجودًا خارجه."
      };
    }
    return {
      status: "missing",
      expectedCitation,
      editable: true,
      detail: "لا يوجد تخريج قرآني ملاصق لهذا الاقتباس."
    };
  }

  const start = verseEnd + match[1]!.length;
  const end = start + match[2]!.length;
  const existingCitation = match[2]!;
  const content = existingCitation.slice(1, -1);
  const citationLike = /[:：،]/u.test(content) ||
    (/\p{Script=Arabic}/u.test(content) && /[0-9٠-٩۰-۹]/u.test(content));

  // A plain bracketed number is commonly a footnote, not a Quran citation.
  if (!citationLike) {
    const plainFootnote = /^\s*\d+\s*$/u.test(normalizeArabicDigits(content));
    if (!plainFootnote && /[\p{L}]/u.test(content)) {
      return {
        status: "ambiguous",
        expectedCitation,
        existingCitation,
        separator: match[1]!,
        start,
        end,
        editable: false,
        detail: "الإحالة الملاصقة ليست بصيغة تخريج قرآني واضحة؛ ستُترك دون تغيير."
      };
    }
    return {
      status: "missing",
      expectedCitation,
      editable: true,
      detail: "لا يوجد تخريج قرآني ملاصق لهذا الاقتباس؛ لم يُخلط بين رقم الحاشية والتخريج."
    };
  }

  if (scope && (start < scope.start || end > scope.end)) {
    return {
      status: "outside-scope",
      expectedCitation,
      existingCitation,
      separator: match[1]!.slice(0, match[1]!.length),
      start,
      end,
      editable: false,
      detail: "يوجد مرجع ملاصق خارج النص المحدد؛ سيُترك دون تعديل حمايةً لنطاق المستخدم."
    };
  }

  const parsed = parseCitationContent(content, index);
  if (parsed.status === "ambiguous") {
    return {
      status: "ambiguous",
      expectedCitation,
      existingCitation,
      separator: match[1]!.slice(0, match[1]!.length),
      start,
      end,
      editable: false,
      detail: "المرجع الملاصق ملتبس أو غير معروف؛ سيُترك دون تغيير."
    };
  }

  if (parsed.status === "invalid" || !sameReferences(parsed.references, expectedReferences)) {
    return {
      status: "incorrect",
      expectedCitation,
      existingCitation,
      separator: match[1]!,
      start,
      end,
      editable: true,
      detail: "التخريج الموجود لا يطابق الآيات المكتشفة؛ يمكن استبداله بالتخريج الصحيح."
    };
  }

  return {
    status: "correct",
    expectedCitation,
    existingCitation,
    separator: match[1]!,
    start,
    end,
    editable: true,
    detail: "التخريج الموجود صحيح ومطابق لمراجع الآيات."
  };
}
