import type { NormalizedText } from "./types.js";

const TATWEEL = "\u0640";
const ARABIC_DIACRITICS = /[\p{M}\u06D6-\u06ED]/u;
const FORMAT_CONTROLS = /\p{Cf}/u;
// Qur'anic superscript letters used as orthographic annotations, not independent word letters.
const QURANIC_SMALL_LETTERS = /[\u06E5\u06E6]/u;
const ALEF_VARIANTS: Record<string, string> = {
  "أ": "ا",
  "إ": "ا",
  "آ": "ا",
  "ٱ": "ا",
  // Normalize hamza-seat variants while preserving the hamza itself.
  "ؤ": "ء",
  "ئ": "ء"
};

/**
 * Produces a search-oriented Arabic form while preserving a reversible map
 * from every output UTF-16 code unit to the corresponding source range.
 *
 * Deliberately does not merge ة with ه, nor ؤ/ئ with و/ي: those changes can
 * create false matches and must be handled only by a separately scored
 * fallback strategy, if ever needed.
 */
export function normalizeArabicWithMap(input: string): NormalizedText {
  let value = "";
  const sourceStart: number[] = [];
  const sourceEnd: number[] = [];

  let offset = 0;
  for (const character of input) {
    const start = offset;
    offset += character.length;

    // Compatibility normalization handles Arabic presentation forms and
    // Qur'anic ligatures copied from PDFs/Word. Every expanded character maps
    // back to the original source code point so replacement offsets stay exact.
    for (const compatibleCharacter of character.normalize("NFKC")) {
      if (
        compatibleCharacter === TATWEEL ||
        ARABIC_DIACRITICS.test(compatibleCharacter) ||
        QURANIC_SMALL_LETTERS.test(compatibleCharacter) ||
        FORMAT_CONTROLS.test(compatibleCharacter)
      ) {
        continue;
      }

      const normalized = ALEF_VARIANTS[compatibleCharacter]
        ?? (compatibleCharacter === "ى" ? "ي" : compatibleCharacter);

      value += normalized;
      for (let i = 0; i < normalized.length; i += 1) {
        sourceStart.push(start);
        sourceEnd.push(offset);
      }
    }
  }

  return { value, sourceStart, sourceEnd, sourceText: input };
}

export function normalizeArabic(input: string): string {
  return normalizeArabicWithMap(input).value;
}

/** Maps a normalized half-open range back to a half-open source range. */
export function mapNormalizedRange(
  normalized: NormalizedText,
  start: number,
  end: number
): { start: number; end: number } | undefined {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > normalized.value.length
  ) {
    return undefined;
  }

  const sourceStart = normalized.sourceStart[start];
  let sourceEnd = normalized.sourceEnd[end - 1];

  if (sourceStart === undefined || sourceEnd === undefined) {
    return undefined;
  }

  // The normalized form omits combining marks. Extend the mapped range over
  // every immediately-following mark in the original text so replacements
  // never split an Arabic grapheme cluster. Offsets remain UTF-16 indices.
  while (sourceEnd < normalized.sourceText.length) {
    const codePoint = String.fromCodePoint(
      normalized.sourceText.codePointAt(sourceEnd)!
    );
    if (!ARABIC_DIACRITICS.test(codePoint) && !QURANIC_SMALL_LETTERS.test(codePoint)) break;
    sourceEnd += codePoint.length;
  }

  return { start: sourceStart, end: sourceEnd };
}
