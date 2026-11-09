import { describe, expect, it } from "vitest";
import { formatQuranCitation, hasMatchingQuranCitation } from "../src/word/quran-citation.js";
import type { AyahReference, QuranAyahRecord, QuranIndex } from "../src/core/types.js";

function indexFor(references: AyahReference[]): QuranIndex {
  const records = new Map(references.map(reference => {
    const record: QuranAyahRecord = {
      ...reference,
      id: `${reference.surah}:${reference.ayah}`,
      surahNameArabic: reference.surah === 4 ? "النساء" : "يوسف",
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
