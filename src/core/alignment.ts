import type { NormalizedText } from "./types.js";
import { mapNormalizedRange, normalizeArabicWithMap } from "./normalizer.js";

export interface AlignmentToken {
  value: string;
  start: number;
  end: number;
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

    const previous = tokens[tokens.length - 1];
    if (
      previous?.value === "يا" &&
      /^\s*$/u.test(normalized.sourceText.slice(previous.end, mapped.start))
    ) {
      // Treat the vocative particle plus its following word as one matching
      // token: "يا آدم"/"ياآدم" and "يا أيها"/"ياأيها".
      previous.value += match[0];
      previous.end = mapped.end;
    } else {
      tokens.push({ value: match[0], start: mapped.start, end: mapped.end });
    }
  }
  return tokens;
}

/** Prepare a document segment once; reuse it for every Qur'an candidate. */
export function prepareFuzzySource(source: string): PreparedFuzzySource {
  const normalized = normalizeArabicWithMap(source);
  const tokens = tokenizeNormalized(normalized);
  const positions = new Map<string, number[]>();

  tokens.forEach((token, index) => {
    const bucket = positions.get(token.value) ?? [];
    bucket.push(index);
    positions.set(token.value, bucket);
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
      const equal = canonicalTokens[i - 1] === sourceTokens[j - 1]?.value;
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
    if (current === diagonal && canonicalTokens[i - 1] === sourceTokens[j - 1]?.value) {
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
  canonicalText: string | readonly string[],
  options: { maxDistance?: number; minimumTokens?: number } = {}
): TokenAlignment[] {
  const prepared = typeof source === "string" ? prepareFuzzySource(source) : source;
  const sourceTokens = prepared.tokens;
  const canonicalTokens = typeof canonicalText === "string"
    ? tokenizeArabic(canonicalText).map(token => token.value)
    : [...canonicalText];
  const minimumTokens = options.minimumTokens ?? 4;
  const maxDistance = options.maxDistance ?? 1;

  if (canonicalTokens.length < minimumTokens || sourceTokens.length === 0) return [];

  const candidateStarts = new Set<number>();
  canonicalTokens.forEach((token, canonicalIndex) => {
    for (const sourceIndex of prepared.positions.get(token) ?? []) {
      for (let shift = -1; shift <= 1; shift += 1) {
        const start = sourceIndex - canonicalIndex + shift;
        if (start >= 0 && start < sourceTokens.length) candidateStarts.add(start);
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
