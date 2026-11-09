const OUTER_BRACKET_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["﴿", "﴾"],
  ["", ""]
];

/**
 * Formats a reviewed verse for Word insertion.
 * The closing bracket is appended immediately after the exact verse text,
 * including any trailing Quranic combining marks.
 */
export function ensureOrnamentalVerseBrackets(text: string): string {
  let verse = text.trim();

  for (const [left, right] of OUTER_BRACKET_PAIRS) {
    if (verse.startsWith(left) && verse.endsWith(right)) {
      verse = verse.slice(left.length, verse.length - right.length).trim();
      break;
    }
  }

  return "﴿" + verse + "﴾";
}
