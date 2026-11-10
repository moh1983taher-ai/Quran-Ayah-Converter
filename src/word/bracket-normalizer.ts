/**
 * Optional normalization of legacy Qur'anic quotation brackets.
 * Only complete, correctly nested pairs are returned for replacement.
 */

export const ORNAMENTAL_BRACKET_PAIRS = [
  ["ﭽ", "ﭼ"],
  ["ﭿ", "ﭾ"],
  ["ﮁ", "ﮀ"],
  ["ﮃ", "ﮂ"],
  ["ﮅ", "ﮄ"],
  ["ﮇ", "ﮆ"],
  ["ﮉ", "ﮈ"],
  ["ﮋ", "ﮊ"],
  ["ﵡ", "ﵠ"],
  ["ﵟ", "ﵞ"],
  ["", ""]
] as const;

export interface MatchedBracketPair {
  opening: string;
  closing: string;
  openingOffset: number;
  closingOffset: number;
}

export interface BracketScanResult {
  pairs: MatchedBracketPair[];
  unmatchedSymbolCount: number;
}

/**
 * Scans UTF-16 offsets (the coordinate system used by Office.js).
 * A closing symbol matches only the opening symbol for the same pair at the
 * top of the nesting stack. Mismatched and isolated symbols remain untouched.
 */
export function findLegacyBracketPairs(text: string): BracketScanResult {
  const openingToClosing = new Map<string, string>(ORNAMENTAL_BRACKET_PAIRS);
  const closingToOpening = new Map<string, string>(
    ORNAMENTAL_BRACKET_PAIRS.map(([opening, closing]) => [closing, opening])
  );
  const stack: Array<{ opening: string; closing: string; offset: number }> = [];
  const pairs: MatchedBracketPair[] = [];
  let recognizedSymbolCount = 0;

  let offset = 0;
  for (const character of text) {
    const openingClosing = openingToClosing.get(character);
    if (openingClosing) {
      recognizedSymbolCount += 1;
      stack.push({ opening: character, closing: openingClosing, offset });
    } else {
      const expectedOpening = closingToOpening.get(character);
      if (expectedOpening) {
        recognizedSymbolCount += 1;
        const top = stack[stack.length - 1];
        if (top?.opening === expectedOpening) {
          stack.pop();
          pairs.push({
            opening: top.opening,
            closing: character,
            openingOffset: top.offset,
            closingOffset: offset
          });
        }
      }
    }
    offset += character.length;
  }

  return {
    pairs: pairs.sort((a, b) => a.openingOffset - b.openingOffset),
    unmatchedSymbolCount: recognizedSymbolCount - pairs.length * 2
  };
}
