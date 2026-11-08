const OUTER_BRACKET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["﴿", "﴾"],
  ["", ""]
];

/**
 * Formats a reviewed verse for Word insertion.
 *
 * A thin space after a final Arabic combining mark keeps that mark visually
 * attached to the final letter and separates it slightly from the closing
 * ornamental bracket. The mark itself is never removed or rewritten.
 */
export function ensureOrnamentalVerseBrackets(text: string): string {
  let verse = text.trim();

  for (const [left, right] of OUTER_BRACKET_PAIRS) {
    if (verse.startsWith(left) && verse.endsWith(right)) {
      verse = verse.slice(left.length, verse.length - right.length).trim();
      break;
    }
  }

  const separator = /\p{M}$/u.test(verse) ? "\u2009" : "";
  return \`﴿\${verse}\${separator}﴾\`;
}
