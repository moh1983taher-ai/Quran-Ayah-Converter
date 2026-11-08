import { describe, expect, it } from "vitest";
import {
  buildApprovedReplacements,
  createReviewItems,
  setReviewDecision
} from "../src/word/review-workflow.js";
import type { AyahMatch } from "../src/core/types.js";

const match = (overrides: Partial<AyahMatch> = {}): AyahMatch => ({
  sourceStart: 5,
  sourceEnd: 10,
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
    const items = createReviewItems(source, [match({ sourceStart: 5, sourceEnd: 11 })]);
    expect(items).toHaveLength(1);
    expect(items[0]?.originalText).toBe(source.slice(5, 11));
    expect(items[0]?.decision).toBe("pending");
    expect(items[0]?.id).toContain("1:1");
  });

  it("builds replacements only after explicit approval", () => {
    const items = createReviewItems("قبل آية نص بعد", [match()]);
    expect(buildApprovedReplacements(items)).toHaveLength(0);
    const approved = setReviewDecision(items, [items[0]!.id], "approved");
    const replacements = buildApprovedReplacements(approved);
    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.expectedOriginalText).toBe("آية نص");
    expect(replacements[0]?.replacementText).toBe("النص العثماني");
  });

  it("rejects approval of ambiguous matches", () => {
    const items = createReviewItems("قبل آية نص بعد", [
      match({ status: "ambiguous", canonicalText: "" })
    ]);
    expect(() => setReviewDecision(items, [items[0]!.id], "approved"))
      .toThrow(/Cannot approve/);
  });

  it("orders approved replacements from end to start", () => {
    const items = createReviewItems("آية1 ثم آية2", [
      match({ sourceStart: 0, sourceEnd: 4, matchedText: "آية1" }),
      match({ sourceStart: 9, sourceEnd: 13, matchedText: "آية2", references: [{ surah: 1, ayah: 2 }] })
    ]);
    const approved = setReviewDecision(items, items.map(item => item.id), "approved");
    const replacements = buildApprovedReplacements(approved);
    expect((replacements[0]?.location as { start: number }).start).toBe(9);
    expect((replacements[1]?.location as { start: number }).start).toBe(0);
  });
});
