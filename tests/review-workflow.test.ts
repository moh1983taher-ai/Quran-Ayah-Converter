import { describe, expect, it } from "vitest";
import {
  buildApprovedReplacements,
  createReviewItems,
  setReviewDecision
} from "../src/word/review-workflow.js";
import type { AyahMatch } from "../src/core/types.js";

const match = (overrides: Partial<AyahMatch> = {}): AyahMatch => ({
  sourceStart: 0,
  sourceEnd: 0,
  references: [{ surah: 1, ayah: 1 }],
  matchedText: "آية نص",
  canonicalText: "النص العثماني",
  confidence: 0.98,
  evidence: [{ type: "exact-text", detail: "exact" }],
  status: "high-confidence",
  ...overrides
});

describe("Word review workflow", () => {
  it("creates review items with exact source text and stable identities", () => {
    const source = "قبل آية نص بعد";
    const start = source.indexOf("آية نص");
    const items = createReviewItems(source, [match({ sourceStart: start, sourceEnd: start + "آية نص".length })]);
    expect(items).toHaveLength(1);
    expect(items[0]?.originalText).toBe("آية نص");
    expect(items[0]?.decision).toBe("pending");
    expect(items[0]?.id).toContain("1:1");
  });

  it("builds replacements only after explicit approval", () => {
    const source = "قبل آية نص بعد";
    const start = source.indexOf("آية نص");
    const items = createReviewItems(source, [match({ sourceStart: start, sourceEnd: start + "آية نص".length })]);
    expect(buildApprovedReplacements(items)).toHaveLength(0);
    const approved = setReviewDecision(items, [items[0]!.id], "approved");
    const replacements = buildApprovedReplacements(approved);
    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.expectedOriginalText).toBe("آية نص");
    expect(replacements[0]?.replacementText).toBe("النص العثماني");
  });

  it("rejects approval of ambiguous matches", () => {
    const source = "قبل آية نص بعد";
    const start = source.indexOf("آية نص");
    const items = createReviewItems(source, [
      match({ sourceStart: start, sourceEnd: start + "آية نص".length, status: "ambiguous", canonicalText: "" })
    ]);
    expect(() => setReviewDecision(items, [items[0]!.id], "approved"))
      .toThrow(/Cannot approve/);
  });

  it("orders approved replacements from end to start using actual source offsets", () => {
    const source = "آية1 ثم آية2";
    const firstStart = source.indexOf("آية1");
    const secondStart = source.indexOf("آية2");
    const items = createReviewItems(source, [
      match({ sourceStart: firstStart, sourceEnd: firstStart + "آية1".length, matchedText: "آية1" }),
      match({ sourceStart: secondStart, sourceEnd: secondStart + "آية2".length, matchedText: "آية2", references: [{ surah: 1, ayah: 2 }] })
    ]);
    const approved = setReviewDecision(items, items.map(item => item.id), "approved");
    const replacements = buildApprovedReplacements(approved);
    expect(replacements).toHaveLength(2);
    expect((replacements[0]?.location as { start: number }).start).toBe(secondStart);
    expect((replacements[1]?.location as { start: number }).start).toBe(firstStart);
  });

  it("ignores detector ranges outside the source text", () => {
    const items = createReviewItems("نص", [match({ sourceStart: 0, sourceEnd: 20 })]);
    expect(items).toHaveLength(0);
  });
});
