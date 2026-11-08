import { describe, expect, it } from "vitest";
import { findFuzzyTokenAlignments } from "../src/core/alignment.js";
import { QuranAyahDetector } from "../src/core/detector.js";
import { InMemoryQuranIndex } from "../src/core/quran-index.js";
import type { QuranAyahRecord } from "../src/core/types.js";

const records: QuranAyahRecord[] = [
  {
    id: "1:1",
    surah: 1,
    ayah: 1,
    surahNameArabic: "الفاتحة",
    uthmani: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
    imlaei: "بسم الله الرحمن الرحيم"
  },
  {
    id: "1:2",
    surah: 1,
    ayah: 2,
    surahNameArabic: "الفاتحة",
    uthmani: "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ",
    imlaei: "الحمد لله رب العالمين"
  },
  {
    id: "2:255",
    surah: 2,
    ayah: 255,
    surahNameArabic: "البقرة",
    uthmani: "اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ",
    imlaei: "الله لا اله الا هو الحي القيوم"
  }
];

describe("QuranAyahDetector", () => {
  const detector = new QuranAyahDetector(new InMemoryQuranIndex(records));

  it("detects a fully quoted ayah between Quran brackets", () => {
    const text = "قال تعالى ﴿بسم الله الرحمن الرحيم﴾ ثم تابع.";
    const matches = detector.detect(text);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.references).toEqual([{ surah: 1, ayah: 1 }]);
    expect(matches[0]?.matchedText).toBe("بسم الله الرحمن الرحيم");
    expect(text.slice(matches[0]!.sourceStart, matches[0]!.sourceEnd)).toBe(matches[0]?.matchedText);
    expect(matches[0]?.evidence.some(item => item.type === "verse-brackets")).toBe(true);
  });

  it("detects an unmarked exact quotation", () => {
    const text = "ومن ذلك قوله تعالى بسم الله الرحمن الرحيم في افتتاح السورة.";
    const matches = detector.detect(text);
    expect(matches.some(item => item.references[0]?.surah === 1)).toBe(true);
  });

  it("detects a numeric explicit reference beside the quoted text", () => {
    const text = "ومن الآيات الدالة على ذلك قوله تعالى: الله لا اله الا هو الحي القيوم (2:255)";
    const matches = detector.detect(text);
    expect(matches.some(item => item.references.some(ref => ref.surah === 2 && ref.ayah === 255))).toBe(true);
  });

  it("finds more than one unmarked quotation in the same text segment", () => {
    const text = "بسم الله الرحمن الرحيم ثم قال الحمد لله رب العالمين";
    const matches = detector.detect(text);
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(matches.some(item => item.references[0]?.ayah === 1)).toBe(true);
    expect(matches.some(item => item.references[0]?.ayah === 2)).toBe(true);
  });

  it("detects a bracketed ayah when one word is omitted and requests review", () => {
    const text = "قال تعالى ﴿الله لا اله هو الحي القيوم﴾";
    const matches = detector.detect(text);
    const match = matches.find(item => item.references.some(ref => ref.surah === 2 && ref.ayah === 255));
    expect(match).toBeDefined();
    expect(match?.evidence.some(item => item.type === "fuzzy-alignment")).toBe(true);
    expect(match?.status).toBe("needs-review");
  });

  it("does not fuzzy-match a short generic phrase", () => {
    const text = "قال تعالى ﴿الله لا إله﴾";
    const matches = detector.detect(text);
    expect(matches).toHaveLength(0);
  });

  it("marks identical text from different ayahs as ambiguous", () => {
    const duplicateRecords: QuranAyahRecord[] = [
      {
        id: "2:10",
        surah: 2,
        ayah: 10,
        surahNameArabic: "البقرة",
        uthmani: "وَاللَّهُ عَلِيمٌ حَكِيمٌ",
        imlaei: "والله عليم حكيم"
      },
      {
        id: "3:20",
        surah: 3,
        ayah: 20,
        surahNameArabic: "آل عمران",
        uthmani: "وَاللَّهُ عَلِيمٌ حَكِيمٌ",
        imlaei: "والله عليم حكيم"
      }
    ];
    const duplicateDetector = new QuranAyahDetector(new InMemoryQuranIndex(duplicateRecords));
    const matches = duplicateDetector.detect("ومن ذلك قوله: والله عليم حكيم.");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.status).toBe("ambiguous");
    expect(matches[0]?.references).toEqual([
      { surah: 2, ayah: 10 },
      { surah: 3, ayah: 20 }
    ]);
    expect(matches[0]?.canonicalText).toBe("");
  });

  it("does not create a match for unrelated text", () => {
    expect(detector.detect("هذا نص عربي عادي لا يتضمن اقتباسا قرآنيا.")).toHaveLength(0);
  });
});

describe("fuzzy token alignment", () => {
  it("finds a quotation with one omitted word", () => {
    const source = "ومن الآيات قوله تعالى الله لا اله هو الحي القيوم في هذا الموضع";
    const matches = findFuzzyTokenAlignments(source, "الله لا اله الا هو الحي القيوم", {
      maxDistance: 1,
      minimumTokens: 5
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.distance).toBe(1);
    expect(source.slice(matches[0]!.sourceStart, matches[0]!.sourceEnd)).toBe("الله لا اله هو الحي القيوم");
  });
});
