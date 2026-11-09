import { describe, expect, it } from "vitest";
import {
  findLegacyBracketPairs,
  ORNAMENTAL_BRACKET_PAIRS
} from "../src/word/bracket-normalizer.js";

describe("optional legacy bracket normalization", () => {
  it("recognizes every supported legacy pair", () => {
    for (const [opening, closing] of ORNAMENTAL_BRACKET_PAIRS) {
      const result = findLegacyBracketPairs(`قبل ${opening}آية${closing} بعد`);
      expect(result.pairs).toHaveLength(1);
      expect(result.pairs[0]).toMatchObject({
        opening,
        closing,
        openingOffset: 4,
        closingOffset: 8
      });
      expect(result.unmatchedSymbolCount).toBe(0);
    }
  });

  it("leaves unmatched and mismatched symbols untouched", () => {
    const result = findLegacyBracketPairs("ﭽنص ﭾ ثم ﭿنص");
    expect(result.pairs).toHaveLength(0);
    expect(result.unmatchedSymbolCount).toBe(3);
  });

  it("supports multiple pairs and correctly nested pairs", () => {
    const result = findLegacyBracketPairs("ﭽأﭼ ثم ﭿب ﮁجﮀﭾ");
    expect(result.pairs).toHaveLength(3);
    expect(result.unmatchedSymbolCount).toBe(0);
  });

  it("does not treat the official ornamental brackets as legacy symbols", () => {
    const result = findLegacyBracketPairs("﴿آية﴾");
    expect(result.pairs).toHaveLength(0);
    expect(result.unmatchedSymbolCount).toBe(0);
  });

  it("returns UTF-16 offsets", () => {
    const result = findLegacyBracketPairs("😀ﭽآيةﭼ");
    expect(result.pairs[0]).toMatchObject({
      openingOffset: 2,
      closingOffset: 5
    });
  });
});
