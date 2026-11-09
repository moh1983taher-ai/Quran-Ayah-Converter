import { describe, expect, it } from "vitest";
import { tokenizeArabic } from "../src/core/alignment.js";
import {
  mapNormalizedRange,
  normalizeArabic,
  normalizeArabicWithMap
} from "../src/core/normalizer.js";

describe("Arabic normalization", () => {
  it("removes tashkeel and tatweel", () => {
    expect(normalizeArabic("الرَّحْمَٰنُــــ")).toBe("الرحمن");
  });

  it("normalizes common alef variants and alef maksura", () => {
    expect(normalizeArabic("إِلَىٰ أَنْ")).toBe("الي ان");
  });

  it("normalizes Arabic presentation ligatures and removes invisible format controls", () => {
    expect(normalizeArabic("ﷲ لَا\u200Dه")).toBe("الله لاه");
  });

  it("does not merge taa marbuta and haa", () => {
    expect(normalizeArabic("رحمة")).not.toBe(normalizeArabic("رحمه"));
  });

  it("maps normalized offsets back to the original UTF-16 range", () => {
    const source = "قَالَ اللهُ";
    const normalized = normalizeArabicWithMap(source);
    const range = mapNormalizedRange(normalized, 0, 3);

    expect(normalized.value).toBe("قال الله");
    expect(range).toEqual({ start: 0, end: 5 });
    expect(source.slice(range!.start, range!.end)).toBe("قَالَ");
  });

  it("includes all trailing Qur'anic marks in a mapped range without consuming separators", () => {
    const source = "قَا\u06D6\u06E2، ثم";
    const normalized = normalizeArabicWithMap(source);
    const range = mapNormalizedRange(normalized, 0, normalized.value.indexOf("،"));

    expect(range).toEqual({ start: 0, end: "قَا\u06D6\u06E2".length });
    expect(source.slice(range!.start, range!.end)).toBe("قَا\u06D6\u06E2");
    expect(source[range!.end]).toBe("،");
  });

  it("keeps trailing marks inside the final aligned Arabic token", () => {
    const source = "وَمَن لَّمۡ يَحۡكُمِ ٱلظَّٰلِمُونَ۞ ثم";
    const tokens = tokenizeArabic(source);
    const lastToken = tokens[tokens.length - 1];

    expect(lastToken).toBeDefined();
    expect(source.slice(lastToken!.start, lastToken!.end)).toBe("ثم");
    const target = tokens[tokens.length - 2]!;
    expect(source.slice(target.start, target.end)).toBe("ٱلظَّٰلِمُونَ۞");
  });

  it("rejects invalid normalized ranges", () => {
    const normalized = normalizeArabicWithMap("قرآن");
    expect(mapNormalizedRange(normalized, -1, 2)).toBeUndefined();
    expect(mapNormalizedRange(normalized, 1, 1)).toBeUndefined();
  });
});
