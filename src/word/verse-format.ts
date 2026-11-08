const OUTER_BRACKET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["﴿", "﴾"],
  ["", ""]
];

/**
 * Formats a reviewed verse for Word insertion.
 * A thin space after a final Arabic combining mark separates it visually
 * from the closing bracket without removing or rewriting the mark.
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
  return "﴿" + verse + separator + "﴾";
}
