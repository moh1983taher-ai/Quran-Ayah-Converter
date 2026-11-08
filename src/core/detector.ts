import type {
  AyahMatch,
  AyahReference,
  MatchEvidence,
  QuranAyahRecord,
  QuranIndex
} from "./types.js";
import { mapNormalizedRange, normalizeArabicWithMap } from "./normalizer.js";
import { findFuzzyTokenAlignments, prepareFuzzySource } from "./alignment.js";
import { resolveAyahIdentity } from "./identity-resolver.js";

export interface DetectorOptions {
  /** Minimum number of normalized Arabic letters in an unmarked quotation. */
  minimumUnmarkedLength?: number;
  /** Maximum consecutive ayahs to consider as one quotation. */
  maximumAyahsPerMatch?: number;
  /** Confidence required before a match is marked high-confidence. */
  highConfidenceThreshold?: number;
}

interface Candidate {
  start: number;
  end: number;
  records: QuranAyahRecord[];
  evidence: MatchEvidence[];
  confidence: number;
  status: AyahMatch["status"];
}

interface ExplicitReference {
  start: number;
  end: number;
  surah: number;
  ayah: number;
  raw: string;
}

const DEFAULTS: Required<DetectorOptions> = {
  minimumUnmarkedLength: 14,
  maximumAyahsPerMatch: 8,
  highConfidenceThreshold: 0.94
};

const BRACKET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // Only the Qur'anic ornamental brackets are accepted as verse delimiters.
  ["﴿", "﴾"]
];

const SURAH_NAMES: ReadonlyArray<string> = [
  "الفاتحة","البقرة","آل عمران","النساء","المائدة","الأنعام","الأعراف","الأنفال","التوبة","يونس",
  "هود","يوسف","الرعد","إبراهيم","الحجر","النحل","الإسراء","الكهف","مريم","طه",
  "الأنبياء","الحج","المؤمنون","النور","الفرقان","الشعراء","النمل","القصص","العنكبوت","الروم",
  "لقمان","السجدة","الأحزاب","سبأ","فاطر","يس","الصافات","ص","الزمر","غافر",
  "فصلت","الشورى","الزخرف","الدخان","الجاثية","الأحقاف","محمد","الفتح","الحجرات","ق",
  "الذاريات","الطور","النجم","القمر","الرحمن","الواقعة","الحديد","المجادلة","الحشر","الممتحنة",
  "الصف","الجمعة","المنافقون","التغابن","الطلاق","التحريم","الملك","القلم","الحاقة","المعارج",
  "نوح","الجن","المزمل","المدثر","القيامة","الإنسان","المرسلات","النبأ","النازعات","عبس",
  "التكوير","الانفطار","المطففين","الانشقاق","البروج","الطارق","الأعلى","الغاشية","الفجر","البلد",
  "الشمس","الليل","الضحى","الشرح","التين","العلق","القدر","البينة","الزلزلة","العاديات",
  "القارعة","التكاثر","العصر","الهمزة","الفيل","قريش","الماعون","الكوثر","الكافرون","النصر",
  "المسد","الإخلاص","الفلق","الناس"
];

const SURAH_ALIASES = new Map<string, number>();
SURAH_NAMES.forEach((name, index) => {
  SURAH_ALIASES.set(normalizeArabicWithMap(name).value, index + 1);
});
SURAH_ALIASES.set(normalizeArabicWithMap("آل عمران").value, 3);
SURAH_ALIASES.set(normalizeArabicWithMap("آلِ عمران").value, 3);

/**
 * Detects exact and normalized Qur'anic quotations within one text segment.
 * This first deterministic version intentionally does not perform fuzzy
 * matching: incomplete or misspelled quotations are safer to send to review
 * than to replace automatically.
 */
export class QuranAyahDetector {
  private readonly options: Required<DetectorOptions>;

  constructor(private readonly index: QuranIndex, options: DetectorOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
  }

  detect(text: string): AyahMatch[] {
    if (!text.trim() || this.index.size === 0) return [];

    const normalized = normalizeArabicWithMap(text);
    const records = [...this.index.all()].sort(
      (a, b) => a.surah - b.surah || a.ayah - b.ayah
    );
    const candidates: Candidate[] = [];

    // First: explicit verse references (e.g. البقرة: 255).
    const references = this.findExplicitReferences(text);
    for (const reference of references) {
      const record = this.index.get({
        surah: reference.surah,
        ayah: reference.ayah
      });
      if (!record) continue;

      const nearbyQuote = this.findNearbyQuote(text, reference.start, reference.end);
      const exactQuote = findCanonicalBefore(text, reference.start, record.imlaei);
      const quote = exactQuote ?? nearbyQuote;
      if (!quote) continue;

      const quoteNormalized = normalizeArabicWithMap(text.slice(quote.start, quote.end));
      const canonical = normalizeArabicWithMap(record.imlaei).value;
      const ratio = exactQuote ? 1 : containmentRatio(quoteNormalized.value, canonical);
      if (ratio < 0.55) continue;

      candidates.push({
        start: quote.start,
        end: quote.end,
        records: [record],
        evidence: [
          { type: "explicit-reference", detail: reference.raw },
          { type: "normalized-text", detail: "نص قريب من الآية المشار إليها" }
        ],
        confidence: Math.min(0.99, 0.76 + ratio * 0.23),
        status: "needs-review"
      });
    }

    // Second: exact or normalized matching inside marked brackets.
    for (const [open, close] of BRACKET_PAIRS) {
      let cursor = 0;
      while (cursor < text.length) {
        const start = text.indexOf(open, cursor);
        if (start < 0) break;
        const endMarker = text.indexOf(close, start + open.length);
        if (endMarker < 0) break;
        const contentStart = start + open.length;
        const contentEnd = endMarker;
        const content = text.slice(contentStart, contentEnd);
        const match = this.matchPassage(content, records, true);
        if (match) {
          candidates.push({
            start: contentStart + match.start,
            end: contentStart + match.end,
            records: match.records,
            evidence: [
              { type: "verse-brackets", detail: open + "..." + close },
              ...match.evidence
            ],
            confidence: Math.min(0.995, match.confidence + 0.035),
            status: match.confidence + 0.035 >= this.options.highConfidenceThreshold
              ? "high-confidence"
              : "needs-review"
          });
        }
        cursor = endMarker + close.length;
      }
    }

    // Third: all unmarked quotations, not just the single longest match.
    for (const unmarked of this.matchAllPassages(text, records)) {
      if (unmarked.end - unmarked.start < this.options.minimumUnmarkedLength) continue;
      candidates.push({
        start: unmarked.start,
        end: unmarked.end,
        records: unmarked.records,
        evidence: unmarked.evidence,
        confidence: unmarked.confidence,
        status: unmarked.confidence >= this.options.highConfidenceThreshold
          ? "high-confidence"
          : "needs-review"
      });
    }

    return this.resolveOverlaps(candidates, text);
  }

  private matchAllPassages(
    source: string,
    records: readonly QuranAyahRecord[]
  ): Array<{ start: number; end: number; records: QuranAyahRecord[]; evidence: MatchEvidence[]; confidence: number }> {
    const normalized = normalizeArabicWithMap(source);
    const output: Array<{ start: number; end: number; records: QuranAyahRecord[]; evidence: MatchEvidence[]; confidence: number }> = [];

    for (let i = 0; i < records.length; i += 1) {
      const group: QuranAyahRecord[] = [];
      let phrase = "";

      for (let j = i; j < records.length && group.length < this.options.maximumAyahsPerMatch; j += 1) {
        const current = records[j];
        if (!current) break;
        if (group.length > 0) {
          const previous = group[group.length - 1]!;
          if (current.surah !== previous.surah || current.ayah !== previous.ayah + 1) break;
        }
        group.push(current);
        phrase += (phrase ? " " : "") + normalizeArabicWithMap(current.imlaei).value;
        if (phrase.length < this.options.minimumUnmarkedLength) continue;

        let cursor = 0;
        while (cursor <= normalized.value.length - phrase.length) {
          const found = findBoundaryAwareFrom(normalized.value, phrase, cursor);
          if (!found) break;
          const mapped = mapNormalizedRange(normalized, found.start, found.end);
          if (mapped) {
            output.push({
              ...mapped,
              records: [...group],
              evidence: [{
                type: "normalized-text",
                detail: "تطابق نصي بعد تطبيع الرسم"
              }],
              confidence: 0.975
            });
          }
          cursor = found.end;
        }
      }
    }

    output.push(...this.findFuzzyMatches(source, records, false));
    return output;
  }

  private findFuzzyMatches(
    source: string,
    records: readonly QuranAyahRecord[],
    allowShort: boolean
  ): Array<{ start: number; end: number; records: QuranAyahRecord[]; evidence: MatchEvidence[]; confidence: number }> {
    const matches: Array<{ start: number; end: number; records: QuranAyahRecord[]; evidence: MatchEvidence[]; confidence: number }> = [];
    const preparedSource = prepareFuzzySource(source);

    for (const record of records) {
      const canonicalTokens = normalizeArabicWithMap(record.imlaei).value.split(/\s+/u).filter(Boolean);
      const minimumTokens = allowShort ? 3 : 5;
      if (canonicalTokens.length < minimumTokens) continue;

      const maxDistance = canonicalTokens.length >= 9 ? 2 : 1;
      const alignments = findFuzzyTokenAlignments(preparedSource, record.imlaei, {
        maxDistance,
        minimumTokens
      });
      const best = alignments[0];
      if (!best) continue;

      // Fuzzy matches are suggestions only, even when the score is high.
      const confidence = Math.min(0.90, 0.80 + best.similarity * 0.10);
      matches.push({
        start: best.sourceStart,
        end: best.sourceEnd,
        records: [record],
        evidence: [{
          type: "fuzzy-alignment",
          detail: `محاذاة تقريبية على مستوى الكلمات؛ ${best.distance} اختلاف/حذف`
        }],
        confidence
      });
    }

    return matches;
  }

  private matchPassage(
    source: string,
    records: readonly QuranAyahRecord[],
    allowShort: boolean
  ): { start: number; end: number; records: QuranAyahRecord[]; evidence: MatchEvidence[]; confidence: number } | undefined {
    const sourceNormalized = normalizeArabicWithMap(source);
    const normalizedText = sourceNormalized.value;
    if (!normalizedText) return undefined;

    let best: {
      start: number;
      end: number;
      records: QuranAyahRecord[];
      evidence: MatchEvidence[];
      confidence: number;
      length: number;
    } | undefined;

    for (let i = 0; i < records.length; i += 1) {
      const first = records[i];
      if (!first) continue;

      let combined = "";
      const group: QuranAyahRecord[] = [];
      for (let j = i; j < records.length && group.length < this.options.maximumAyahsPerMatch; j += 1) {
        const current = records[j];
        if (!current) break;
        if (group.length > 0) {
          const previous = group[group.length - 1]!;
          if (current.surah !== previous.surah || current.ayah !== previous.ayah + 1) break;
        }
        group.push(current);
        combined += (combined ? " " : "") + normalizeArabicWithMap(current.imlaei).value;
        if (combined.length < (allowShort ? 4 : this.options.minimumUnmarkedLength)) continue;

        const found = findBoundaryAware(normalizedText, combined);
        if (!found) continue;
        const mapped = mapNormalizedRange(sourceNormalized, found.start, found.end);
        if (!mapped) continue;

        const candidateLength = found.end - found.start;
        if (!best || candidateLength > best.length) {
          best = {
            ...mapped,
            records: [...group],
            evidence: [{
              type: found.exact ? "exact-text" : "normalized-text",
              detail: found.exact ? "تطابق نصي" : "تطابق بعد تطبيع الرسم"
            }],
            confidence: found.exact ? 0.995 : 0.975,
            length: candidateLength
          };
        }
      }
    }

    if (!best) {
      const fuzzy = this.findFuzzyMatches(source, records, allowShort)
        .sort((a, b) => b.confidence - a.confidence)[0];
      return fuzzy;
    }
    return {
      start: best.start,
      end: best.end,
      records: best.records,
      evidence: best.evidence,
      confidence: best.confidence
    };
  }

  private findExplicitReferences(text: string): ExplicitReference[] {
    const results: ExplicitReference[] = [];
    const normalizedNames = [...SURAH_ALIASES.entries()]
      .sort((a, b) => b[0].length - a[0].length);

    for (const [normalizedName, surah] of normalizedNames) {
      // Use a normalized view only for identifying the surah name. The
      // following bounded local scan finds the original digits and offsets.
      const nameOccurrences = findAll(text, normalizedName);
      for (const nameStart of nameOccurrences) {
        const tail = text.slice(nameStart + normalizedName.length, nameStart + normalizedName.length + 24);
        const match = /^\s*[:：،,\-–]?\s*(\d{1,3})\b/u.exec(tail);
        if (!match) continue;
        const ayah = Number(match[1]);
        if (!Number.isInteger(ayah) || ayah < 1) continue;
        const start = nameStart;
        const end = nameStart + normalizedName.length + match[0].length;
        results.push({ start, end, surah, ayah, raw: text.slice(start, end) });
      }
    }

    // Numeric references such as (2:255) or [2/255].
    const numeric = /(?:\(|\[|﴿)?\s*(\d{1,3})\s*[:/،]\s*(\d{1,3})\s*(?:\)|\]|﴾)?/gu;
    for (const match of text.matchAll(numeric)) {
      const surah = Number(match[1]);
      const ayah = Number(match[2]);
      if (surah >= 1 && surah <= 114 && ayah >= 1) {
        const start = match.index ?? 0;
        results.push({ start, end: start + match[0].length, surah, ayah, raw: match[0] });
      }
    }
    return results;
  }

  private findNearbyQuote(
    text: string,
    referenceStart: number,
    referenceEnd: number
  ): { start: number; end: number } | undefined {
    const before = text.slice(Math.max(0, referenceStart - 300), referenceStart);
    const after = text.slice(referenceEnd, Math.min(text.length, referenceEnd + 100));
    const bracketEnd = before.lastIndexOf("﴾");
    const bracketStart = before.lastIndexOf("﴿");
    if (bracketStart >= 0 && bracketEnd < bracketStart) {
      const localStart = Math.max(0, referenceStart - 300) + bracketStart + 1;
      return { start: localStart, end: referenceStart };
    }

    const trimmed = before.trimEnd();
    const punctuation = Math.max(
      trimmed.lastIndexOf("."),
      trimmed.lastIndexOf("؛"),
      trimmed.lastIndexOf("؟"),
      trimmed.lastIndexOf("\n")
    );
    const start = Math.max(0, referenceStart - 300) + punctuation + 1;
    const trailing = /^\s*[.)،؛،]/u.exec(after);
    const end = referenceStart;
    if (end <= start) return undefined;
    return { start: trimStart(text, start, end), end: trailing ? end : trimEnd(text, start, end) };
  }

  private resolveOverlaps(candidates: Candidate[], text: string): AyahMatch[] {
    const valid = candidates.filter(c =>
      c.end > c.start && c.start >= 0 && c.end <= text.length
    );
    const clusters: Candidate[][] = [];

    // Group candidates describing the same source span. Distinct Qur'anic
    // identities in one span must remain visible as ambiguity.
    for (const candidate of valid) {
      const cluster = clusters.find(items =>
        items.some(item => spansOverlap(item, candidate))
      );
      if (cluster) cluster.push(candidate);
      else clusters.push([candidate]);
    }

    const resolved = clusters.map(cluster => {
      // Prefer the longest fully matched passage within an overlapping cluster.
      // This allows consecutive ayahs to be recognized as one quotation while
      // preserving ambiguity when equally long passages map to different identities.
      const longestSpan = Math.max(...cluster.map(item => item.end - item.start));
      const identityCandidates = cluster
        .filter(candidate => candidate.end - candidate.start === longestSpan)
        .map(candidate => ({
          ...candidate,
          identity: candidate.records.map(record => record.id).join("+")
        }));
      const resolution = resolveAyahIdentity(identityCandidates, 0.065);
      const winner = resolution?.winner ?? identityCandidates[0]!;
      const competing = resolution?.competing ?? [];
      const ambiguous = resolution?.ambiguous ?? false;
      const references = ambiguous
        ? uniqueReferences([winner, ...competing].flatMap(item => item.records))
        : winner.records.map(({ surah, ayah }) => ({ surah, ayah }));

      return {
        candidate: winner,
        references,
        ambiguous,
        confidence: resolution?.ranked[0]?.score ?? winner.confidence,
        evidence: ambiguous
          ? [...winner.evidence, {
              type: "context" as const,
              detail: "توجد آيات مرشحة أخرى متقاربة في درجة المطابقة؛ يلزم التحقق اليدوي"
            }]
          : winner.evidence
      };
    });

    // If separate matches overlap partially, prefer the longer verified
    // source span; don't merge unrelated neighbouring quotations.
    const ordered = resolved.sort((a, b) =>
      a.candidate.start - b.candidate.start ||
      (b.candidate.end - b.candidate.start) - (a.candidate.end - a.candidate.start)
    );
    const accepted: typeof ordered = [];
    for (const item of ordered) {
      const overlapIndex = accepted.findIndex(existing =>
        item.candidate.start < existing.candidate.end &&
        item.candidate.end > existing.candidate.start
      );
      if (overlapIndex < 0) {
        accepted.push(item);
        continue;
      }
      const existing = accepted[overlapIndex]!;
      const existingLength = existing.candidate.end - existing.candidate.start;
      const itemLength = item.candidate.end - item.candidate.start;
      if (itemLength > existingLength && !existing.ambiguous) accepted[overlapIndex] = item;
    }

    return accepted.map(item => ({
      sourceStart: item.candidate.start,
      sourceEnd: item.candidate.end,
      references: item.references,
      matchedText: text.slice(item.candidate.start, item.candidate.end),
      canonicalText: item.ambiguous
        ? ""
        : item.candidate.records.map(record => record.uthmani).join(" "),
      confidence: item.confidence,
      evidence: item.evidence,
      status: item.ambiguous ? "ambiguous" :
        item.candidate.status
    }));
  }
}

function spansOverlap(a: Candidate, b: Candidate): boolean {
  return a.start < b.end && a.end > b.start;
}

function uniqueReferences(records: readonly QuranAyahRecord[]): AyahReference[] {
  const seen = new Set<string>();
  const references: AyahReference[] = [];
  for (const record of records) {
    const key = `${record.surah}:${record.ayah}`;
    if (!seen.has(key)) {
      seen.add(key);
      references.push({ surah: record.surah, ayah: record.ayah });
    }
  }
  return references;
}

function findBoundaryAware(
  haystack: string,
  needle: string
): { start: number; end: number; exact: boolean } | undefined {
  return findBoundaryAwareFrom(haystack, needle, 0);
}

function findBoundaryAwareFrom(
  haystack: string,
  needle: string,
  fromIndex: number
): { start: number; end: number; exact: boolean } | undefined {
  if (!needle) return undefined;
  let index = haystack.indexOf(needle, fromIndex);
  while (index >= 0) {
    const before = index === 0 ? "" : haystack[index - 1]!;
    const after = index + needle.length >= haystack.length ? "" : haystack[index + needle.length]!;
    if (!isArabicLetterOrDigit(before) && !isArabicLetterOrDigit(after)) {
      return { start: index, end: index + needle.length, exact: true };
    }
    index = haystack.indexOf(needle, index + 1);
  }
  return undefined;
}

function isArabicLetterOrDigit(value: string): boolean {
  return /[\p{L}\p{N}]/u.test(value);
}

function findAll(text: string, needle: string): number[] {
  const normalized = normalizeArabicWithMap(text);
  const positions: number[] = [];
  let cursor = 0;
  while (cursor <= normalized.value.length - needle.length) {
    const found = normalized.value.indexOf(needle, cursor);
    if (found < 0) break;
    const mapped = mapNormalizedRange(normalized, found, found + needle.length);
    if (mapped) positions.push(mapped.start);
    cursor = found + 1;
  }
  return positions;
}

function findCanonicalBefore(
  text: string,
  referenceStart: number,
  canonicalText: string
): { start: number; end: number } | undefined {
  const windowStart = Math.max(0, referenceStart - 500);
  const source = text.slice(windowStart, referenceStart);
  const normalized = normalizeArabicWithMap(source);
  const canonical = normalizeArabicWithMap(canonicalText).value;
  const found = findBoundaryAware(normalized.value, canonical);
  if (!found) return undefined;
  const mapped = mapNormalizedRange(normalized, found.start, found.end);
  return mapped ? { start: windowStart + mapped.start, end: windowStart + mapped.end } : undefined;
}

function containmentRatio(query: string, canonical: string): number {
  if (!query || !canonical) return 0;
  if (canonical.includes(query) || query.includes(canonical)) {
    return Math.min(query.length, canonical.length) / Math.max(query.length, canonical.length);
  }
  return 0;
}

function trimStart(text: string, start: number, end: number): number {
  while (start < end && /\s/u.test(text[start]!)) start += 1;
  return start;
}

function trimEnd(text: string, start: number, end: number): number {
  while (end > start && /\s/u.test(text[end - 1]!)) end -= 1;
  return end;
}
