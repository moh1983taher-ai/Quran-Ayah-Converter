import { describe, expect, it } from "vitest";
import {
  composeQuranCitationReplacement,
  formatQuranCitation,
  hasMatchingQuranCitation,
  inspectAdjacentQuranCitation,
  verifyAndComposeQuranCitationReplacement
} from "../src/word/quran-citation.js";
import type { AyahReference, QuranAyahRecord, QuranIndex } from "../src/core/types.js";

function indexFor(references: AyahReference[]): QuranIndex {
  const records = new Map(references.map(reference => {
    const record: QuranAyahRecord = {
      ...reference,
      id: `${reference.surah}:${reference.ayah}`,
      surahNameArabic: reference.surah === 4 ? "النساء" : reference.surah === 17 ? "الإسراء" : "يوسف",
      uthmani: "نص",
      imlaei: "نص"
    };
    return [`${reference.surah}:${reference.ayah}`, record] as const;
  }));
  return {
    get: reference => records.get(`${reference.surah}:${reference.ayah}`),
    search: () => [],
    all: () => [...records.values()],
    size: records.size
  };
}

describe("Quran citation formatting", () => {
  it("formats one ayah using the Arabic surah name", () => {
    const refs = [{ surah: 4, ayah: 30 }];
    expect(formatQuranCitation(refs, indexFor(refs))).toBe("[النساء: 30]");
  });
  it("formats consecutive ayahs as one range", () => {
    const refs = [23, 24, 25].map(ayah => ({ surah: 12, ayah }));
    expect(formatQuranCitation(refs, indexFor(refs))).toBe("[يوسف: 23–25]");
  });
  it("does not invent a range for non-consecutive references", () => {
    const refs = [{ surah: 12, ayah: 3 }, { surah: 12, ayah: 5 }];
    expect(formatQuranCitation(refs, indexFor(refs))).toBe("[يوسف: 3؛ 5]");
  });
  it("supports repeated excerpts at different surahs", () => {
    const refs = [{ surah: 4, ayah: 30 }, { surah: 12, ayah: 23 }];
    expect(formatQuranCitation(refs, indexFor(refs))).toBe("[النساء: 30؛ يوسف: 23]");
  });
  it("omits citations if a reference is absent from the dataset", () => {
    expect(formatQuranCitation([{ surah: 4, ayah: 30 }], indexFor([]))).toBeUndefined();
  });
  it("recognizes existing citations with Arabic-Indic digits", () => {
    expect(hasMatchingQuranCitation(" [النساء: ٣٠] ثم", "[النساء: 30]")).toBe(true);
  });
  it("does not mistake a footnote number for a Quran citation", () => {
    expect(hasMatchingQuranCitation(" [30] ثم", "[النساء: 30]")).toBe(false);
  });
  it("recognizes an existing citation after punctuation", () => {
    expect(hasMatchingQuranCitation("، [يوسف: 23-25] ثم", "[يوسف: 23–25]")).toBe(true);
  });
});

describe("adjacent Quran citation review", () => {
  const refs = [{ surah: 4, ayah: 30 }];
  const index = indexFor(refs);
  const expected = "[النساء: 30]";
  const verse = "﴿نص الآية﴾";

  it("classifies a missing citation as addable", () => {
    const result = inspectAdjacentQuranCitation(verse + " ثم", verse.length, expected, refs, index);
    expect(result.status).toBe("missing");
    expect(result.editable).toBe(true);
  });

  it("recognizes correct citations with Arabic digits", () => {
    const result = inspectAdjacentQuranCitation(verse + "  [النساء: ٣٠]", verse.length, expected, refs, index);
    expect(result.status).toBe("correct");
    expect(result.existingCitation).toBe("[النساء: ٣٠]");
    expect(result.separator).toBe("  ");
  });

  it("treats mixed Arabic and Latin digits as one citation number", () => {
    const ayahRefs = [{ surah: 17, ayah: 32 }];
    const expectedCitation = "[الإسراء: 32]";
    const mixedIndex = indexFor([...ayahRefs, { surah: 17, ayah: 34 }]);

    const correct = inspectAdjacentQuranCitation(
      verse + " [الإسراء: ٣2]",
      verse.length,
      expectedCitation,
      ayahRefs,
      mixedIndex
    );
    expect(correct.status).toBe("correct");

    const source = verse + "، [الإسراء: ٣4]";
    const detected = inspectAdjacentQuranCitation(
      source, verse.length, expectedCitation, ayahRefs, mixedIndex
    );
    expect(detected.status).toBe("incorrect");
    expect(source.slice(detected.start, detected.end)).toBe("[الإسراء: ٣4]");

    const approved = verifyAndComposeQuranCitationReplacement(
      verse,
      source,
      verse.length,
      expectedCitation,
      ayahRefs,
      mixedIndex,
      { addMissing: false, correctExisting: true }
    );
    expect(approved.review.status).toBe("incorrect");
    expect(approved.replacementText).toBe(verse + "، [الإسراء: 32]");
  });

  it("classifies a known wrong citation and captures its exact range", () => {
    const text = verse + "، [يوسف: 3]";
    const wrongIndex = indexFor([...refs, { surah: 12, ayah: 3 }]);
    const result = inspectAdjacentQuranCitation(text, verse.length, expected, refs, wrongIndex);
    expect(result.status).toBe("incorrect");
    expect(result.editable).toBe(true);
    expect(text.slice(result.start, result.end)).toBe("[يوسف: 3]");
    expect(result.separator).toBe("، ");
  });

  it("leaves unknown surah citations ambiguous", () => {
    const result = inspectAdjacentQuranCitation(verse + " [سورة مجهولة: 3]", verse.length, expected, refs, index);
    expect(result.status).toBe("ambiguous");
    expect(result.editable).toBe(false);
  });

  it("does not treat a plain footnote number as a citation", () => {
    const result = inspectAdjacentQuranCitation(verse + " [12]", verse.length, expected, refs, index);
    expect(result.status).toBe("missing");
  });

  it("leaves bibliographic references untouched", () => {
    const result = inspectAdjacentQuranCitation(verse + " [Smith 2020]", verse.length, expected, refs, index);
    expect(result.status).toBe("ambiguous");
    expect(result.editable).toBe(false);
  });

  it("does not insert when the selection ends at the verse boundary", () => {
    const result = inspectAdjacentQuranCitation(verse, verse.length, expected, refs, index, { start: 0, end: verse.length });
    expect(result.status).toBe("outside-scope");
    expect(result.editable).toBe(false);
  });

  it("does not replace a citation that extends beyond the selection", () => {
    const text = verse + " [النساء: 30]";
    const result = inspectAdjacentQuranCitation(text, verse.length, expected, refs, index, { start: 0, end: verse.length + 5 });
    expect(result.status).toBe("outside-scope");
    expect(result.editable).toBe(false);
  });

  it("recognizes consecutive passage ranges as one citation", () => {
    const passageRefs = [23, 24, 25].map(ayah => ({ surah: 12, ayah }));
    const passageIndex = indexFor(passageRefs);
    const passageCitation = "[يوسف: 23–25]";
    const result = inspectAdjacentQuranCitation(verse + " " + passageCitation, verse.length, passageCitation, passageRefs, passageIndex);
    expect(result.status).toBe("correct");
  });
});


describe("independent Quran citation operations", () => {
  const verse = "﴿نص الآية﴾";
  const expected = "[النساء: 30]";
  const refs = [{ surah: 4, ayah: 30 }];
  const index = indexFor(refs);
  const options = (addMissing: boolean, correctExisting: boolean) => ({
    addMissing,
    correctExisting
  });

  it("adds a missing citation only when addition is enabled", () => {
    const review = {
      status: "missing" as const,
      expectedCitation: expected,
      separator: "، ",
      editable: true,
      detail: "missing"
    };
    expect(composeQuranCitationReplacement(verse, review, expected, options(true, false)))
      .toBe(`${verse}، ${expected}`);
    expect(composeQuranCitationReplacement(verse, review, expected, options(false, true)))
      .toBe(verse);
    expect(composeQuranCitationReplacement(verse, review, expected, options(false, false)))
      .toBe(verse);
  });

  it("corrects an existing wrong citation only when correction is enabled", () => {
    const wrong = "[يوسف: 3]";
    const review = {
      status: "incorrect" as const,
      expectedCitation: expected,
      existingCitation: wrong,
      separator: "  ",
      editable: true,
      detail: "incorrect"
    };
    expect(composeQuranCitationReplacement(verse, review, expected, options(false, true)))
      .toBe(`${verse}  ${expected}`);
    expect(composeQuranCitationReplacement(verse, review, expected, options(true, false)))
      .toBe(`${verse}  ${wrong}`);
    expect(composeQuranCitationReplacement(verse, review, expected, options(false, false)))
      .toBe(`${verse}  ${wrong}`);
  });

  it("supports enabling addition and correction together without mixing their targets", () => {
    const missing = {
      status: "missing" as const,
      expectedCitation: expected,
      editable: true,
      detail: "missing"
    };
    const wrong = {
      status: "incorrect" as const,
      expectedCitation: expected,
      existingCitation: "[يوسف: 3]",
      separator: " ",
      editable: true,
      detail: "incorrect"
    };
    expect(composeQuranCitationReplacement(verse, missing, expected, options(true, true)))
      .toBe(`${verse} ${expected}`);
    expect(composeQuranCitationReplacement(verse, wrong, expected, options(true, true)))
      .toBe(`${verse} ${expected}`);
  });

  it("does not modify correct, ambiguous, out-of-scope, or unavailable citations", () => {
    const statuses = ["correct", "ambiguous", "outside-scope", "unavailable"] as const;
    for (const status of statuses) {
      const review = {
        status,
        expectedCitation: expected,
        existingCitation: "[يوسف: 3]",
        separator: " ",
        editable: false,
        detail: status
      };
      expect(composeQuranCitationReplacement(verse, review, expected, options(true, true)))
        .toBe(verse);
    }
  });

  it("revalidates the current adjacent citation before correcting it", () => {
    const source = `${verse}، [يوسف: 3]`;
    const wrongIndex = indexFor([...refs, { surah: 12, ayah: 3 }]);
    const result = verifyAndComposeQuranCitationReplacement(
      verse,
      source,
      verse.length,
      expected,
      refs,
      wrongIndex,
      options(false, true)
    );
    expect(result.review.status).toBe("incorrect");
    expect(result.review.existingCitation).toBe("[يوسف: 3]");
    expect(result.replacementText).toBe(`${verse}، ${expected}`);
  });

  it("verifies a missing citation but does not add it when correction alone is enabled", () => {
    const result = verifyAndComposeQuranCitationReplacement(
      verse,
      verse + " ثم",
      verse.length,
      expected,
      refs,
      index,
      options(false, true)
    );
    expect(result.review.status).toBe("missing");
    expect(result.replacementText).toBe(verse);
  });

  it("preserves ambiguous references during the combined verification and correction flow", () => {
    const source = `${verse} [سورة مجهولة: 3]`;
    const result = verifyAndComposeQuranCitationReplacement(
      verse,
      source,
      verse.length,
      expected,
      refs,
      index,
      options(true, true)
    );
    expect(result.review.status).toBe("ambiguous");
    expect(result.replacementText).toBe(verse);
  });

  it("does not invent a citation when the canonical citation is unavailable", () => {
    const review = {
      status: "missing" as const,
      expectedCitation: "",
      editable: false,
      detail: "unavailable"
    };
    expect(composeQuranCitationReplacement(verse, review, undefined, options(true, false)))
      .toBe(verse);
  });
});
