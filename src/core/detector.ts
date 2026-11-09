import type {
  AyahMatch,
  AyahReference,
  MatchEvidence,
  QuranAyahRecord,
  QuranIndex
} from "./types.js";
import { mapNormalizedRange, normalizeArabicWithMap } from "./normalizer.js";
import { findFuzzyTokenAlignments, prepareFuzzySource, tokenizeArabic } from "./alignment.js";
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
  /** Exact canonical excerpt for a partial-ayah quotation. */
  replacementText?: string;
}

interface ExplicitReference {
  start: number;
  end: number;
  surah: number;
  ayah: number;
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
        const matches = this.matchBracketedPassage(content, records);
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
      // Bracketed short fragments are handled by exact contiguous matching above.
      // Fuzzy alignment needs at least four words to avoid generic false positives.
      const minimumTokens = allowShort ? 4 : 5;
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

  /**
   * Matches verse-sized segments inside one outer quotation, then folds
   * consecutive references into one passage. Original separators are retained.
   */
  private matchBracketedPassage(
    content: string,
    records: readonly QuranAyahRecord[]
  ): PassageMatch[] {
    const boundaries = [...content.matchAll(/(?:\s*(?:\*|[،؛,:])\s*)+/gu)];
    if (!boundaries.length) return this.matchPassage(content, records, true);

    const segments: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    for (const boundary of boundaries) {
      const start = boundary.index ?? cursor;
      if (start > cursor) segments.push({ start: cursor, end: start });
      cursor = start + boundary[0].length;
    }
    if (cursor < content.length) segments.push({ start: cursor, end: content.length });
    if (segments.length < 2) return this.matchPassage(content, records, true);

    const resolved: Array<{
      start: number; end: number; record: QuranAyahRecord;
      replacementText: string; confidence: number; evidence: MatchEvidence[];
    }> = [];
    for (const segment of segments) {
      const raw = content.slice(segment.start, segment.end);
      const leading = raw.length - raw.trimStart().length;
      const text = raw.trim();
      if (!text) return [];
      const found = this.matchPassage(text, records, true);
      if (found.length !== 1 || found[0]!.records.length !== 1) return [];
      const item = found[0]!;
      const record = item.records[0]!;
      resolved.push({
        start: segment.start + leading + item.start,
        end: segment.start + leading + item.end,
        record,
        replacementText: item.replacementText ?? record.uthmani,
        confidence: item.confidence,
        evidence: item.evidence
      });
    }

    const first = resolved[0]!.record;
    if (!resolved.every((item, index) =>
      item.record.surah === first.surah && item.record.ayah === first.ayah + index
    )) return [];

    let replacementText = content;
    for (const item of [...resolved].reverse()) {
      replacementText = replacementText.slice(0, item.start) +
        item.replacementText + replacementText.slice(item.end);
    }
    return [{
      start: 0,
      end: content.length,
      records: resolved.map(item => item.record),
      replacementText,
      confidence: Math.min(...resolved.map(item => item.confidence)),
      evidence: resolved.flatMap(item => item.evidence).concat([{
        type: "context",
        detail: "مقطع واحد يضم آيات متتابعة؛ حُفظت فواصل الآيات الأصلية"
      }])
    }];
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
        const fragmentMatches: Array<{
          record: QuranAyahRecord;
          start: number;
          end: number;
          replacementText: string;
        }> = [];

        for (const record of records) {
          const imlaeiTokens = tokenizeArabic(record.imlaei);
          const uthmaniTokens = tokenizeArabic(record.uthmani);

          // Search the normalized Uthmani string as a whole before token
          // alignment. This preserves exact word boundaries and handles cases
          // where the imported imlaei tokenization differs from the source.
          const uthmaniNormalized = normalizeArabicWithMap(record.uthmani);
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
                  replacementText: record.uthmani.slice(mapped.start, mapped.end)
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
            const canonicalValues = variant.map(token => token.value);
            for (let offset = 0; offset <= canonicalValues.length - sourceValues.length; offset += 1) {
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
              if (!sourceValues.every((value, index) => canonicalValues[offset + index] === value)) continue;
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
            replacementText: record.uthmani.slice(
              uthmaniSlice[0]!.start,
              uthmaniSlice[uthmaniSlice.length - 1]!.end
            )
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

          for (const record of records) {
            const canonicalTokens = tokenizeArabic(record.imlaei);
            const canonicalValues = canonicalTokens.map(token => token.value);
            const uthmaniTokens = tokenizeArabic(record.uthmani);
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
                    replacementText: record.uthmani.slice(first.start, last.end)
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
      const repeatedExactExcerpt =
        winner.records.length > 1 &&
        winner.replacementText !== undefined &&
        winner.evidence.some(item =>
          item.type === "exact-text" &&
          item.detail.includes("مكرر بالرسم العثماني نفسه")
        );
      const ambiguous = !repeatedExactExcerpt &&
        (winner.records.length > 1 || (resolution?.ambiguous ?? false));
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
      const substitution = previous[column - 1]! + (left[row - 1] === right[column - 1] ? 0 : 1);
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
