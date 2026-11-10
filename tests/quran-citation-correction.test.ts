import { describe, expect, it } from "vitest";
import { analyzeCitationText, suggestExactAyahCitation } from "../src/word/quran-citation-correction.js";
import type { QuranAyahRecord, QuranIndex } from "../src/core/types.js";
import { validateQuranCitations } from "../src/word/citation-validator.js";

function makeIndex(): QuranIndex {
  const records: QuranAyahRecord[] = [
    { surah: 1, ayah: 1, id: "1:1", surahNameArabic: "الفاتحة", uthmani: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ", imlaei: "بسم الله الرحمن الرحيم" },
    { surah: 1, ayah: 2, id: "1:2", surahNameArabic: "الفاتحة", uthmani: "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ", imlaei: "الحمد لله رب العالمين" },
    { surah: 2, ayah: 1, id: "2:1", surahNameArabic: "البقرة", uthmani: "الم", imlaei: "الم" }
  ];
  return { get: r => records.find(x => x.surah === r.surah && x.ayah === r.ayah), search: () => [], all: () => records, size: records.length };
}

describe("text-grounded citation correction", () => {
  it("suggests the unique reference when a complete bracketed ayah has a wrong citation", () => {
    const index = makeIndex();
    const paragraph = "قال تعالى ﴿بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ﴾ [البقرة: 1]";
    const issues = validateQuranCitations(paragraph, index);
    const result = analyzeCitationText(paragraph, issues, index);
    expect(result[0]?.status).toBe("mismatch");
    expect(result[0]?.suggestedCitation).toBe("[الفاتحة: 1]");
  });

  it("does not suggest a correction for partial quotations", () => {
    const index = makeIndex();
    const paragraph = "قال تعالى ﴿بسم الله﴾ [البقرة: 1]";
    const issue = validateQuranCitations(paragraph, index)[0]!;
    expect(suggestExactAyahCitation(paragraph, issue, index)).toBeUndefined();
  });

  it("does not suggest a correction when the complete text agrees with the citation", () => {
    const index = makeIndex();
    const paragraph = "قال تعالى ﴿بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ﴾ [الفاتحة: 1]";
    const issue = validateQuranCitations(paragraph, index)[0]!;
    expect(suggestExactAyahCitation(paragraph, issue, index)).toBeUndefined();
  });

  it("does not guess when the same normalized text belongs to multiple ayahs", () => {
    const records = [...makeIndex().all(), { surah: 2, ayah: 2, id: "2:2", surahNameArabic: "البقرة", uthmani: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ", imlaei: "بسم الله الرحمن الرحيم" }];
    const index: QuranIndex = { get: r => records.find(x => x.surah === r.surah && x.ayah === r.ayah), search: () => [], all: () => records, size: records.length };
    const paragraph = "قال تعالى ﴿بسم الله الرحمن الرحيم﴾ [البقرة: 1]";
    const issue = validateQuranCitations(paragraph, index)[0]!;
    expect(suggestExactAyahCitation(paragraph, issue, index)).toBeUndefined();
  });
});
