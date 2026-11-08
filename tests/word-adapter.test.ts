import { describe, expect, it } from "vitest";
import {
  assertParagraphSnapshot,
  createParagraphReplacementPlan,
  getWordRangeOffsets
} from "../src/word/word-adapter.js";

describe("Word paragraph replacement planning", () => {
  it("plans multiple replacements from the end of the paragraph", () => {
    const source = "قبل آية أولى ثم آية ثانية بعد";
    const first = source.indexOf("آية أولى");
    const second = source.indexOf("آية ثانية");
    const plan = createParagraphReplacementPlan(3, source, [
      {
        start: first,
        end: first + "آية أولى".length,
        expectedOriginalText: "آية أولى",
        replacementText: "النص الأول"
      },
      {
        start: second,
        end: second + "آية ثانية".length,
        expectedOriginalText: "آية ثانية",
        replacementText: "النص الثاني"
      }
    ]);

    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[0]?.start).toBe(second);
    expect(plan.steps[1]?.start).toBe(first);
    expect(plan.steps[1]?.expectedParagraphText).toContain("النص الثاني");
    expect(plan.steps[1]?.resultingParagraphText).toBe(
      "قبل النص الأول ثم النص الثاني بعد"
    );
  });

  it("rejects a stale source range", () => {
    expect(() => createParagraphReplacementPlan(0, "نص مختلف", [{
      start: 0,
      end: 3,
      expectedOriginalText: "نص قديم",
      replacementText: "نص جديد"
    }])).toThrow(/does not match/);
  });

  it("rejects overlapping replacements", () => {
    expect(() => createParagraphReplacementPlan(0, "abcdef", [
      { start: 1, end: 4, expectedOriginalText: "bcd", replacementText: "X" },
      { start: 3, end: 5, expectedOriginalText: "de", replacementText: "Y" }
    ])).toThrow(/Overlapping/);
  });

  it("rejects ranges outside the paragraph", () => {
    expect(() => createParagraphReplacementPlan(0, "abc", [{
      start: 1,
      end: 8,
      expectedOriginalText: "bc",
      replacementText: "X"
    }])).toThrow(/outside/);
  });

  it("cancels when the live paragraph differs from the reviewed snapshot", () => {
    expect(() => assertParagraphSnapshot("نص تغير", "النص الأصلي"))
      .toThrow(/changed after review/);
    expect(() => assertParagraphSnapshot("النص الأصلي", "النص الأصلي"))
      .not.toThrow();
  });
});


describe("Word absolute range coordinates", () => {
  it("converts paragraph-relative Arabic offsets to absolute Word positions", () => {
    const paragraph = "قبل ﴿آية قرآنية﴾ بعد";
    const start = paragraph.indexOf("﴿");
    const end = paragraph.indexOf("﴾") + 1;
    expect(getWordRangeOffsets(120, 120 + paragraph.length, paragraph, start, end))
      .toEqual({ start: 120 + start, end: 120 + end });
  });

  it("maps UTF-16 offsets when Word counts Unicode code points", () => {
    const paragraph = "A😀ب";
    expect(getWordRangeOffsets(50, 53, paragraph, 3, 4))
      .toEqual({ start: 52, end: 53 });
  });

  it("rejects offsets when Word and JavaScript positions cannot be aligned", () => {
    expect(() => getWordRangeOffsets(10, 15, "أبج", 0, 2))
      .toThrow(/not aligned/);
  });

  it("rejects an empty or out-of-bounds source range", () => {
    expect(() => getWordRangeOffsets(10, 13, "أبج", 2, 2))
      .toThrow(/Invalid/);
    expect(() => getWordRangeOffsets(10, 13, "أبج", 0, 4))
      .toThrow(/Invalid/);
  });
});
