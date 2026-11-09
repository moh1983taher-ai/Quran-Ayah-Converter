import type { AyahReference, QuranIndex, QuranAyahRecord } from "../core/types.js";
import { normalizeArabic } from "../core/normalizer.js";

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

/** Recognize the same citation immediately following the verse, without duplicating it. */
export function hasMatchingQuranCitation(trailingText: string, expectedCitation: string): boolean {
  const match = trailingText.match(/^\s*[،؛,.;:!?؟]*\s*\[([^\]\r\n]{1,180})\]/u);
  if (!match) return false;
  return normalizeCitation(match[1]!) === normalizeCitation(expectedCitation.slice(1, -1));
}

function normalizeCitation(value: string): string {
  const digits = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹";
  const westernDigits = value.replace(/[٠-٩۰-۹]/gu, digit => String(digits.indexOf(digit) % 10));
  return normalizeArabic(westernDigits).replace(/[\sـ]/gu, "").replace(/[–—−]/gu, "-");
}
