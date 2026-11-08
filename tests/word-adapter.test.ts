import { describe, expect, it } from "vitest";
import {
  assertParagraphSnapshot,
  createParagraphReplacementPlan
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

