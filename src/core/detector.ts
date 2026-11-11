import type {
  AyahMatch,
  AyahReference,
  MatchEvidence,
  QuranAyahRecord,
  QuranIndex
} from "./types.js";
import { mapNormalizedRange, normalizeArabicWithMap } from "./normalizer.js";
import { alignmentTokensMatch, findFuzzyTokenAlignments, prepareFuzzySource, tokenizeArabic, tokenForms } from "./alignment.js";
import { resolveAyahIdentity } from "./identity-resolver.js";

export interface DetectorDiagnostics {
  detectCalls: number;
  bracketPassageCalls: number;
  bracketPassageMs: number;
  exactPassageMs: number;
  fuzzyPassageMs: number;
  fuzzyCandidateRecords: number;
  fuzzyAlignmentCalls: number;
  overlapResolutionMs: number;
}

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
  /** Exact canonical excerpt for a partial-ayah quotation. */
  replacementText?: string;
}

interface ExplicitReference {
  start: number;
  end: number;
  surah: number;
  ayah: number;
  ayahEnd: number;
  raw: string;
}

interface PassageMatch {
  start: number;
  end: number;
  records: QuranAyahRecord[];
  evidence: MatchEvidence[];
  confidence: number;
  replacementText?: string;
}

/**
 * Waqf signs are pause annotations, not part of the quoted word itself.
 * KFGQPC can place different pause signs after the same excerpt in adjacent
 * ayahs (for example ۚ versus ۗ). Excluding only these trailing annotations
 * keeps identical lexical excerpts identical without stripping harakat.
 */
function stripTrailingWaqfSigns(value: string): string {
  return value.replace(/[ۖ-ۜ]+$/u, "");
}

function normalizeReferenceDigits(value: string): string {
  return [...value].map(character => {
    const code = character.codePointAt(0)!;
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return character;
  }).join("");
}

/**
 * KFGQPC Uthmani records append the printed ayah number after the verse text.
 * It belongs in the final replacement text, but not in the lexical word stream
 * used to align the Uthmani words with the Imla'ei words.
 */
function tokenizeUthmaniAyah(record: QuranAyahRecord): ReturnType<typeof tokenizeArabic> {
  const tokens = tokenizeArabic(record.uthmani);
  const last = tokens[tokens.length - 1];
  if (!last || last.end !== record.uthmani.trimEnd().length) return tokens;

  const previous = tokens[tokens.length - 2];
  const separatorStart = previous?.end ?? 0;
  const separator = record.uthmani.slice(separatorStart, last.start);
  const terminalDigits = normalizeReferenceDigits(record.uthmani.slice(last.start, last.end));
  if (/^\s+$/u.test(separator) && terminalDigits === String(record.ayah)) {
    tokens.pop();
  }
  return tokens;
}

function matchesExplicitReferenceRange(
  records: readonly QuranAyahRecord[],
  reference: ExplicitReference
): boolean {
  const expectedCount = reference.ayahEnd - reference.ayah + 1;
  return expectedCount > 0 &&
    records.length === expectedCount &&
    records.every((record, index) =>
      record.surah === reference.surah &&
      record.ayah === reference.ayah + index
    );
}

function countTokenValues(values: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

const DEFAULTS: Required<DetectorOptions> = {
  minimumUnmarkedLength: 14,
  maximumAyahsPerMatch: 8,
  highConfidenceThreshold: 0.94
};

const BRACKET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // Keep detector boundaries identical to the legacy-bracket normalizer and
  // review workflow. A quotation must be recognized as one passage regardless
  // of which supported Qur'anic font glyph pair surrounds it.
  ["﴿", "﴾"],
  ["ﭽ", "ﭼ"],
  ["ﭿ", "ﭾ"],
  ["ﮁ", "ﮀ"],
  ["ﮃ", "ﮂ"],
  ["ﮅ", "ﮄ"],
  ["ﮇ", "ﮆ"],
  ["ﮉ", "ﮈ"],
  ["ﮋ", "ﮊ"],
  ["ﵡ", "ﵠ"],
  ["", ""]
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
  /** Immutable, ordered snapshot reused by every paragraph in one document scan. */
  private readonly records: readonly QuranAyahRecord[];
  /** Expensive canonical normalization/tokenization is performed once per record. */
  private readonly preparedRecords = new WeakMap<QuranAyahRecord, {
    imlaeiNormalized: string;
    imlaeiTokens: ReturnType<typeof tokenizeArabic>;
    imlaeiTokenCounts: ReadonlyMap<string, number>;
    uthmaniNormalized: ReturnType<typeof normalizeArabicWithMap>;
    uthmaniTokens: ReturnType<typeof tokenizeArabic>;
  }>();
  /** Inverted token index shared by every paragraph in this document scan. */
  private readonly recordsByToken = new Map<string, Set<QuranAyahRecord>>();
  private readonly recordPositions = new Map<QuranAyahRecord, number>();
  private readonly diagnostics: DetectorDiagnostics = {
    detectCalls: 0, bracketPassageCalls: 0, bracketPassageMs: 0,
    exactPassageMs: 0, fuzzyPassageMs: 0, fuzzyCandidateRecords: 0,
    fuzzyAlignmentCalls: 0, overlapResolutionMs: 0
  };

  getDiagnostics(): DetectorDiagnostics {
    return { ...this.diagnostics };
  }

  constructor(private readonly index: QuranIndex, options: DetectorOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.records = [...index.all()].sort(
      (a, b) => a.surah - b.surah || a.ayah - b.ayah
    );
    this.records.forEach((record, position) => {
      const imlaeiTokens = tokenizeArabic(record.imlaei);
      const prepared = {
        imlaeiNormalized: normalizeArabicWithMap(record.imlaei).value,
        imlaeiTokens,
        imlaeiTokenCounts: countTokenValues(imlaeiTokens.map(token => token.value)),
        uthmaniNormalized: normalizeArabicWithMap(record.uthmani),
        uthmaniTokens: tokenizeUthmaniAyah(record)
      };
      this.preparedRecords.set(record, prepared);
      this.recordPositions.set(record, position);
      for (const token of [...prepared.imlaeiTokens, ...prepared.uthmaniTokens]) {
        for (const value of tokenForms(token)) this.addTokenPosting(value, record);
      }
    });
  }

  private addTokenPosting(value: string, record: QuranAyahRecord): void {
    const variants = value.length > 2 && (value.startsWith("و") || value.startsWith("ف"))
      ? [value, value.slice(1)]
      : [value];
    for (const variant of variants) {
      const posting = this.recordsByToken.get(variant) ?? new Set<QuranAyahRecord>();
      posting.add(record);
      this.recordsByToken.set(variant, posting);
    }
  }

  private tokenPostings(value: string): Set<QuranAyahRecord> {
    const result = new Set(this.recordsByToken.get(value) ?? []);
    if (value.length > 2 && (value.startsWith("و") || value.startsWith("ف"))) {
      for (const record of this.recordsByToken.get(value.slice(1)) ?? []) result.add(record);
    }
    return result;
  }

  /** Return records containing every requested token, preserving Qur'an order. */
  private candidateRecordsForTokens(values: readonly string[]): QuranAyahRecord[] {
    const unique = [...new Set(values)];
    if (unique.length === 0) return [];
    const postings = unique.map(value => this.tokenPostings(value));
    if (postings.some(posting => posting.size === 0)) return [];
    const anchor = postings.reduce((smallest, posting) =>
      posting.size < smallest.size ? posting : smallest
    );
    return [...anchor]
      .filter(record => postings.every(posting => posting.has(record)))
      .sort((left, right) =>
        (this.recordPositions.get(left) ?? 0) - (this.recordPositions.get(right) ?? 0)
      );
  }

  /** Each source token may match any one of its exact orthographic forms. */
  private candidateRecordsForTokenGroups(groups: readonly (readonly string[])[]): QuranAyahRecord[] {
    if (groups.length === 0) return [];
    const postings = groups.map(group => {
      const union = new Set<QuranAyahRecord>();
      for (const value of group) {
        for (const record of this.tokenPostings(value)) union.add(record);
      }
      return union;
    });
    if (postings.some(posting => posting.size === 0)) return [];
    const anchor = postings.reduce((smallest, posting) =>
      posting.size < smallest.size ? posting : smallest
    );
    return [...anchor]
      .filter(record => postings.every(posting => posting.has(record)))
      .sort((left, right) =>
        (this.recordPositions.get(left) ?? 0) - (this.recordPositions.get(right) ?? 0)
      );
  }

  /** Return records sharing at least one token (including conjunction variants). */
  private candidateRecordsForAnyToken(values: readonly string[]): QuranAyahRecord[] {
    const found = new Set<QuranAyahRecord>();
    for (const value of new Set(values)) {
      for (const record of this.tokenPostings(value)) found.add(record);
    }
    return [...found].sort((left, right) =>
      (this.recordPositions.get(left) ?? 0) - (this.recordPositions.get(right) ?? 0)
    );
  }

  private prepared(record: QuranAyahRecord) {
    const cached = this.preparedRecords.get(record);
    if (cached) return cached;
    // Supports custom/dynamic QuranIndex implementations without weakening correctness.
    const imlaeiTokens = tokenizeArabic(record.imlaei);
    const prepared = {
      imlaeiNormalized: normalizeArabicWithMap(record.imlaei).value,
      imlaeiTokens,
      imlaeiTokenCounts: countTokenValues(imlaeiTokens.map(token => token.value)),
      uthmaniNormalized: normalizeArabicWithMap(record.uthmani),
      uthmaniTokens: tokenizeArabic(record.uthmani)
    };
    this.preparedRecords.set(record, prepared);
    return prepared;
  }

  detect(text: string): AyahMatch[] {
    if (!text.trim() || this.index.size === 0) return [];
    this.diagnostics.detectCalls += 1;

    const normalized = normalizeArabicWithMap(text);
    const records = this.records;
    const candidates: Candidate[] = [];

    // First: explicit verse references (e.g. البقرة: 255).
    const references = this.findExplicitReferences(text);
    for (const reference of references) {
      if (reference.ayahEnd !== reference.ayah) continue;
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
      const canonical = this.prepared(record).imlaeiNormalized;
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
        const endMarker = findMatchingBracketEnd(text, open, close, start);
        if (endMarker < 0) break;
        const contentStart = start + open.length;
        const contentEnd = endMarker;
        const rawContent = text.slice(contentStart, contentEnd);
        // Nested delimiters make the quotation's intended boundaries uncertain.
        // Do not salvage inner or partial matches from this structurally ambiguous
        // span; a later explicit correction can safely resolve it.
        if (containsBracketPair(rawContent)) {
          cursor = endMarker + close.length;
          continue;
        }
        // Inner Qur'anic delimiters are structural, not lexical content.
        // Mask them with spaces (same UTF-16 length) so a full quoted ayah
        // remains one continuous matching unit and source offsets stay stable.
        const content = maskBracketMarkers(rawContent);
        const passageReference = this.findAdjacentExplicitReference(
          text,
          start,
          endMarker + close.length,
          references
        );
        const bracketStartedAt = performance.now();
        const matches = this.matchBracketedPassage(content, records, passageReference);
        this.diagnostics.bracketPassageMs += performance.now() - bracketStartedAt;
        this.diagnostics.bracketPassageCalls += 1;
        for (const match of matches) {
          // When the matched quotation occupies the complete bracket content,
          // include the existing ornamental delimiters in the replacement range.
          // Word can then replace the pair and the excerpt together, avoiding
          // duplicated brackets while leaving surrounding prose untouched.
          // Ignore only harmless whitespace/diacritic padding around the matched
          // quotation. This lets Word replace the existing delimiters as well,
          // without swallowing unmatched Arabic words or punctuation.
          const coversBracketContent =
            isBracketPadding(content.slice(0, match.start)) &&
            isBracketPadding(content.slice(match.end));
          candidates.push({
            start: coversBracketContent ? start : contentStart + match.start,
            end: coversBracketContent ? endMarker + close.length : contentStart + match.end,
            records: match.records,
            ...(match.replacementText !== undefined ? { replacementText: match.replacementText } : {}),
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
      // A bracketed quotation is one atomic matching unit. Never let the
      // unmarked scanner salvage a shorter fuzzy window from inside it.
      if (isInsideBracketedQuotation(text, unmarked.start, unmarked.end)) continue;
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

    const overlapStartedAt = performance.now();
    const resolved = this.resolveOverlaps(candidates, text);
    this.diagnostics.overlapResolutionMs += performance.now() - overlapStartedAt;
    return resolved;
  }

  private matchAllPassages(
    source: string,
    records: readonly QuranAyahRecord[]
  ): Array<{ start: number; end: number; records: QuranAyahRecord[]; evidence: MatchEvidence[]; confidence: number }> {
    const normalized = normalizeArabicWithMap(source);
    const output: Array<{ start: number; end: number; records: QuranAyahRecord[]; evidence: MatchEvidence[]; confidence: number }> = [];

    const sourceTokenValues = tokenizeArabic(source).map(token => token.value);
    const possibleStarts = this.candidateRecordsForAnyToken(sourceTokenValues)
      .filter(record => {
        const first = this.prepared(record).imlaeiTokens[0]?.value ?? "";
        return sourceTokenValues.some(value =>
          value === first ||
          (value.length > 2 && value.slice(1) === first) ||
          (first.length > 2 && first.slice(1) === value)
        );
      });

    const exactStartedAt = performance.now();
    for (const startRecord of possibleStarts) {
      const i = this.recordPositions.get(startRecord) ?? records.indexOf(startRecord);
      if (i < 0) continue;
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
        phrase += (phrase ? " " : "") + this.prepared(current).imlaeiNormalized;
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

    this.diagnostics.exactPassageMs += performance.now() - exactStartedAt;
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
    const sourceTokenValues = preparedSource.tokens.flatMap(tokenForms);
    const candidateRecords = this.candidateRecordsForAnyToken(sourceTokenValues);
    const sourceTokenCounts = new Map<string, number>();
    for (const token of preparedSource.tokens) {
      for (const value of tokenForms(token)) {
        sourceTokenCounts.set(value, (sourceTokenCounts.get(value) ?? 0) + 1);
      }
    }

    this.diagnostics.fuzzyCandidateRecords += candidateRecords.length;
    const fuzzyStartedAt = performance.now();
    for (const record of candidateRecords) {
      const preparedRecord = this.prepared(record);
      const canonicalTokens = preparedRecord.imlaeiTokens;
      // Bracketed short fragments are handled by exact contiguous matching above.
      // Fuzzy alignment needs at least four words to avoid generic false positives.
      const minimumTokens = allowShort ? 4 : 5;
      if (canonicalTokens.length < minimumTokens) continue;

      const maxDistance = canonicalTokens.length >= 9 ? 2 : 1;

      // A Levenshtein alignment within maxDistance must contain at least
      // canonicalLength - maxDistance exact token pairs. The multiset overlap
      // with the whole source is an upper bound on those pairs, so candidates
      // below that bound cannot possibly pass alignment and can be discarded
      // without changing recall. Count duplicates on both sides: repeated
      // Arabic words must not be treated as unlimited matches.
      const requiredExactTokens = Math.max(
        minimumTokens - maxDistance,
        canonicalTokens.length - maxDistance
      );
      let possibleExactTokens = 0;
      for (const [token, required] of preparedRecord.imlaeiTokenCounts) {
        possibleExactTokens += Math.min(required, sourceTokenCounts.get(token) ?? 0);
      }
      if (possibleExactTokens < requiredExactTokens) continue;

      this.diagnostics.fuzzyAlignmentCalls += 1;
      const alignments = findFuzzyTokenAlignments(preparedSource, canonicalTokens, {
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

    this.diagnostics.fuzzyPassageMs += performance.now() - fuzzyStartedAt;
    return matches;
  }

  /**
   * Matches verse-sized segments inside one outer quotation, then folds
   * consecutive references into one passage. Original separators are retained.
   */
  private matchBracketedPassage(
    content: string,
    records: readonly QuranAyahRecord[],
    explicitReference?: ExplicitReference
  ): PassageMatch[] {
    const boundaries = [...content.matchAll(/(?:\s*(?:\\?\*|[،؛,:])\s*)+/gu)];
    if (!boundaries.length) {
      return this.selectPassageMatches(this.matchPassage(content, records, true), explicitReference);
    }

    const segments: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    for (const boundary of boundaries) {
      const start = boundary.index ?? cursor;
      if (start > cursor) segments.push({ start: cursor, end: start });
      cursor = start + boundary[0].length;
    }
    if (cursor < content.length) segments.push({ start: cursor, end: content.length });
    if (segments.length < 2) {
      return this.selectPassageMatches(this.matchPassage(content, records, true), explicitReference);
    }

    const referenceCoversSegments = explicitReference !== undefined &&
      explicitReference.ayahEnd - explicitReference.ayah + 1 === segments.length;
    const segmentOptions: Array<Array<{
      start: number; end: number; record: QuranAyahRecord;
      replacementText: string; confidence: number; evidence: MatchEvidence[];
    }>> = [];

    for (const segment of segments) {
      const raw = content.slice(segment.start, segment.end);
      const leading = raw.length - raw.trimStart().length;
      const text = raw.trim();
      if (!text) {
        return this.matchBracketedPassageByTokenSequence(content, records, explicitReference);
      }

      // Keep printed verse markers in the source while excluding them from
      // textual matching. A repeated short phrase can be disambiguated by
      // the consecutive ayah context supplied by the remaining segments.
      const trailingMarker = /(\s*[۝۞]\s*[٠-٩0-9]+)\s*$/u.exec(text);
      const searchableText = trailingMarker
        ? text.slice(0, trailingMarker.index).trimEnd()
        : text;
      if (!searchableText) {
        return this.matchBracketedPassageByTokenSequence(content, records, explicitReference);
      }

      const found = this.matchPassage(searchableText, records, true);
      const segmentIndex = segmentOptions.length;
      const compatible = referenceCoversSegments
        ? found.flatMap(item => item.records
            .filter(record =>
              record.surah === explicitReference.surah &&
              record.ayah === explicitReference.ayah + segmentIndex
            )
            .map(record => ({ ...item, records: [record] })))
        : found;
      if (compatible.length !== 1) {
        return this.matchBracketedPassageByTokenSequence(content, records, explicitReference);
      }

      const item = compatible[0]!;
      const options = item.records.map(record => ({
        start: segment.start + leading + item.start,
        end: segment.start + leading + item.end,
        record,
        replacementText: item.replacementText ?? record.uthmani,
        confidence: item.confidence,
        evidence: item.evidence
      }));
      if (options.length === 0) {
        return this.matchBracketedPassageByTokenSequence(content, records, explicitReference);
      }
      segmentOptions.push(options);
    }

    // Resolve repeated segments (notably the basmala) by requiring one
    // uninterrupted sequence of references across the entire bracketed text.
    const sequences = segmentOptions[0]!.filter(first =>
      segmentOptions.every((options, index) =>
        options.some(option =>
          option.record.surah === first.record.surah &&
          option.record.ayah === first.record.ayah + index
        )
      )
    );
    const referenceSequences = referenceCoversSegments
      ? sequences.filter(first =>
          first.record.surah === explicitReference.surah &&
          first.record.ayah === explicitReference.ayah
        )
      : sequences;

    // A matching adjacent citation may select one exact consecutive sequence.
    // Without that corroboration, repeated sequences remain unresolved.
    if (referenceSequences.length !== 1) {
      return this.matchBracketedPassageByTokenSequence(content, records, explicitReference);
    }
    const first = referenceSequences[0]!.record;
    const resolved = segmentOptions.map((options, index) =>
      options.find(option =>
        option.record.surah === first.surah &&
        option.record.ayah === first.ayah + index
      )!
    );

    let replacementText = content;
    for (const item of [...resolved].reverse()) {
      replacementText = replacementText.slice(0, item.start) +
        item.replacementText + replacementText.slice(item.end);
    }
    const resolvedRecords = resolved.map(item => item.record);
    const referenceSupportsMatch = explicitReference !== undefined &&
      matchesExplicitReferenceRange(resolvedRecords, explicitReference);
    return [{
      start: 0,
      end: content.length,
      records: resolvedRecords,
      replacementText,
      confidence: Math.min(...resolved.map(item => item.confidence)),
      evidence: resolved.flatMap(item => item.evidence).concat([{
        type: "context",
        detail: "مقطع واحد يضم آيات متتابعة؛ حُفظت فواصل الآيات الأصلية"
      }], referenceSupportsMatch ? [{
        type: "explicit-reference",
        detail: explicitReference.raw
      }] : [])
    }];
  }

  /**
   * Exact token-stream fallback for a bracketed passage whose separators do
   * not divide it into independently identifiable ayahs. It extends excerpt
   * matching across consecutive ayah boundaries while keeping every Arabic
   * token exact; only presentation/spacing normalization (including يا آدم /
   * ياآدم) is shared with the regular excerpt matcher.
   */
  private matchBracketedPassageByTokenSequence(
    content: string,
    records: readonly QuranAyahRecord[],
    explicitReference?: ExplicitReference
  ): PassageMatch[] {
    const sourceTokens = tokenizeArabic(content);
    if (sourceTokens.length === 0) return [];
    const sourceValues = sourceTokens.map(token => token.value);
    const possibleStarts = this.candidateRecordsForAnyToken(tokenForms(sourceTokens[0]!));
    const found = new Map<string, PassageMatch>();

    for (const startRecord of possibleStarts) {
      const startIndex = this.recordPositions.get(startRecord) ?? records.indexOf(startRecord);
      if (startIndex < 0) continue;

      const flattened: Array<{
        record: QuranAyahRecord;
        imlaei: ReturnType<typeof tokenizeArabic>[number];
        uthmani: ReturnType<typeof tokenizeArabic>[number];
      }> = [];
      const group: QuranAyahRecord[] = [];

      for (
        let recordIndex = startIndex;
        recordIndex < records.length && group.length < this.options.maximumAyahsPerMatch;
        recordIndex += 1
      ) {
        const record = records[recordIndex];
        if (!record) break;
        if (group.length > 0) {
          const previous = group[group.length - 1]!;
          if (record.surah !== previous.surah || record.ayah !== previous.ayah + 1) break;
        }

        const prepared = this.prepared(record);
        if (prepared.imlaeiTokens.length !== prepared.uthmaniTokens.length) break;
        group.push(record);
        prepared.imlaeiTokens.forEach((token, tokenIndex) => {
          const uthmani = prepared.uthmaniTokens[tokenIndex];
          if (uthmani) flattened.push({ record, imlaei: token, uthmani });
        });

        // A source passage may begin within its first ayah, but it must match
        // one uninterrupted token run through the final source word.
        const firstRecordTokenCount = this.prepared(startRecord).imlaeiTokens.length;
        for (let offset = 0; offset < firstRecordTokenCount; offset += 1) {
          if (offset + sourceValues.length > flattened.length) continue;
          const window = flattened.slice(offset, offset + sourceValues.length);
          if (!sourceTokens.every((token, index) => {
            const canonical = window[index]?.imlaei;
            return canonical ? alignmentTokensMatch(token, canonical) : false;
          })) continue;

          const touchedRecords = [...new Map(
            window.map(item => [item.record.id, item.record])
          ).values()];
          if (touchedRecords.length === 0) continue;
          const identity = touchedRecords.map(record => record.id).join("+");
          const key = `${identity}@${offset}`;

          let replacementText = content;
          for (let tokenIndex = sourceTokens.length - 1; tokenIndex >= 0; tokenIndex -= 1) {
            const sourceToken = sourceTokens[tokenIndex]!;
            const canonicalToken = window[tokenIndex]!.uthmani;
            const canonicalRecord = window[tokenIndex]!.record;
            replacementText = replacementText.slice(0, sourceToken.start) +
              stripTrailingWaqfSigns(canonicalRecord.uthmani.slice(canonicalToken.start, canonicalToken.end)) +
              replacementText.slice(sourceToken.end);
          }

          found.set(key, {
            start: 0,
            end: content.length,
            records: touchedRecords,
            replacementText,
            confidence: 0.995,
            evidence: [{
              type: "exact-text",
              detail: "تطابق حرفي متصل لمقتطف ممتد عبر آيات متتابعة"
            }, {
              type: "context",
              detail: "طُبّقت مطابقة المقتطف على تدفق آيات متتابعة مع حفظ الفواصل الأصلية"
            }]
          });
        }
      }
    }

    // A cited range may resolve repeated text only when every verse in the
    // candidate sequence agrees with the cited surah and full ayah range.
    const candidates = [...found.values()];
    if (explicitReference) {
      const referenced = candidates.filter(match =>
        matchesExplicitReferenceRange(match.records, explicitReference)
      );
      if (referenced.length === 1) {
        const selected = referenced[0]!;
        return [{
          ...selected,
          evidence: [...selected.evidence, {
            type: "explicit-reference",
            detail: explicitReference.raw
          }]
        }];
      }
      // A unique textual location remains usable on its own; a conflicting
      // citation is never allowed to redirect it to another Qur'anic location.
      return candidates.length === 1 ? candidates : [];
    }

    // Repeated Qur'anic passages or multiple placements remain unresolved.
    return candidates.length === 1 ? candidates : [];
  }

  private selectPassageMatches(
    matches: PassageMatch[],
    explicitReference?: ExplicitReference
  ): PassageMatch[] {
    if (!explicitReference) return matches;
    const referenced = matches.filter(match =>
      matchesExplicitReferenceRange(match.records, explicitReference)
    );
    if (referenced.length === 1) {
      const selected = referenced[0]!;
      return [{
        ...selected,
        evidence: [...selected.evidence, {
          type: "explicit-reference",
          detail: explicitReference.raw
        }]
      }];
    }
    return matches.length === 1 ? matches : [];
  }

  private matchPassage(
    source: string,
    records: readonly QuranAyahRecord[],
    allowShort: boolean
  ): PassageMatch[] {
    const sourceNormalized = normalizeArabicWithMap(source);
    const normalizedText = sourceNormalized.value;
    if (!normalizedText) return [];

    // Marked quotations may be short excerpts, including the first words of
    // an ayah or a single distinctive word. Exact matches are collected across
    // the full index so repeated phrases can be surfaced as ambiguous.
    if (allowShort) {
      const sourceTokens = tokenizeArabic(source);
      if (sourceTokens.length >= 1) {
        const sourceValues = sourceTokens.map(token => token.value);
        const sourceForms = sourceTokens.flatMap(tokenForms);
        const fragmentMatches: Array<{
          record: QuranAyahRecord;
          start: number;
          end: number;
          replacementText: string;
        }> = [];

        const exactCandidates = this.candidateRecordsForTokenGroups(sourceTokens.map(tokenForms));
        for (const record of exactCandidates) {
          const preparedRecord = this.prepared(record);
          const imlaeiTokens = preparedRecord.imlaeiTokens;
          // A short phrase may be an excerpt from a longer ayah, but a
          // quotation longer than this candidate cannot be attributed to it.
          if (sourceValues.length > imlaeiTokens.length) continue;
          const uthmaniTokens = preparedRecord.uthmaniTokens;

          // Search the normalized Uthmani string as a whole before token
          // alignment. This preserves exact word boundaries and handles cases
          // where the imported imlaei tokenization differs from the source.
          const uthmaniNormalized = preparedRecord.uthmaniNormalized;
          const exactUthmani = findBoundaryAwareWithConjunctionPrefix(
            uthmaniNormalized.value,
            sourceValues.join(" ")
          );
          if (exactUthmani) {
            const finalToken = sourceValues[sourceValues.length - 1] ?? "";
            const weakOpening =
              exactUthmani.start === 0 &&
              sourceValues.length <= 3 &&
              !(
                (sourceValues.length === 1 && finalToken.length >= 5) ||
                (sourceValues.length === 3 && finalToken.length >= 4)
              );
            if (!weakOpening) {
              const mapped = mapNormalizedRange(
                uthmaniNormalized,
                exactUthmani.start,
                exactUthmani.end
              );
              if (mapped) {
                fragmentMatches.push({
                  record,
                  start: sourceTokens[0]!.start,
                  end: sourceTokens[sourceTokens.length - 1]!.end,
                  replacementText: stripTrailingWaqfSigns(record.uthmani.slice(mapped.start, mapped.end))
                });
                continue;
              }
            }
          }

          // The Uthmani text is also searched directly. Some imported imlaei
          // strings omit a conjunction or use a spelling that differs from
          // the quotation, while the source Uthmani words remain exact.
          const canonicalVariants = [imlaeiTokens, uthmaniTokens];
          let matchedOffset: number | undefined;

          for (const variant of canonicalVariants) {
            const canonicalValues = variant;
            for (let offset = 0; offset <= canonicalValues.length - sourceTokens.length; offset += 1) {
              // At the beginning of an ayah, very short generic openings are
              // not identifying evidence. Permit a single distinctive word
              // (e.g. "فأنشأنا") or a three-word opening ending in a distinctive
              // token (e.g. "وما يستوي البحران"), but not "الله لا إله".
              if (offset === 0 && sourceValues.length <= 3) {
                const finalToken = sourceValues[sourceValues.length - 1] ?? "";
                const distinctiveOpening =
                  (sourceValues.length === 1 && finalToken.length >= 5) ||
                  (sourceValues.length === 3 && finalToken.length >= 4);
                if (!distinctiveOpening) continue;
              }
              if (!sourceTokens.every((token, index) => alignmentTokensMatch(token, canonicalValues[offset + index]!))) continue;
              matchedOffset = offset;
              break;
            }
            if (matchedOffset !== undefined) break;
          }

          if (matchedOffset === undefined) continue;
          const uthmaniSlice = uthmaniTokens.slice(
            matchedOffset,
            matchedOffset + sourceValues.length
          );
          if (uthmaniSlice.length !== sourceValues.length) continue;
          fragmentMatches.push({
            record,
            start: sourceTokens[0]!.start,
            end: sourceTokens[sourceTokens.length - 1]!.end,
            replacementText: stripTrailingWaqfSigns(record.uthmani.slice(
              uthmaniSlice[0]!.start,
              uthmaniSlice[uthmaniSlice.length - 1]!.end
            ))
          });
        }

        if (fragmentMatches.length > 0) {
          // A single isolated word is useful only when it identifies exactly
          // one ayah. Common words should not flood the review panel.
          if (sourceValues.length === 1 && fragmentMatches.length !== 1) return [];

          const uniqueRecords = [...new Map(
            fragmentMatches.map(found => [found.record.id, found.record])
          ).values()];
          const first = fragmentMatches[0]!;
          // Repeated locations are safe to approve only when every location
          // yields exactly the same Uthmani excerpt. Otherwise the actual
          // spelling differs and the result must remain ambiguous for review.
          const sameUthmaniExcerpt = fragmentMatches.every(
            found => found.replacementText === first.replacementText
          );
          const repeatedExactExcerpt = uniqueRecords.length > 1 && sameUthmaniExcerpt;
          const evidence: MatchEvidence[] = [{
            type: "exact-text",
            detail: repeatedExactExcerpt
              ? "مقتطف مكرر بالرسم العثماني نفسه في مواضع قرآنية متعددة"
              : uniqueRecords.length > 1
                ? "مقطع قرآني وارد في أكثر من موضع بصيغ عثمانية مختلفة؛ يلزم التحقق"
                : "مقطع متصل مطابق لألفاظ آية قرآنية داخل الأقواس"
          }];

          // Keep every verified reference. A repeated identical excerpt has
          // one shared replacement text; differing Uthmani forms stay textless
          // and therefore cannot be approved automatically.
          return [{
            start: first.start,
            end: first.end,
            records: uniqueRecords,
            ...(sameUthmaniExcerpt
              ? { replacementText: first.replacementText }
              : {}),
            evidence,
            confidence: 0.99
          }];
        }

        // A bracketed excerpt may contain one omitted, inserted, or differently
        // written word. Four-token excerpts are sufficiently constrained for
        // a single-edit suggestion, but are always held for human review.
        if (sourceValues.length >= 4) {
          const fuzzyByRecord = new Map<string, {
            record: QuranAyahRecord;
            sourceStart: number;
            sourceEnd: number;
            replacementText: string;
          }>();

          const fuzzyCandidates = this.candidateRecordsForAnyToken(sourceForms);
          for (const record of fuzzyCandidates) {
            const preparedRecord = this.prepared(record);
            const canonicalTokens = preparedRecord.imlaeiTokens;
            const canonicalValues = canonicalTokens.map(token => token.value);
            const uthmaniTokens = preparedRecord.uthmaniTokens;
            if (uthmaniTokens.length !== canonicalTokens.length) continue;

            const shortestWindow = Math.max(4, sourceValues.length - 1);
            const longestWindow = sourceValues.length + 1;
            for (let length = shortestWindow; length <= longestWindow; length += 1) {
              for (let offset = 0; offset + length <= canonicalValues.length; offset += 1) {
                const window = canonicalValues.slice(offset, offset + length);
                if (tokenEditDistance(sourceValues, window, 1) !== 1) continue;

                const canonicalSlice = uthmaniTokens.slice(offset, offset + length);
                const first = canonicalSlice[0];
                const last = canonicalSlice[canonicalSlice.length - 1];
                if (!first || !last) continue;
                if (!fuzzyByRecord.has(record.id)) {
                  fuzzyByRecord.set(record.id, {
                    record,
                    sourceStart: sourceTokens[0]!.start,
                    sourceEnd: sourceTokens[sourceTokens.length - 1]!.end,
                    replacementText: stripTrailingWaqfSigns(record.uthmani.slice(first.start, last.end))
                  });
                }
              }
            }
          }

          if (fuzzyByRecord.size > 0) {
            return [...fuzzyByRecord.values()].map(found => ({
              start: found.sourceStart,
              end: found.sourceEnd,
              records: [found.record],
              replacementText: found.replacementText,
              evidence: [{
                type: "fuzzy-alignment",
                detail: "مقتطف متصل قريب من نص آية؛ اختلاف كلمة واحدة ويحتاج إلى مراجعة"
              }],
              confidence: 0.89
            }));
          }
        }
      }
    }

    // A bracketed quotation is matched as a whole passage. Do not search
    // for a shorter canonical ayah *inside* a longer quotation: that was the
    // route that allowed an inner phrase to be stolen by another surah.
    // Exact excerpts (source inside ayah) and bounded fuzzy excerpts have
    // already been considered above. Preserve exact multi-ayah quotations by
    // accepting only equality with a contiguous sequence of complete ayahs.
    if (allowShort) {
      const sourceValue = normalizedText.trim();
      const sourceTokens = tokenizeArabic(source).map(token => token.value);
      const starts = sourceTokens.length
        ? this.candidateRecordsForAnyToken(sourceTokens)
        : [];
      for (const startRecord of starts) {
        const index = this.recordPositions.get(startRecord) ?? records.indexOf(startRecord);
        if (index < 0) continue;
        const group: QuranAyahRecord[] = [];
        let combined = "";
        for (let j = index; j < records.length && group.length < this.options.maximumAyahsPerMatch; j += 1) {
          const current = records[j];
          if (!current) break;
          if (group.length > 0) {
            const previous = group[group.length - 1]!;
            if (current.surah !== previous.surah || current.ayah !== previous.ayah + 1) break;
          }
          group.push(current);
          combined += (combined ? " " : "") + this.prepared(current).imlaeiNormalized;
          if (combined === sourceValue) {
            return [{
              start: 0,
              end: source.length,
              records: [...group],
              evidence: [{ type: "exact-text", detail: "تطابق كامل لمجموعة آيات متتابعة" }],
              confidence: 0.995
            }];
          }
        }
      }
      return [];
    }

    let best: {
      start: number;
      end: number;
      records: QuranAyahRecord[];
      evidence: MatchEvidence[];
      confidence: number;
      length: number;
    } | undefined;

    const firstSourceToken = tokenizeArabic(source)[0]?.value;
    const possibleStarts = firstSourceToken
      ? this.candidateRecordsForTokens([firstSourceToken])
      : [];
    for (const first of possibleStarts) {
      const i = this.recordPositions.get(first) ?? records.indexOf(first);
      if (i < 0) continue;

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
        combined += (combined ? " " : "") + this.prepared(current).imlaeiNormalized;
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
      return fuzzy ? [fuzzy] : [];
    }
    return [{
      start: best.start,
      end: best.end,
      records: best.records,
      evidence: best.evidence,
      confidence: best.confidence
    }];
  }

  private findExplicitReferences(text: string): ExplicitReference[] {
    const results = new Map<string, ExplicitReference>();
    const normalizedText = normalizeArabicWithMap(text);
    const digit = "[0-9٠-٩۰-۹]";
    const namedReferencePattern = new RegExp(
      "^\\s*(?:[:：،,]\\s*)?(?:(?:ال)?آي(?:ة|ات)\\s*)?[:：،,]?\\s*(" +
        digit + "{1,3})(?:\\s*[-‐‑‒–—−]\\s*(" + digit + "{1,3}))?(?!" + digit + ")",
      "u"
    );

    for (const [normalizedName, surah] of SURAH_ALIASES.entries()) {
      for (const mappedName of findAllMappedRanges(text, normalizedName)) {
        // Read after the original surah-name span, not after its normalized
        // length, because diacritics and orthographic forms change UTF-16 offsets.
        const tail = text.slice(mappedName.end, mappedName.end + 64);
        const match = namedReferencePattern.exec(tail);
        if (!match) continue;

        const ayah = Number(normalizeReferenceDigits(match[1]!));
        const ayahEnd = match[2]
          ? Number(normalizeReferenceDigits(match[2]))
          : ayah;
        if (!Number.isInteger(ayah) || !Number.isInteger(ayahEnd) ||
            ayah < 1 || ayahEnd < ayah) continue;

        const end = mappedName.end + match[0].length;
        const reference: ExplicitReference = {
          start: mappedName.start,
          end,
          surah,
          ayah,
          ayahEnd,
          raw: text.slice(mappedName.start, end)
        };
        results.set(reference.start + ":" + reference.end + ":" + surah + ":" + ayah + ":" + ayahEnd, reference);
      }
    }

    // Numeric references such as (2:255), [2/255], and [23:5-7].
    const numeric = new RegExp(
      "(?:\\(|\\[|﴿)?\\s*(" + digit + "{1,3})\\s*[:/،]\\s*(" + digit +
        "{1,3})(?:\\s*[-‐‑‒–—−]\\s*(" + digit + "{1,3}))?\\s*(?:\\)|\\]|﴾)?",
      "gu"
    );
    for (const match of text.matchAll(numeric)) {
      const surah = Number(normalizeReferenceDigits(match[1]!));
      const ayah = Number(normalizeReferenceDigits(match[2]!));
      const ayahEnd = match[3]
        ? Number(normalizeReferenceDigits(match[3]))
        : ayah;
      if (surah < 1 || surah > 114 || ayah < 1 || ayahEnd < ayah) continue;
      const start = match.index ?? 0;
      const reference: ExplicitReference = {
        start,
        end: start + match[0].length,
        surah,
        ayah,
        ayahEnd,
        raw: match[0]
      };
      results.set(reference.start + ":" + reference.end + ":" + surah + ":" + ayah + ":" + ayahEnd, reference);
    }

    return [...results.values()].sort((left, right) =>
      left.start - right.start || left.end - right.end
    );
  }

  /**
   * Word/HTML-pasted text can retain a numeric character reference for the
   * whitespace between a quotation and its citation (for example, &#x20;).
   * Treat only entities that decode to actual whitespace as spacing. Other
   * entities remain lexical content and therefore cannot establish adjacency.
   */
  private isCitationAdjacencyGap(value: string): boolean {
    const decodedWhitespace = value
      .replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));/giu, (entity, hex: string | undefined, decimal: string | undefined) => {
        const codePoint = hex ? Number.parseInt(hex, 16) : Number(decimal);
        if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
          return entity;
        }
        return /\s/u.test(String.fromCodePoint(codePoint)) ? " " : entity;
      })
      .replace(/&nbsp;/giu, " ");
    return value.length <= 40 && !/[\p{L}\p{N}]/u.test(decodedWhitespace);
  }

  private findAdjacentExplicitReference(
    text: string,
    bracketStart: number,
    bracketEnd: number,
    references: readonly ExplicitReference[]
  ): ExplicitReference | undefined {
    const adjacent = references.filter(reference => {
      if (reference.start >= bracketEnd) {
        return this.isCitationAdjacencyGap(text.slice(bracketEnd, reference.start));
      }
      if (reference.end <= bracketStart) {
        return this.isCitationAdjacencyGap(text.slice(reference.end, bracketStart));
      }
      return false;
    });
    return adjacent.length === 1 ? adjacent[0] : undefined;
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
      const selectedWinner = resolution?.winner ?? identityCandidates[0]!;
      // Identity resolution may select an equivalent candidate produced by a
      // secondary detector pass. Prefer the same identity's enriched bracket
      // candidate when it carries the passage-level replacement that preserves
      // the original verse markers and separators.
      const winner = selectedWinner.replacementText !== undefined
        ? selectedWinner
        : identityCandidates.find(candidate =>
            candidate.identity === selectedWinner.identity &&
            candidate.replacementText !== undefined
          ) ?? selectedWinner;
      const competing = resolution?.competing ?? [];
      const repeatedExactExcerpt =
        winner.records.length > 1 &&
        winner.replacementText !== undefined &&
        winner.evidence.some(item =>
          item.type === "exact-text" &&
          item.detail.includes("مكرر بالرسم العثماني نفسه")
        );
      // Multiple records are expected for a verified consecutive passage;
      // they do not make that passage ambiguous. Ambiguity is about competing
      // identities for the same source span, not the number of ayahs in one
      // already-resolved sequence.
      const isVerifiedConsecutivePassage = winner.records.length > 1 &&
        winner.records.every((record, index, records) => {
          if (index === 0) return true;
          const previous = records[index - 1]!;
          return record.surah === previous.surah &&
            record.ayah === previous.ayah + 1;
        });
      // A single detector candidate can itself contain several possible
      // locations for a short excerpt. The identity resolver cannot detect
      // that ambiguity because it sees only one candidate object. Preserve it
      // unless those records form one verified consecutive passage or the
      // excerpt is textually identical at every repeated location.
      const ambiguous = !repeatedExactExcerpt && (
        (resolution?.ambiguous ?? false) ||
        (winner.records.length > 1 && !isVerifiedConsecutivePassage)
      );
      const references = ambiguous || repeatedExactExcerpt
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
              detail: "توجد آيات مرشحة أخرى بصيغ عثمانية مختلفة؛ يلزم التحقق اليدوي"
            }]
          : repeatedExactExcerpt
            ? [...winner.evidence, {
                type: "context" as const,
                detail: "المقتطف مكرر في المواضع المذكورة، والرسم العثماني متطابق؛ يمكن اعتماد النص المشترك"
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

    return accepted.map(item => {
      const matchedText = text.slice(item.candidate.start, item.candidate.end);
      const canonicalText = item.ambiguous
        ? ""
        : item.candidate.records.map(record => record.uthmani).join(" ");
      const replacementText = item.candidate.replacementText;

      return {
        sourceStart: item.candidate.start,
        sourceEnd: item.candidate.end,
        references: item.references,
        matchedText,
        canonicalText,
        ...(replacementText !== undefined && !item.ambiguous ? { replacementText } : {}),
        confidence: item.confidence,
        evidence: item.evidence,
        status: item.ambiguous ? "ambiguous" :
          item.candidate.status
      };
    });
  }
}

function tokenEditDistance(
  left: readonly string[],
  right: readonly string[],
  maximumDistance: number
): number {
  if (Math.abs(left.length - right.length) > maximumDistance) {
    return maximumDistance + 1;
  }

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = Array<number>(right.length + 1).fill(maximumDistance + 1);
    current[0] = row;
    let rowMinimum = current[0]!;
    for (let column = 1; column <= right.length; column += 1) {
      // At word level, allow only a one-character insertion/deletion inside
      // a token (e.g. a dropped final alif), never a character substitution.
      const sameOrOneCharacterInsertionDeletion =
        left[row - 1] === right[column - 1] ||
        differsByOneInsertedCharacter(left[row - 1]!, right[column - 1]!);
      const substitution = previous[column - 1]! +
        (sameOrOneCharacterInsertionDeletion ? (left[row - 1] === right[column - 1] ? 0 : 1) : maximumDistance + 1);
      current[column] = Math.min(
        previous[column]! + 1,
        current[column - 1]! + 1,
        substitution
      );
      rowMinimum = Math.min(rowMinimum, current[column]!);
    }
    if (rowMinimum > maximumDistance) return maximumDistance + 1;
    previous = current;
  }
  return previous[right.length]!;
}

function differsByOneInsertedCharacter(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) !== 1) return false;
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  let shortIndex = 0;
  let longIndex = 0;
  let skipped = false;
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1;
      longIndex += 1;
    } else if (skipped) {
      return false;
    } else {
      skipped = true;
      longIndex += 1;
    }
  }
  return true;
}

function findMatchingBracketEnd(text: string, open: string, close: string, start: number): number {
  let depth = 1;
  let cursor = start + open.length;
  while (cursor < text.length) {
    const nextOpen = text.indexOf(open, cursor);
    const nextClose = text.indexOf(close, cursor);
    if (nextClose < 0) return -1;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + open.length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return nextClose;
    cursor = nextClose + close.length;
  }
  return -1;
}

function containsBracketPair(content: string): boolean {
  return BRACKET_PAIRS.some(([open]) => content.includes(open));
}

function maskBracketMarkers(content: string): string {
  const markers = new Set(BRACKET_PAIRS.flatMap(([open, close]) => [open, close]));
  return [...content].map(character => markers.has(character) ? " " : character).join("");
}

function isInsideBracketedQuotation(text: string, start: number, end: number): boolean {
  for (const [open, close] of BRACKET_PAIRS) {
    let cursor = 0;
    while (cursor < text.length) {
      const opening = text.indexOf(open, cursor);
      if (opening < 0) break;
      const closing = findMatchingBracketEnd(text, open, close, opening);
      if (closing < 0) break;
      const contentStart = opening + open.length;
      if (start >= contentStart && end <= closing) return true;
      cursor = closing + close.length;
    }
  }
  return false;
}

function isBracketPadding(value: string): boolean {
  return /^[\s\u0640\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]*$/u.test(value);
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

function findBoundaryAwareWithConjunctionPrefix(
  haystack: string,
  needle: string
): { start: number; end: number; exact: boolean } | undefined {
  if (!needle) return undefined;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    const before = index === 0 ? "" : haystack[index - 1]!;
    const after = index + needle.length >= haystack.length ? "" : haystack[index + needle.length]!;
    const ordinaryBoundary = !isArabicLetterOrDigit(before);
    const attachedConjunction =
      (before === "و" || before === "ف") &&
      (index === 1 || !isArabicLetterOrDigit(haystack[index - 2]!));

    if ((ordinaryBoundary || attachedConjunction) && !isArabicLetterOrDigit(after)) {
      // Start at the quoted word, not at its attached conjunction. This keeps
      // replacement limited to the words actually present in the document.
      return { start: index, end: index + needle.length, exact: true };
    }
    index = haystack.indexOf(needle, index + 1);
  }
  return undefined;
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

function findAllMappedRanges(text: string, needle: string): Array<{ start: number; end: number }> {
  const normalized = normalizeArabicWithMap(text);
  const ranges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  while (cursor <= normalized.value.length - needle.length) {
    const found = normalized.value.indexOf(needle, cursor);
    if (found < 0) break;
    const mapped = mapNormalizedRange(normalized, found, found + needle.length);
    if (mapped) ranges.push(mapped);
    cursor = found + 1;
  }
  return ranges;
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
