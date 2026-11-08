import { describe, expect, it } from "vitest";
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
    expect(normalizeArabic("إِلَىٰ أَنْ")).toBe("الى ان");
  });

  it("does not merge taa marbuta and haa", () => {
    expect(normalizeArabic("رحمة")).not.toBe(normalizeArabic("رحمه"));
  });

  it("maps normalized offsets back to the original UTF-16 range", () => {
    const source = "قَالَ اللهُ";
    const normalized = normalizeArabicWithMap(source);
    const range = mapNormalizedRange(normalized, 0, 2);

    expect(normalized.value).toBe("قال الله");
    expect(range).toEqual({ start: 0, end: 4 });
    expect(source.slice(range!.start, range!.end)).toBe("قَالَ");
  });

  it("rejects invalid normalized ranges", () => {
    const normalized = normalizeArabicWithMap("قرآن");
    expect(mapNormalizedRange(normalized, -1, 2)).toBeUndefined();
    expect(mapNormalizedRange(normalized, 1, 1)).toBeUndefined();
  });
});
