import type { QuranIndex, AyahReference, QuranAyahRecord } from "../core/types.js";
import { normalizeArabic } from "../core/normalizer.js";
import { normalizeArabicDigits } from "../core/arabic-digits.js";

export type CitationStatus = "valid" | "invalid" | "ambiguous" | "unrecognized";
export interface QuranCitationIssue {
  start: number;
  end: number;
  original: string;
  status: CitationStatus;
  references: AyahReference[];
  message: string;
  suggestedCitation?: string;
}
function compact(value: string): string {
  return normalizeArabic(normalizeArabicDigits(value)).replace(/[\sـ]/gu, "").replace(/[–—−]/gu, "-");
}
function surahNumber(name: string, index: QuranIndex): number | undefined {
  const normalized = compact(name.replace(/^سورة/u, ""));
  const names = new Map<number, string>();
  for (const record of index.all()) names.set(record.surah, compact(record.surahNameArabic));
  const exact = [...names].filter(([, canonical]) => canonical === normalized);
  if (exact.length === 1) return exact[0]![0];
  const candidates = [...names].filter(([, canonical]) => canonical.includes(normalized) || normalized.includes(canonical));
  return candidates.length === 1 ? candidates[0]![0] : undefined;
}
function citationFor(surah: number, start: number, end: number, index: QuranIndex): string | undefined {
  const first = index.get({ surah, ayah: start });
  const last = index.get({ surah, ayah: end });
  if (!first || !last) return undefined;
  return `[${first.surahNameArabic}: ${start === end ? start : `${start}–${end}`}]`;
}
/** Detect citations in common Arabic scholarly forms and validate them against the loaded canonical dataset. */
export function validateQuranCitations(text: string, index: QuranIndex): QuranCitationIssue[] {
  const issues: QuranCitationIssue[] = [];
  const pattern = /\[(?:سورة\s*)?([^\]:،؛]+?)\s*[:：،]\s*(?:الآية\s*)?([0-9٠-٩۰-۹]{1,3})(?:\s*[-–—]\s*([0-9٠-٩۰-۹]{1,3}))?\]/gu;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    const original = match[0];
    const surah = surahNumber(match[1]!.trim(), index);
    const first = Number(normalizeArabicDigits(match[2]!));
    const last = Number(normalizeArabicDigits(match[3] ?? match[2]!));
    if (!surah) {
      issues.push({ start, end: start + original.length, original, status: "ambiguous", references: [], message: "اسم السورة غير معروف أو يحتمل أكثر من اسم." });
      continue;
    }
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last - first > 286) {
      issues.push({ start, end: start + original.length, original, status: "invalid", references: [], message: "صيغة رقم الآية أو نطاقها غير صحيح." });
      continue;
    }
    const refs: AyahReference[] = [];
    let missing = false;
    for (let ayah = first; ayah <= last; ayah++) {
      if (!index.get({ surah, ayah })) { missing = true; break; }
      refs.push({ surah, ayah });
    }
    const record = index.get({ surah, ayah: first }) as QuranAyahRecord | undefined;
    const suggestedCitation = !missing && record ? citationFor(surah, first, last, index) : undefined;
    issues.push({
      start, end: start + original.length, original,
      status: missing ? "invalid" : "valid",
      references: missing ? [] : refs,
      message: missing ? "رقم الآية أو نهاية النطاق تتجاوز آيات السورة." : "التخريج مطابق لقاعدة المصحف.",
      ...(suggestedCitation ? { suggestedCitation } : {})
    });
  }
  return issues;
}
