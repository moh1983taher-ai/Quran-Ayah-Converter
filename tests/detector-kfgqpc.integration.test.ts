import { describe, expect, it } from "vitest";
import { QuranAyahDetector } from "../src/core/detector.js";
import { InMemoryQuranIndex } from "../src/core/quran-index.js";
import { createReviewItems } from "../src/word/review-workflow.js";
import { kfgqpcHafsSamples } from "./fixtures/kfgqpc-hafs-samples.js";
import type { QuranAyahRecord } from "../src/core/types.js";

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
    expect(match?.canonicalText).toBe(kfgqpcHafsSamples.find(record => record.surah === 114 && record.ayah === 6)?.uthmani);
  });
  it("detects Al-Baqarah 2:90 despite Uthmani small-letter and diacritic differences", () => {
    const verse: QuranAyahRecord = {
      id: "2:90", surah: 2, ayah: 90, surahNameArabic: "البقرة",
      uthmani: "بِئۡسَمَا ٱشۡتَرَوۡاْ بِهِۦٓ أَنفُسَهُمۡ أَن يَكۡفُرُواْ بِمَآ أَنزَلَ ٱللَّهُ بَغۡيًا أَن يُنَزِّلَ ٱللَّهُ مِن فَضۡلِهِۦ عَلَىٰ مَن يَشَآءُ مِنۡ عِبَادِهِۦۖ فَبَآءُو بِغَضَبٍ عَلَىٰ غَضَبٖۚ وَلِلۡكَٰفِرِينَ عَذَابٞ مُّهِينٞ",
      imlaei: "بئسما اشتروا به أنفسهم أن يكفروا بما أنزل الله بغيا أن ينزل الله من فضله على من يشاء من عباده فباءوا بغضب على غضب وللكافرين عذاب مهين"
    };
    const detector = new QuranAyahDetector(new InMemoryQuranIndex([verse]));
    const quote = "بِئْسَمَا اشْتَرَوْا بِهِ أَنفُسَهُمْ أَن يَكْفُرُواْ بِمَا أَنزَلَ اللَّهُ بَغْيًا أَن يُنَزِّلَ اللَّهُ مِن فَضْلِهِ عَلَى مَن يَشَاء مِنْ عِبَادِهِ فَبَاؤُواْ بِغَضَبٍ عَلَى غَضَبٍ وَلِلْكَافِرِينَ عَذَابٌ مُّهِينٌ";
    const text = "قال تعالى ﴿" + quote + "﴾ [البقرة: ٩٠]";
    const match = detector.detect(text).find(item =>
      item.references.some(reference => reference.surah === 2 && reference.ayah === 90)
    );
    expect(match).toBeDefined();
    expect(match?.status).not.toBe("ambiguous");
    expect(text.slice(match!.sourceStart, match!.sourceEnd)).toBe("﴿" + quote + "﴾");
    expect(match?.canonicalText).toBe(verse.uthmani);
  });

  it("detects a repeated three-ayah passage using its explicit range and creates one review card", () => {
    const quote = "وَالَّذِينَ هُمْ لِفُرُوجِهِمْ حَافِظُونَ \\* إِلاَّ عَلَى أَزْوَاجِهِمْ أَوْ مَا مَلَكَتْ أَيْمَانُهُمْ فَإِنَّهُمْ غَيْرُ مَلُومِينَ \\* فَمَنِ ابْتَغَى وَرَاء ذَلِكَ فَأُولَئِكَ هُمُ الْعَادُونَ";
    const text = `قال تعالى: ﴿${quote}﴾ [المؤمنون: ٥-٧]`;
    const matches = detector.detect(text);
    const passage = matches.find(item =>
      item.references.length === 3 &&
      item.references[0]?.surah === 23 &&
      item.references[0]?.ayah === 5
    );

    expect(passage).toBeDefined();
    expect(passage?.references).toEqual([
      { surah: 23, ayah: 5 },
      { surah: 23, ayah: 6 },
      { surah: 23, ayah: 7 }
    ]);
    expect(text.slice(passage!.sourceStart, passage!.sourceEnd)).toBe(`﴿${quote}﴾`);
    expect(passage?.replacementText).toContain("وَٱلَّذِينَ");
    expect(createReviewItems(text, matches)).toHaveLength(1);
  });

  it("uses the explicit reference to distinguish the same passage repeated in Al-Maarij", () => {
    const quote = "والذين هم لفروجهم حافظون \\* إلا على أزواجهم أو ما ملكت أيمانهم فإنهم غير ملومين \\* فمن ابتغى وراء ذلك فأولئك هم العادون";
    const text = `﴿${quote}﴾ [المعارج: ٢٩-٣١]`;
    const passage = detector.detect(text).find(item =>
      item.references.some(ref => ref.surah === 70 && ref.ayah === 29)
    );
    expect(passage?.references).toEqual([
      { surah: 70, ayah: 29 },
      { surah: 70, ayah: 30 },
      { surah: 70, ayah: 31 }
    ]);
    expect(createReviewItems(text, detector.detect(text))).toHaveLength(1);
  });

  it("does not choose between repeated multi-ayah passages when the explicit range is absent", () => {
    const quote = "والذين هم لفروجهم حافظون \\* إلا على أزواجهم أو ما ملكت أيمانهم فإنهم غير ملومين \\* فمن ابتغى وراء ذلك فأولئك هم العادون";
    const matches = detector.detect(`﴿${quote}﴾`);
    expect(matches.every(item => item.status === "ambiguous")).toBe(true);
  });

});
