import { describe, expect, it } from "vitest";
import { ensureOrnamentalVerseBrackets } from "../src/word/verse-format.js";

describe("Word Qur'anic verse formatting", () => {
  it("preserves the final fatha and places the closing bracket after the final mark", () => {
    const verse = "وَلَعَلَّكُمۡ تَشۡكُرُونَ";
    const formatted = ensureOrnamentalVerseBrackets(verse);

    expect(formatted).toBe("﴿" + verse + "﴾");
    expect(formatted).toContain("تَشۡكُرُونَ");
    expect(formatted.endsWith("\u064E ﴾")).toBe(true);
  });

  it("normalizes an existing bracket pair without duplicating it or losing the final mark", () => {
    const verse = "﴿وَلَعَلَّكُمۡ تَشۡكُرُونَ﴾";
    expect(ensureOrnamentalVerseBrackets(verse))
      .toBe("﴿وَلَعَلَّكُمۡ تَشۡكُرُونَ﴾");
  });

  it("places the bracket immediately after text without a trailing mark", () => {
    expect(ensureOrnamentalVerseBrackets("وَلَعَلَّكُمۡ تَشۡكُرُون"))
      .toBe("﴿وَلَعَلَّكُمۡ تَشۡكُرُون﴾");
  });

  it("replaces legacy delimiters with one canonical ornamental pair", () => {
    expect(ensureOrnamentalVerseBrackets("تَشْكُرُونَ"))
      .toBe("﴿تَشْكُرُونَ﴾");
  });
});
