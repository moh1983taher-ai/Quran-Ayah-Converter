import { describe, expect, it } from "vitest";
import { QuranAyahDetector } from "../src/core/detector.js";
import { InMemoryQuranIndex } from "../src/core/quran-index.js";
import { kfgqpcHafsSamples } from "./fixtures/kfgqpc-hafs-samples.js";

describe("QuranAyahDetector with real KFGQPC Hafs v18 records", () => {
  const detector = new QuranAyahDetector(new InMemoryQuranIndex(kfgqpcHafsSamples));

  it("detects a fully vocalized Qur'an-bracketed passage and maps the exact source range", () => {
    const quote = "بسم الله الرحمن الرحيم";
    const text = `قال تعالى ﴿${quote}﴾ ثم تابع الباحث كلامه.`;
    const match = detector.detect(text).find(item => item.references[0]?.surah === 1 && item.references[0]?.ayah === 1);
    expect(match).toBeDefined();
    expect(text.slice(match!.sourceStart, match!.sourceEnd)).toBe(`﴿${quote}﴾`);
    expect(match?.canonicalText).toBe(kfgqpcHafsSamples[0]?.uthmani);
  });

  it("detects Ayat al-Kursi by its full text beside a named surah reference", () => {
    const quote = kfgqpcHafsSamples[2]!.imlaei;
    const text = `ومن ذلك قوله تعالى: ﴿${quote}﴾ (البقرة: 255).`;
    const match = detector.detect(text).find(item => item.references.some(ref => ref.surah === 2 && ref.ayah === 255));
    expect(match).toBeDefined();
    expect(text.slice(match!.sourceStart, match!.sourceEnd)).toBe(`﴿${quote}﴾`);
    expect(match?.canonicalText).toBe(kfgqpcHafsSamples[2]?.uthmani);
  });

  it("detects two consecutive ayahs as one passage without swallowing surrounding prose", () => {
    const quote = "بسم الله الرحمن الرحيم الحمد لله رب العالمين";
    const text = `افتتح المؤلف كلامه بقوله: ${quote}، ثم انتقل إلى موضوع آخر.`;
    const match = detector.detect(text).find(item => item.references.length === 2);
    expect(match).toBeDefined();
    expect(match?.references).toEqual([{ surah: 1, ayah: 1 }, { surah: 1, ayah: 2 }]);
    expect(text.slice(match!.sourceStart, match!.sourceEnd)).toBe(quote);
  });

  it("does not treat an ordinary phrase as a Qur'anic quotation merely because it is Arabic", () => {
    const text = "هذا تحليل لغوي يتناول دلالة الألفاظ في سياقها التاريخي.";
    expect(detector.detect(text)).toHaveLength(0);
  });

  it("retains the final surah and ayah identity from the imported data", () => {
    const text = "ومن ألفاظ القرآن: من الجنة والناس.";
    const match = detector.detect(text).find(item => item.references.some(ref => ref.surah === 114 && ref.ayah === 6));
    expect(match).toBeDefined();
    expect(match?.canonicalText).toBe(kfgqpcHafsSamples[4]?.uthmani);
  });
});
