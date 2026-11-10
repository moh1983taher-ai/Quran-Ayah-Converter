import type { NormalizedText } from "./types.js";
import { mapNormalizedRange, normalizeArabic, normalizeArabicWithMap } from "./normalizer.js";

export interface AlignmentToken {
  value: string;
  start: number;
  end: number;
  /** Exact orthographic alternatives justified by marks in this source token. */
  alternatives?: readonly string[];
}

export interface TokenAlignment {
  distance: number;
  similarity: number;
  matchedTokens: number;
  sourceStart: number;
  sourceEnd: number;
  sourceTokenCount: number;
}

export interface PreparedFuzzySource {
  normalized: NormalizedText;
  tokens: AlignmentToken[];
  positions: ReadonlyMap<string, readonly number[]>;
}

/** Tokenize Arabic words while retaining offsets in the original text. */
export function tokenizeArabic(source: string): AlignmentToken[] {
  return tokenizeNormalized(normalizeArabicWithMap(source));
}

export function tokenizeNormalized(normalized: NormalizedText): AlignmentToken[] {
  const tokens: AlignmentToken[] = [];
  const expression = /[\p{Script=Arabic}]+/gu;

  for (const match of normalized.value.matchAll(expression)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const mapped = mapNormalizedRange(normalized, start, end);
    if (!mapped) continue;

    // Uthmani orthography may omit the alif after waw al-jama'ah
    // (e.g. source "فباؤوا" versus canonical "فباءو"). Treat that
    // final alif as a spelling convention at token level, not as a
    // character-level fuzzy substitution. Source offsets remain untouched.
    const sourceToken = normalized.sourceText.slice(mapped.start, mapped.end);
    // Keep the mark-stripped spelling as the primary token. A dagger alif
    // may represent an ordinary alif in some words, but not in all of them;
    // expose the expanded spelling as an exact alternative instead of
    // rewriting every occurrence (e.g. الرحمن and إلىٰ must remain unchanged).
    const tokenValue = match[0].replace(/ءوا$/u, "ءو");
    const daggerPositions = [...sourceToken.matchAll(/ٰ/gu)].map(item =>
      normalizeArabic(sourceToken.slice(0, item.index ?? 0)).length
    );
    const tokenAlternatives = [...new Set(daggerPositions.map(position =>
      tokenValue.slice(0, position) + "ا" + tokenValue.slice(position)
    ))].filter(value => value !== tokenValue);
    const previous = tokens[tokens.length - 1];
    if (
      previous?.value === "يا" &&
      /^\s*$/u.test(normalized.sourceText.slice(previous.end, mapped.start))
    ) {
      // Treat the vocative particle plus its following word as one matching
      // token: "يا آدم"/"ياآدم" and "يا أيها"/"ياأيها".
      // Normalize the common written variants "يا آدم"/"ياآدم"
      // and "يا أيها"/"ياأيها" to the same vocative token.
      previous.value += tokenValue.startsWith("ا") ? tokenValue.slice(1) : tokenValue;
      previous.end = mapped.end;
    } else {
      // In joined vocatives, alef normalization can leave a doubled alef
      // after "يا" (ياآدم -> ياادم). Collapse that one orthographic boundary
      // so it is identical to the already-supported spaced form (يا آدم).
      const value = tokenValue.replace(/^ياا(?=.)/u, "يا");
      const alternatives = tokenAlternatives
        .map(item => item.replace(/^ياا(?=.)/u, "يا"))
        .filter(item => item !== value);
      tokens.push({ value, start: mapped.start, end: mapped.end, alternatives });
    }
  }
  return tokens;
}


/** Exact forms supported by the token itself, without fuzzy letter edits. */
export function tokenForms(token: string | AlignmentToken): readonly string[] {
  return typeof token === "string"
    ? [token]
    : [token.value, ...(token.alternatives ?? [])];
}

/** True only when two tokens share an explicitly supported exact spelling. */
export function alignmentTokensMatch(
  left: string | AlignmentToken,
  right: string | AlignmentToken
): boolean {
  const rightForms = new Set(tokenForms(right));
  return tokenForms(left).some(value => rightForms.has(value));
}

/** Prepare a document segment once; reuse it for every Qur'an candidate. */
export function prepareFuzzySource(source: string): PreparedFuzzySource {
  const normalized = normalizeArabicWithMap(source);
  const tokens = tokenizeNormalized(normalized);
  const positions = new Map<string, number[]>();

  tokens.forEach((token, index) => {
    for (const value of tokenForms(token)) {
      const bucket = positions.get(value) ?? [];
      bucket.push(index);
      positions.set(value, bucket);
    }
  });

  return { normalized, tokens, positions };
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

/** Levenshtein alignment over word tokens. */
export function alignTokenSequence(
  canonicalTokens: readonly string[],
  sourceTokens: readonly AlignmentToken[]
): Omit<TokenAlignment, "sourceStart" | "sourceEnd" | "sourceTokenCount"> {
  const rows = canonicalTokens.length + 1;
  const columns = sourceTokens.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () =>
    Array<number>(columns).fill(0)
  );

  for (let i = 0; i < rows; i += 1) matrix[i]![0] = i;
  for (let j = 0; j < columns; j += 1) matrix[0]![j] = j;

  let matchedTokens = 0;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < columns; j += 1) {
      const equal = alignmentTokensMatch(canonicalTokens[i - 1]!, sourceTokens[j - 1]!);
      const tokenInsertionDeletion = !equal &&
        differsByOneInsertedCharacter(canonicalTokens[i - 1]!, sourceTokens[j - 1]!.value);
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1,
        matrix[i]![j - 1]! + 1,
        matrix[i - 1]![j - 1]! + (equal ? 0 : tokenInsertionDeletion ? 1 : canonicalTokens.length + sourceTokens.length)
      );
    }
  }

  let i = canonicalTokens.length;
  let j = sourceTokens.length;
  while (i > 0 && j > 0) {
    const current = matrix[i]![j]!;
    const diagonal = matrix[i - 1]![j - 1]!;
    if (current === diagonal && alignmentTokensMatch(canonicalTokens[i - 1]!, sourceTokens[j - 1]!)) {
      matchedTokens += 1;
      i -= 1;
      j -= 1;
    } else if (current === diagonal + 1) {
      i -= 1;
      j -= 1;
    } else if (current === matrix[i - 1]![j]! + 1) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  const distance = matrix[canonicalTokens.length]![sourceTokens.length]!;
  const denominator = Math.max(canonicalTokens.length, sourceTokens.length, 1);
  return { distance, similarity: 1 - distance / denominator, matchedTokens };
}

/** Search candidate token windows using a prebuilt inverted token map. */
export function findFuzzyTokenAlignments(
  source: string | PreparedFuzzySource,
  canonicalText: string | readonly (string | AlignmentToken)[],
  options: { maxDistance?: number; minimumTokens?: number } = {}
): TokenAlignment[] {
  const prepared = typeof source === "string" ? prepareFuzzySource(source) : source;
  const sourceTokens = prepared.tokens;
  const canonicalTokens: (string | AlignmentToken)[] = typeof canonicalText === "string"
    ? tokenizeArabic(canonicalText)
    : [...canonicalText];
  const minimumTokens = options.minimumTokens ?? 4;
  const maxDistance = options.maxDistance ?? 1;

  if (canonicalTokens.length < minimumTokens || sourceTokens.length === 0) return [];

  const candidateStarts = new Set<number>();
  canonicalTokens.forEach((token, canonicalIndex) => {
    for (const value of tokenForms(token)) {
      for (const sourceIndex of prepared.positions.get(value) ?? []) {
      for (let shift = -1; shift <= 1; shift += 1) {
        const start = sourceIndex - canonicalIndex + shift;
        if (start >= 0 && start < sourceTokens.length) candidateStarts.add(start);
      }
      }
    }
  });

  const results: TokenAlignment[] = [];
  for (const start of candidateStarts) {
    for (const length of [canonicalTokens.length - 1, canonicalTokens.length, canonicalTokens.length + 1]) {
      if (length < minimumTokens || start + length > sourceTokens.length) continue;
      const window = sourceTokens.slice(start, start + length);
      const score = alignTokenSequence(canonicalTokens, window);
      if (score.distance > maxDistance || score.matchedTokens < minimumTokens - maxDistance) continue;

      const first = window[0];
      const last = window[window.length - 1];
      if (!first || !last) continue;
      results.push({
        ...score,
        sourceStart: first.start,
        sourceEnd: last.end,
        sourceTokenCount: length
      });
    }
  }

  results.sort((a, b) =>
    b.similarity - a.similarity ||
    b.matchedTokens - a.matchedTokens ||
    (a.sourceEnd - a.sourceStart) - (b.sourceEnd - a.sourceStart)
  );

  const unique: TokenAlignment[] = [];
  for (const result of results) {
    if (!unique.some(item =>
      item.sourceStart === result.sourceStart && item.sourceEnd === result.sourceEnd
    )) unique.push(result);
  }
  return unique;
}
