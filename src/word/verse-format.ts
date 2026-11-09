const OUTER_BRACKET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["﴿", "﴾"],
  ["", ""]
];

/**
 * Formats a reviewed verse for Word insertion.
 * A regular space separates the verse text from the closing bracket.
 * The Quranic text itself is preserved exactly, including all combining marks.
 */
export function ensureOrnamentalVerseBrackets(text: string): string {
  let verse = text.trim();

  for (const [left, right] of OUTER_BRACKET_PAIRS) {
    if (verse.startsWith(left) && verse.endsWith(right)) {
      verse = verse.slice(left.length, verse.length - right.length).trim();
      break;
    }
  }

  const separator = " ";
  return "﴿" + verse + separator + "﴾";
}
