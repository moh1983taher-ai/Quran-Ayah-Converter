import { describe, expect, it } from "vitest";
import {
  buildApprovedReplacements,
  createReviewItems,
  getReviewSelectionCounts,
  groupBracketedAyahMatches,
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
  it("enables the clear-selection action only while at least one result is approved", () => {
    const source = "قبل آية نص بعد";
    const start = source.indexOf("آية نص");
    const items = createReviewItems(source, [
      match({ sourceStart: start, sourceEnd: start + "آية نص".length })
    ]);

    expect(getReviewSelectionCounts(items)).toEqual({
      selectableCount: 1,
      approvedCount: 0
    });

    const approved = setReviewDecision(items, [items[0]!.id], "approved");
    expect(getReviewSelectionCounts(approved)).toEqual({
      selectableCount: 1,
      approvedCount: 1
    });

    const cleared = setReviewDecision(approved, [items[0]!.id], "rejected");
    expect(getReviewSelectionCounts(cleared)).toEqual({
      selectableCount: 1,
      approvedCount: 0
    });
  });


  it("groups consecutive ayahs inside one legacy outer pair and preserves separators", () => {
    const source = "قبل آية أولى * آية ثانية، آية ثالثة [يوسف: 3] بعد";
    const firstStart = source.indexOf("آية أولى");
    const secondStart = source.indexOf("آية ثانية");
    const thirdStart = source.indexOf("آية ثالثة");
    const matches = [
      match({ sourceStart: firstStart, sourceEnd: firstStart + "آية أولى".length, canonicalText: "النص الأول", references: [{ surah: 12, ayah: 1 }] }),
      match({ sourceStart: secondStart, sourceEnd: secondStart + "آية ثانية".length, canonicalText: "النص الثاني", references: [{ surah: 12, ayah: 2 }] }),
      match({ sourceStart: thirdStart, sourceEnd: thirdStart + "آية ثالثة".length, canonicalText: "النص الثالث", references: [{ surah: 12, ayah: 3 }] })
    ];
    const grouped = groupBracketedAyahMatches(source, matches);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.sourceStart).toBe(source.indexOf(""));
    expect(grouped[0]?.sourceEnd).toBe(source.indexOf("") + 1);
    expect(grouped[0]?.replacementText).toBe("النص الأول * النص الثاني، النص الثالث");
    expect(grouped[0]?.references).toEqual([
      { surah: 12, ayah: 1 }, { surah: 12, ayah: 2 }, { surah: 12, ayah: 3 }
    ]);
  });


  it("creates one review item and one approved replacement for a consecutive multi-ayah passage", () => {
    const source = "قبل آية أولى ۝١ * آية ثانية ۝٢ * آية ثالثة ۝٣ [1-3] بعد";
    const spans = ["آية أولى", "آية ثانية", "آية ثالثة"].map(value => {
      const start = source.indexOf(value);
      return { start, end: start + value.length };
    });
    const matches = spans.map((span, index) => match({
      sourceStart: span.start,
      sourceEnd: span.end,
      canonicalText: `النص العثماني ${index + 1}`,
      references: [{ surah: 12, ayah: 23 + index }]
    }));
    const grouped = groupBracketedAyahMatches(source, matches);
    const items = createReviewItems(source, grouped);

    expect(items).toHaveLength(1);
    expect(items[0]?.originalText).toBe("آية أولى ۝١ * آية ثانية ۝٢ * آية ثالثة ۝٣");
    expect(items[0]?.replacementText).toBe("النص العثماني 1 ۝١ * النص العثماني 2 ۝٢ * النص العثماني 3 ۝٣");
    const approved = setReviewDecision(items, [items[0]!.id], "approved");
    const replacements = buildApprovedReplacements(approved);
    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.expectedOriginalText).toBe(items[0]?.originalText);
  });

  it("groups one passage when Qur'anic pause signs occur between consecutive ayahs", () => {
    const source = "قبل ﴿آية أولى ۖ ۝١ آية ثانية ۗ ۝٢﴾ بعد";
    const firstStart = source.indexOf("آية أولى");
    const secondStart = source.indexOf("آية ثانية");
    const matches = [
      match({
        sourceStart: firstStart,
        sourceEnd: firstStart + "آية أولى".length,
        canonicalText: "النص الأول",
        references: [{ surah: 12, ayah: 1 }]
      }),
      match({
        sourceStart: secondStart,
        sourceEnd: secondStart + "آية ثانية".length,
        canonicalText: "النص الثاني",
        references: [{ surah: 12, ayah: 2 }]
      })
    ];

    const grouped = groupBracketedAyahMatches(source, matches);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.matchedText).toBe("﴿آية أولى ۖ ۝١ آية ثانية ۗ ۝٢﴾");
    expect(grouped[0]?.replacementText).toBe("النص الأول ۖ ۝١ النص الثاني ۗ ۝٢");
    const items = createReviewItems(source, grouped);
    expect(items).toHaveLength(1);
    expect(items[0]?.originalText).toBe("﴿آية أولى ۖ ۝١ آية ثانية ۗ ۝٢﴾");
  });

  it("does not group neighboring matches when one already has multiple references", () => {
    const source = "﴿مقتطف أول * آية ثانية﴾";
    const firstStart = source.indexOf("مقتطف أول");
    const secondStart = source.indexOf("آية ثانية");
    const matches = [
      match({
        sourceStart: firstStart,
        sourceEnd: firstStart + "مقتطف أول".length,
        references: [{ surah: 12, ayah: 1 }, { surah: 13, ayah: 1 }]
      }),
      match({
        sourceStart: secondStart,
        sourceEnd: secondStart + "آية ثانية".length,
        references: [{ surah: 12, ayah: 2 }]
      })
    ];
    expect(groupBracketedAyahMatches(source, matches)).toHaveLength(2);
  });

  it("does not combine non-consecutive ayahs merely because they share one outer quote", () => {
    const source = "آية أولى * آية ثالثة";
    const firstStart = source.indexOf("آية أولى");
    const secondStart = source.indexOf("آية ثالثة");
    const matches = [
      match({ sourceStart: firstStart, sourceEnd: firstStart + "آية أولى".length, references: [{ surah: 12, ayah: 1 }] }),
      match({ sourceStart: secondStart, sourceEnd: secondStart + "آية ثالثة".length, references: [{ surah: 12, ayah: 3 }] })
    ];
    expect(groupBracketedAyahMatches(source, matches)).toHaveLength(2);
  });

  it("does not group separate bracketed quotations in the same paragraph", () => {
    const source = "﴿آية أولى﴾ ثم ﴿آية ثانية﴾";
    const firstStart = source.indexOf("آية أولى");
    const secondStart = source.indexOf("آية ثانية");
    const matches = [
      match({ sourceStart: firstStart, sourceEnd: firstStart + "آية أولى".length }),
      match({ sourceStart: secondStart, sourceEnd: secondStart + "آية ثانية".length, references: [{ surah: 1, ayah: 2 }] })
    ];
    expect(groupBracketedAyahMatches(source, matches)).toHaveLength(2);
  });

  it("does not group ayahs separated by explanatory prose inside the outer pair", () => {
    const source = "﴿آية أولى — شرح موجز — آية ثانية﴾";
    const firstStart = source.indexOf("آية أولى");
    const secondStart = source.indexOf("آية ثانية");
    const matches = [
      match({ sourceStart: firstStart, sourceEnd: firstStart + "آية أولى".length }),
      match({ sourceStart: secondStart, sourceEnd: secondStart + "آية ثانية".length, references: [{ surah: 1, ayah: 2 }] })
    ];
    expect(groupBracketedAyahMatches(source, matches)).toHaveLength(2);
  });


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

  it("allows approval of a repeated excerpt when all references share one Uthmani rendering", () => {
    const source = "قبل مقتطف قرآني بعد";
    const start = source.indexOf("مقتطف قرآني");
    const items = createReviewItems(source, [
      match({
        sourceStart: start,
        sourceEnd: start + "مقتطف قرآني".length,
        references: [{ surah: 23, ayah: 19 }, { surah: 36, ayah: 34 }],
        replacementText: "نَصٌّ قُرْآنِيٌّ",
        evidence: [
          { type: "exact-text", detail: "exact" },
          { type: "context", detail: "المقتطف مكرر في المواضع المذكورة، والرسم العثماني متطابق" }
        ]
      })
    ]);
    const approved = setReviewDecision(items, [items[0]!.id], "approved");
    const replacements = buildApprovedReplacements(approved);
    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.replacementText).toBe("نَصٌّ قُرْآنِيٌّ");
    expect((replacements[0]?.location as { references: Array<{ surah: number; ayah: number }> }).references).toEqual([
      { surah: 23, ayah: 19 },
      { surah: 36, ayah: 34 }
    ]);
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
