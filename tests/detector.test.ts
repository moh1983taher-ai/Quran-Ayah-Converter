import { describe, expect, it } from "vitest";
import { findFuzzyTokenAlignments } from "../src/core/alignment.js";
import { QuranAyahDetector } from "../src/core/detector.js";
import { InMemoryQuranIndex } from "../src/core/quran-index.js";
import type { QuranAyahRecord } from "../src/core/types.js";
import { normalizeArabic } from "../src/core/normalizer.js";

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

  it("matches Al-Nahl 114 when the Uthmani dagger alif represents an imlaei alif", () => {
    const ayahRecord: QuranAyahRecord = {
      id: "16:114",
      surah: 16,
      ayah: 114,
      surahNameArabic: "النحل",
      imlaei: "فكلوا مما رزقكم الله حلالا طيبا واشكروا نعمة الله ان كنتم اياه تعبدون",
      uthmani: "فَكُلُواْ مِمَّا رَزَقَكُمُ ٱللَّهُ حَلَٰلٗا طَيِّبٗا وَٱشْكُرُواْ نِعْمَتَ ٱللَّهِ إِن كُنْتُمۡ إِيَّاهُ تَعْبُدُونَ"
    };
    const localDetector = new QuranAyahDetector(new InMemoryQuranIndex([ayahRecord]));
    const source = "﴿فَكُلُوا مِمَّا رَزَقَكُمُ اللَّهُ حَلَالًا طَيِّبًا وَاشْكُرُوا نِعْمَتَ اللَّهِ إِنْ كُنْتُمْ إِيَّاهُ تَعْبُدُونَ ﴾";
    const matches = localDetector.detect(source);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.references).toEqual([{ surah: 16, ayah: 114 }]);
    expect(matches[0]?.matchedText).toBe(source);
    expect(matches[0]?.replacementText).toContain("حَلَٰلٗا");

    const daggerSource = "﴿فَكُلُوا مِمَّا رَزَقَكُمُ اللَّهُ حَلَٰلٗا طَيِّبٗا وَاشْكُرُوا نِعْمَتَ اللَّهِ إِنْ كُنْتُمْ إِيَّاهُ تَعْبُدُونَ﴾";
    const daggerMatches = localDetector.detect(daggerSource);
    expect(daggerMatches).toHaveLength(1);
    expect(daggerMatches[0]?.references).toEqual([{ surah: 16, ayah: 114 }]);
  });

  it("matches the supplied Al-Baqarah 90 quotation across Uthmani alif-of-waw spelling", () => {
    const ayahRecord: QuranAyahRecord = {
      id: "2:90",
      surah: 2,
      ayah: 90,
      surahNameArabic: "البقرة",
      imlaei: "بئسما اشتروا به انفسهم ان يكفروا بما انزل الله بغيا ان ينزل الله من فضله على من يشاء من عباده فباؤوا بغضب على غضب وللكافرين عذاب مهين",
      uthmani: "بِئْسَمَا اشْتَرَوْا بِهِ أَنفُسَهُمْ أَن يَكْفُرُواْ بِمَا أَنزَلَ اللَّهُ بَغْيًا أَن يُنَزِّلَ اللَّهُ مِن فَضْلِهِ عَلَى مَن يَشَاءُ مِنْ عِبَادِهِ فَبَآءُو بِغَضَبٍ عَلَىٰ غَضَبٍ وَلِلْكَافِرِينَ عَذَابٌ مُّهِينٌ"
    };
    const localDetector = new QuranAyahDetector(new InMemoryQuranIndex([ayahRecord]));
    const source = "﴿بِئْسَمَا اشْتَرَوْا بِهِ أَنفُسَهُمْ أَن يَكْفُرُواْ بِمَا أَنزَلَ اللَّهُ بَغْيًا أَن يُنَزِّلَ اللَّهُ مِن فَضْلِهِ عَلَى مَن يَشَاء مِنْ عِبَادِهِ فَبَاؤُواْ بِغَضَبٍ عَلَى غَضَبٍ وَلِلْكَافِرِينَ عَذَابٌ مُّهِينٌ﴾";
    const matches = localDetector.detect(source);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.references).toEqual([{ surah: 2, ayah: 90 }]);
    expect(matches[0]?.matchedText).toBe(source);
    expect(matches[0]?.replacementText).toBeDefined();
  });

  it("detects a fully quoted ayah between Quran brackets", () => {
    const text = "قال تعالى ﴿بسم الله الرحمن الرحيم﴾ ثم تابع.";
    const matches = detector.detect(text);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.references).toEqual([{ surah: 1, ayah: 1 }]);
    expect(matches[0]?.matchedText).toBe("﴿بسم الله الرحمن الرحيم﴾");
    expect(text.slice(matches[0]!.sourceStart, matches[0]!.sourceEnd)).toBe(matches[0]?.matchedText);
    expect(matches[0]?.evidence.some(item => item.type === "verse-brackets")).toBe(true);
  });

  it("includes ornamental and legacy brackets when harmless padding surrounds a full ayah", () => {
    const examples = [
      "قال ﴿  بسم الله الرحمن الرحيم  ﴾",
      "قال بسم الله الرحمن الرحيم"
    ];
    for (const text of examples) {
      const matches = detector.detect(text);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.matchedText).toBe(text.slice(text.indexOf(text.includes("") ? "" : "﴿")));
      expect(text.slice(matches[0]!.sourceStart, matches[0]!.sourceEnd)).toBe(matches[0]?.matchedText);
      expect(matches[0]?.references).toEqual([{ surah: 1, ayah: 1 }]);
    }
  });

  it("detects multi-ayah passages inside every supported legacy bracket pair as one match", () => {
    const pairs = [
      ["ﭽ", "ﭼ"], ["ﭿ", "ﭾ"], ["ﮁ", "ﮀ"], ["ﮃ", "ﮂ"],
      ["ﮅ", "ﮄ"], ["ﮇ", "ﮆ"], ["ﮉ", "ﮈ"], ["ﮋ", "ﮊ"], ["ﵡ", "ﵠ"]
    ] as const;
    const passage = "بسم الله الرحمن الرحيم ۝١ * الحمد لله رب العالمين ۝٢";
    for (const [open, close] of pairs) {
      const text = `قبل ${open}${passage}${close} بعد`;
      const matches = detector.detect(text);
      expect(matches).toHaveLength(1);
      expect(matches[0]?.references).toEqual([
        { surah: 1, ayah: 1 },
        { surah: 1, ayah: 2 }
      ]);
      expect(matches[0]?.matchedText).toBe(`${open}${passage}${close}`);
    }
  });

  it("detects consecutive ayahs separated by verse markers and stars as one bracketed match", () => {
    const text = "قال تعالى ﴿بسم الله الرحمن الرحيم ۝١ * الحمد لله رب العالمين ۝٢﴾";
    const matches = detector.detect(text);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.references).toEqual([
      { surah: 1, ayah: 1 },
      { surah: 1, ayah: 2 }
    ]);
    expect(matches[0]?.matchedText).toBe("﴿بسم الله الرحمن الرحيم ۝١ * الحمد لله رب العالمين ۝٢﴾");
    expect(matches[0]?.replacementText).toContain("۝١ * ");
    expect(matches[0]?.replacementText).toContain("۝٢");
  });

  it("keeps Arabic punctuation between consecutive ayahs inside the same passage", () => {
    const text = "قال تعالى ﴿بسم الله الرحمن الرحيم، الحمد لله رب العالمين﴾";
    const matches = detector.detect(text);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.references).toEqual([
      { surah: 1, ayah: 1 },
      { surah: 1, ayah: 2 }
    ]);
    expect(matches[0]?.matchedText).toBe("﴿بسم الله الرحمن الرحيم، الحمد لله رب العالمين﴾");
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

  it("detects a Qur'anic bracketed verse containing an Allah presentation ligature", () => {
    const text = "قال تعالى ﴿ﷲ لا اله الا هو الحي القيوم﴾";
    const match = detector.detect(text).find(item =>
      item.references.some(reference => reference.surah === 2 && reference.ayah === 255)
    );
    expect(match).toBeDefined();
    expect(text.slice(match!.sourceStart, match!.sourceEnd)).toBe("﴿ﷲ لا اله الا هو الحي القيوم﴾");
  });

  it("detects the supplied short excerpts in their correct Qur'anic contexts", () => {
    const contextRecords: QuranAyahRecord[] = [
      {
        id: "35:12", surah: 35, ayah: 12, surahNameArabic: "فاطر",
        uthmani: "وَمَا يَسْتَوِي الْبَحْرَانِ هَٰذَا عَذْبٌ فُرَاتٌ سَائِغٌ شَرَابُهُ وَهَٰذَا مِلْحٌ أُجَاجٌ وَمِن كُلٍّ تَأْكُلُونَ لَحْمًا طَرِيًّا وَتَسْتَخْرِجُونَ حِلْيَةً تَلْبَسُونَهَا وَتَرَى الْفُلْكَ فِيهِ مَوَاخِرَ لِتَبْتَغُوا مِن فَضْلِهِ وَلَعَلَّكُمْ تَشْكُرُونَ",
        imlaei: "وما يستوي البحران هذا عذب فرات سائغ شرابه وهذا ملح اجاج ومن كل تاكلون لحما طريا وتستخرجون حلية تلبسونها وترى الفلك فيه مواخر لتبتغوا من فضله ولعلكم تشكرون"
      },
      {
        id: "23:19", surah: 23, ayah: 19, surahNameArabic: "المؤمنون",
        uthmani: "فَأَنشَأْنَا لَكُم بِهِ جَنَّاتٍ مِّن نَّخِيلٍ وَأَعْنَابٍ لَّكُمْ فِيهَا فَوَاكِهُ كَثِيرَةٌ وَمِنْهَا تَأْكُلُونَ",
        imlaei: "فانشانا لكم به جنات من نخيل واعناب لكم فيها فواكه كثيرة ومنها تاكلون"
      },
      {
        id: "23:21", surah: 23, ayah: 21, surahNameArabic: "المؤمنون",
        uthmani: "وَإِنَّ لَكُمْ فِي الْأَنْعَامِ لَعِبْرَةً نُّسْقِيكُم مِّمَّا فِي بُطُونِهَا وَلَكُمْ فِيهَا مَنَافِعُ كَثِيرَةٌ وَمِنْهَا تَأْكُلُونَ",
        imlaei: "وان لكم في الانعام لعبرة نسقيكم مما في بطونها ولكم فيها منافع كثيرة ومنها تاكلون"
      },
      {
        id: "36:34", surah: 36, ayah: 34, surahNameArabic: "يس",
        uthmani: "وَجَعَلْنَا فِيهَا جَنَّاتٍ مِّن نَّخِيلٍ وَأَعْنَابٍ وَفَجَّرْنَا فِيهَا مِنَ الْعُيُونِ",
        imlaei: "وجعلنا فيها جنات من نخيل واعناب وفجرنا فيها من العيون"
      },
      {
        id: "16:69", surah: 16, ayah: 69, surahNameArabic: "النحل",
        uthmani: "ثُمَّ كُلِي مِن كُلِّ الثَّمَرَاتِ فَاسْلُكِي سُبُلَ رَبِّكِ ذُلُلًا يَخْرُجُ مِن بُطُونِهَا شَرَابٌ مُّخْتَلِفٌ أَلْوَانُهُ فِيهِ شِفَاءٌ لِّلنَّاسِ إِنَّ فِي ذَٰلِكَ لَآيَةً لِّقَوْمٍ يَتَفَكَّرُونَ",
        imlaei: "ثم كلي من كل الثمرات فاسلكي سبل ربك ذللا يخرج من بطونها شراب مختلف الوانه فيه شفاء للناس ان في ذلك لاية لقوم يتفكرون"
      }
    ];
    const contextDetector = new QuranAyahDetector(new InMemoryQuranIndex(contextRecords));
    const examples: Array<{ quote: string; surah: number; ayah: number; ambiguous?: boolean; repeated?: boolean }> = [
      { quote: "وَمَا يَسْتَوِي الْبَحْرَانِ", surah: 35, ayah: 12 },
      { quote: "مِّن نَّخِيلٍ وَأَعْنَابٍ", surah: 23, ayah: 19, repeated: true },
      { quote: "وَمِنْهَا تَأْكُلُونَ", surah: 23, ayah: 19, repeated: true },
      { quote: "فَأَنشَأْنَا", surah: 23, ayah: 19 },
      { quote: "لَّكُمْ فِيهَا", surah: 23, ayah: 19, ambiguous: true },
      { quote: "فَاسْلُكِي سُبُلَ رَبِّكِ ذُلُلً", surah: 16, ayah: 69 }
    ];

    for (const example of examples) {
      const text = `شرح ﴿${example.quote}﴾ ثم متابعة`;
      const match = contextDetector.detect(text).find(item =>
        item.references.some(reference =>
          reference.surah === example.surah && reference.ayah === example.ayah
        )
      );
      expect(match, example.quote).toBeDefined();
      expect(text.slice(match!.sourceStart, match!.sourceEnd)).toBe(`﴿${example.quote}﴾`);
      if (example.ambiguous) {
        expect(match?.references).toContainEqual({ surah: 23, ayah: 21 });
        expect(match?.status).toBe("ambiguous");
        expect(match?.replacementText).toBeUndefined();
      } else if (example.repeated) {
        expect(match?.references.length).toBeGreaterThan(1);
        expect(match?.status).toBe("high-confidence");
        expect(match?.replacementText).toBeDefined();
        expect(match?.evidence.some(item =>
          item.type === "context" && item.detail.includes("الرسم العثماني متطابق")
        )).toBe(true);
      } else {
        expect(match?.status).not.toBe("ambiguous");
        expect(match?.replacementText).toBeDefined();
      }
    }
  });

  it("does not consume an attached conjunction outside the quoted excerpt", () => {
    const verse: QuranAyahRecord = {
      id: "23:21", surah: 23, ayah: 21, surahNameArabic: "المؤمنون",
      uthmani: "وَإِنَّ لَكُمْ فِي الْأَنْعَامِ لَعِبْرَةً نُّسْقِيكُم مِّمَّا فِي بُطُونِهَا وَلَكُمْ فِيهَا مَنَافِعُ كَثِيرَةٌ وَمِنْهَا تَأْكُلُونَ",
      imlaei: "وان لكم في الانعام لعبرة نسقيكم مما في بطونها ولكم فيها منافع كثيرة ومنها تاكلون"
    };
    const singleVerseDetector = new QuranAyahDetector(new InMemoryQuranIndex([verse]));
    const text = "شرح ﴿لَّكُمْ فِيهَا﴾";
    const match = singleVerseDetector.detect(text)[0];

    expect(match).toBeDefined();
    expect(normalizeArabic(match!.replacementText ?? "")).toBe(normalizeArabic("لَكُمْ فِيهَا"));
    expect(normalizeArabic(match!.replacementText ?? "")).not.toBe(normalizeArabic("وَلَكُمْ فِيهَا"));
  });

  it("detects exact contiguous excerpts inside longer bracketed ayahs", () => {
    const excerptRecords: QuranAyahRecord[] = [
      {
        id: "16:10",
        surah: 16,
        ayah: 10,
        surahNameArabic: "النحل",
        uthmani: "هُوَ الَّذِي أَنزَلَ مِنَ السَّمَاءِ مَاءً لَّكُم مِّنْهُ شَرَابٌ وَمِنْهُ شَجَرٌ فِيهِ تُسِيمُونَ",
        imlaei: "هو الذي أنزل من السماء ماء لكم منه شراب ومنه شجر فيه تسيمون"
      },
      {
        id: "16:11",
        surah: 16,
        ayah: 11,
        surahNameArabic: "النحل",
        uthmani: "يُنبِتُ لَكُم بِهِ الزَّرْعَ وَالزَّيْتُونَ وَالنَّخِيلَ وَالْأَعْنَابَ وَمِن كُلِّ الثَّمَرَاتِ",
        imlaei: "ينبت لكم به الزرع والزيتون والنخيل والأعناب ومن كل الثمرات"
      }
    ];
    const excerptDetector = new QuranAyahDetector(new InMemoryQuranIndex(excerptRecords));
    const quotations: Array<[string, number]> = [
      ["لكم منه شراب", 10],
      ["ومنه شجر", 10],
      ["فيه تسيمون", 10],
      ["ينبت لكم به الزرع والزيتون والنخيل والأعناب ومن كل الثمرات", 11]
    ];

    for (const [quotation, ayah] of quotations) {
      const matches = excerptDetector.detect(`شرح ﴿${quotation}﴾ ثم متابعة`);
      const match = matches.find(item =>
        item.references.some(reference => reference.surah === 16 && reference.ayah === ayah)
      );
      expect(match, quotation).toBeDefined();
      const expectedExcerpt = quotation === "لكم منه شراب" ? "لَّكُم مِّنْهُ شَرَابٌ" :
        quotation === "ومنه شجر" ? "وَمِنْهُ شَجَرٌ" :
        quotation === "فيه تسيمون" ? "فِيهِ تُسِيمُونَ" :
        "يُنبِتُ لَكُم بِهِ الزَّرْعَ وَالزَّيْتُونَ وَالنَّخِيلَ وَالْأَعْنَابَ وَمِن كُلِّ الثَّمَرَاتِ";
      expect(normalizeArabic(match!.replacementText ?? match!.canonicalText)).toBe(normalizeArabic(expectedExcerpt));
      expect(normalizeArabic(match!.canonicalText)).toBe(normalizeArabic(excerptRecords[ayah === 10 ? 0 : 1]!.uthmani));
    }
  });

  it("detects a near-exact bracketed excerpt within a longer ayah and keeps it for review", () => {
    const excerptRecords: QuranAyahRecord[] = [
      {
        id: "16:10",
        surah: 16,
        ayah: 10,
        surahNameArabic: "النحل",
        uthmani: "هُوَ الَّذِي أَنزَلَ مِنَ السَّمَاءِ مَاءً لَّكُم مِّنْهُ شَرَابٌ وَمِنْهُ شَجَرٌ فِيهِ تُسِيمُونَ",
        imlaei: "هو الذي أنزل من السماء ماء لكم منه شراب ومنه شجر فيه تسيمون"
      }
    ];
    const excerptDetector = new QuranAyahDetector(new InMemoryQuranIndex(excerptRecords));
    const text = "شرح ﴿هو الذي أنزل السماء ماء لكم منه شراب﴾ ثم متابعة";
    const match = excerptDetector.detect(text).find(item =>
      item.references.some(reference => reference.surah === 16 && reference.ayah === 10)
    );

    expect(match).toBeDefined();
    expect(match?.status).toBe("needs-review");
    expect(match?.evidence.some(item => item.type === "fuzzy-alignment")).toBe(true);
    expect(text.slice(match!.sourceStart, match!.sourceEnd)).toBe("﴿هو الذي أنزل السماء ماء لكم منه شراب﴾");
    expect(normalizeArabic(match!.replacementText ?? "")).toBe(
      normalizeArabic("هُوَ الَّذِي أَنزَلَ مِنَ السَّمَاءِ مَاءً لَّكُم مِّنْهُ شَرَابٌ")
    );
  });

  it("keeps a short repeated excerpt in adjacent ayahs ambiguous instead of expanding it to both full ayahs", () => {
    const womenVerses: QuranAyahRecord[] = [
      {
        id: "4:22",
        surah: 4,
        ayah: 22,
        surahNameArabic: "النساء",
        uthmani: "وَلَا تَنكِحُواْ مَا نَكَحَ ءَابَآؤُكُم مِّنَ ٱلنِّسَاءِ إِلَّا مَا قَدۡ سَلَفَۚ إِنَّهُۥ كَانَ فَٰحِشَةٗ وَمَقۡتٗا وَسَآءَ سَبِيلًا ٢٢",
        imlaei: "ولا تنكحوا ما نكح اباؤكم من النساء الا ما قد سلف انه كان فاحشة ومقتا وساء سبيلا"
      },
      {
        id: "4:23",
        surah: 4,
        ayah: 23,
        surahNameArabic: "النساء",
        uthmani: "حُرِّمَتۡ عَلَيۡكُمۡ أُمَّهَٰتُكُمۡ وَبَنَاتُكُمۡ وَأَخَوَٰتُكُمۡ وَعَمَّٰتُكُمۡ وَخَٰلَٰتُكُمۡ وَبَنَاتُ ٱلۡأَخِ وَبَنَاتُ ٱلۡأُخۡتِ وَأُمَّهَٰتُكُمُ ٱلَّٰتِيٓ أَرۡضَعۡنَكُمۡ وَأَخَوَٰتُكُم مِّنَ ٱلرَّضَاعَةِ وَأُمَّهَٰتُ نِسَآئِكُمۡ وَرَبَٰٓئِبُكُمُ ٱلَّٰتِي فِي حُجُورِكُم مِّن نِّسَآئِكُمُ ٱلَّٰتِي دَخَلۡتُم بِهِنَّ فَإِن لَّمۡ تَكُونُواْ دَخَلۡتُم بِهِنَّ فَلَا جُنَاحَ عَلَيۡكُمۡ وَحَلَٰٓئِلُ أَبۡنَآئِكُمُ ٱلَّذِينَ مِنۡ أَصۡلَٰبِكُمۡ وَأَن تَجْمَعُواْ بَيۡنَ ٱلۡأُخۡتَيۡنِ إِلَّا مَا قَدۡ سَلَفَۗ إِنَّ ٱللَّهَ كَانَ غَفُورٗا رَّحِيمٗا ٢٣",
        imlaei: "حرمت عليكم امهاتكم وبناتكم واخواتكم وعماتكم وخالاتكم وبنات الاخ وبنات الاخت وامهاتكم اللاتي ارضعنكم واخواتكم من الرضاعة وامهات نسائكم وربائبكم اللاتي في حجوركم من نسائكم اللاتي دخلتم بهن فان لم تكونوا دخلتم بهن فلا جناح عليكم وحلائل ابنائكم الذين من اصلابكم وان تجمعوا بين الاختين الا ما قد سلف ان الله كان غفورا رحيما"
      }
    ];
    const repeatedDetector = new QuranAyahDetector(new InMemoryQuranIndex(womenVerses));
    const quote = "إِلَّا مَا قَدْ سَلَف";
    const text = `قال تعالى ﴿${quote}﴾`;
    const matches = repeatedDetector.detect(text);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.references).toEqual([
      { surah: 4, ayah: 22 },
      { surah: 4, ayah: 23 }
    ]);
    expect(matches[0]?.status).toBe("ambiguous");
    expect(matches[0]?.replacementText).toBeUndefined();
    expect(matches[0]?.canonicalText).toBe("");
  });

  it("does not guess the identity of a repeated short bracketed excerpt", () => {
    const repeatedRecords: QuranAyahRecord[] = [
      {
        id: "2:1", surah: 2, ayah: 1, surahNameArabic: "البقرة",
        uthmani: "وَاللَّهُ عَلِيمٌ حَكِيمٌ", imlaei: "والله عليم حكيم"
      },
      {
        id: "3:1", surah: 3, ayah: 1, surahNameArabic: "آل عمران",
        uthmani: "وَاللَّهُ عَلِيمٌ حَكِيمٌ", imlaei: "والله عليم حكيم"
      }
    ];
    const repeatedDetector = new QuranAyahDetector(new InMemoryQuranIndex(repeatedRecords));
    const matches = repeatedDetector.detect("قال ﴿عليم حكيم﴾");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.status).toBe("high-confidence");
    expect(matches[0]?.references).toEqual([
      { surah: 2, ayah: 1 },
      { surah: 3, ayah: 1 }
    ]);
    expect(normalizeArabic(matches[0]?.replacementText ?? "")).toBe(normalizeArabic("عَلِيمٌ حَكِيمٌ"));
    expect(matches[0]?.evidence.some(item =>
      item.type === "context" && item.detail.includes("الرسم العثماني متطابق")
    )).toBe(true);
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

  it("exposes cumulative stage diagnostics without changing detection results", () => {
    const measuredDetector = new QuranAyahDetector(new InMemoryQuranIndex(records));
    const matches = measuredDetector.detect("قال تعالى: بسم الله الرحمن الرحيم.");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.references).toEqual([{ surah: 1, ayah: 1 }]);
    const diagnostics = measuredDetector.getDiagnostics();
    expect(diagnostics.detectCalls).toBe(1);
    expect(diagnostics.fuzzyCandidateRecords).toBeGreaterThanOrEqual(0);
    expect(diagnostics.fuzzyAlignmentCalls).toBeGreaterThanOrEqual(0);
    expect(diagnostics.exactPassageMs).toBeGreaterThanOrEqual(0);
    expect(diagnostics.fuzzyPassageMs).toBeGreaterThanOrEqual(0);
    expect(diagnostics.overlapResolutionMs).toBeGreaterThanOrEqual(0);
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
  it("skips fuzzy alignment when token overlap cannot meet the edit-distance bound", () => {
    const sparseRecord: QuranAyahRecord = {
      id: "9:1", surah: 9, ayah: 1, surahNameArabic: "التوبة",
      uthmani: "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ الرَّحْمَٰنِ الرَّحِيمِ مَالِكِ يَوْمِ الدِّينِ",
      imlaei: "الحمد لله رب العالمين الرحمن الرحيم مالك يوم الدين"
    };
    const sparseDetector = new QuranAyahDetector(new InMemoryQuranIndex([sparseRecord]));
    const matches = sparseDetector.detect("شرح ﴿الحمد نص عربي مختلف تماما لا يشبه بقية الآية﴾");
    expect(matches).toHaveLength(0);
    expect(sparseDetector.getDiagnostics().fuzzyAlignmentCalls).toBe(0);
  });

});


describe("multi-ayah bracketed excerpt continuity", () => {
  it("recognizes a complete bracketed passage spanning consecutive ayahs with يا آدم spacing normalization", () => {
    const passageRecords: QuranAyahRecord[] = [
      {
        id: "2:35", surah: 2, ayah: 35, surahNameArabic: "البقرة",
        uthmani: "وَقُلْنَا يَٰٓـَٔادَمُ اسْكُنْ أَنتَ وَزَوْجُكَ الْجَنَّةَ وَكُلَا مِنْهَا رَغَدًا حَيْثُ شِئْتُمَا وَلَا تَقْرَبَا هَٰذِهِ الشَّجَرَةَ فَتَكُونَا مِنَ الظَّالِمِينَ",
        imlaei: "وَقُلْنَا ياآدم اسكن أنت وزوجك الجنة وكلا منها رغدا حيث شئتما ولا تقربا هذه الشجرة فتكونا من الظالمين"
      },
      {
        id: "2:36", surah: 2, ayah: 36, surahNameArabic: "البقرة",
        uthmani: "فَأَزَلَّهُمَا الشَّيْطَٰنُ عَنْهَا فَأَخْرَجَهُمَا مِمَّا كَانَا فِيهِ وَقُلْنَا اهْبِطُوا بَعْضُكُمْ لِبَعْضٍ عَدُوٌّ وَلَكُمْ فِي الْأَرْضِ مُسْتَقَرٌّ وَمَتَاعٌ إِلَىٰ حِينٍ",
        imlaei: "فأزلهما الشيطان عنها فأخرجهما مما كانا فيه وقلنا اهبطوا بعضكم لبعض عدو ولكم في الأرض مستقر ومتاع إلى حين"
      },
      {
        id: "2:37", surah: 2, ayah: 37, surahNameArabic: "البقرة",
        uthmani: "فَتَلَقَّىٰ آدَمُ مِنْ رَبِّهِ كَلِمَٰتٍ فَتَابَ عَلَيْهِ إِنَّهُ هُوَ التَّوَّابُ الرَّحِيمُ",
        imlaei: "فتلقى آدم من ربه كلمات فتاب عليه إنه هو التواب الرحيم"
      }
    ];
    const passageDetector = new QuranAyahDetector(new InMemoryQuranIndex(passageRecords));
    const text = "قال تعالى ﴿وَقُلْنَا يَا آدَمُ اسْكُنْ أَنْتَ وَزَوْجُكَ الْجَنَّةَ وَكُلَا مِنْهَا رَغَدًا حَيْثُ شِئْتُمَا وَلَا تَقْرَبَا هَٰذِهِ الشَّجَرَةَ فَتَكُونَا مِنَ الظَّالِمِينَ * فَأَزَلَّهُمَا الشَّيْطَانُ عَنْهَا فَأَخْرَجَهُمَا مِمَّا كَانَا فِيهِ ۖ وَقُلْنَا اهْبِطُوا بَعْضُكُمْ لِبَعْضٍ عَدُوٌّ ۖ وَلَكُمْ فِي الْأَرْضِ مُسْتَقَرٌّ وَمَتَاعٌ إِلَىٰ حِينٍ * فَتَلَقَّىٰ آدَمُ مِنْ رَبِّهِ كَلِمَاتٍ فَتَابَ عَلَيْهِ ۚ إِنَّهُ هُوَ التَّوَّابُ الرَّحِيمُ﴾ [البقرة الآيات ٣٥-٣٨]";
    const matches = passageDetector.detect(text);
    const match = matches.find(item =>
      item.references.some(reference => reference.surah === 2 && reference.ayah === 35)
    );

    expect(match).toBeDefined();
    expect(matches.filter(item => item.sourceStart >= text.indexOf("﴿") &&
      item.sourceEnd <= text.indexOf("﴾") + 1)).toHaveLength(1);
    expect(match?.references).toEqual([
      { surah: 2, ayah: 35 },
      { surah: 2, ayah: 36 },
      { surah: 2, ayah: 37 }
    ]);
    expect(text.slice(match!.sourceStart, match!.sourceEnd)).toBe(text.slice(text.indexOf("﴿"), text.indexOf("﴾") + 1));
    expect(match?.replacementText).toBeDefined();
  });

  it("uses an adjacent Arabic-Indic verse range to resolve a repeated multi-ayah passage", () => {
    const passageVerses = [
      {
        ayah: 5,
        uthmani: "وَالَّذِينَ هُمْ لِفُرُوجِهِمْ حَافِظُونَ",
        imlaei: "والذين هم لفروجهم حافظون"
      },
      {
        ayah: 6,
        uthmani: "إِلَّا عَلَىٰ أَزْوَاجِهِمْ أَوْ مَا مَلَكَتْ أَيْمَانُهُمْ فَإِنَّهُمْ غَيْرُ مَلُومِينَ",
        imlaei: "الا على ازواجهم او ما ملكت ايمانهم فانهم غير ملومين"
      },
      {
        ayah: 7,
        uthmani: "فَمَنِ ابْتَغَىٰ وَرَاءَ ذَٰلِكَ فَأُولَٰئِكَ هُمُ الْعَادُونَ",
        imlaei: "فمن ابتغى وراء ذلك فاولئك هم العادون"
      }
    ];
    const duplicateRecords: QuranAyahRecord[] = [
      ...passageVerses.map(verse => ({
        id: "23:" + verse.ayah, surah: 23, ayah: verse.ayah, surahNameArabic: "المؤمنون",
        uthmani: verse.uthmani, imlaei: verse.imlaei
      })),
      ...passageVerses.map(verse => ({
        id: "70:" + (verse.ayah + 24), surah: 70, ayah: verse.ayah + 24, surahNameArabic: "المعارج",
        uthmani: verse.uthmani, imlaei: verse.imlaei
      }))
    ];
    const passageDetector = new QuranAyahDetector(new InMemoryQuranIndex(duplicateRecords));
    const quotation = "﴿وَالَّذِينَ هُمْ لِفُرُوجِهِمْ حَافِظُونَ * إِلَّا عَلَىٰ أَزْوَاجِهِمْ أَوْ مَا مَلَكَتْ أَيْمَانُهُمْ فَإِنَّهُمْ غَيْرُ مَلُومِينَ * فَمَنِ ابْتَغَىٰ وَرَاءَ ذَٰلِكَ فَأُولَٰئِكَ هُمُ الْعَادُونَ﴾";
    const text = quotation + " [المؤمنون: ٥-٧]";
    const matches = passageDetector.detect(text);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchedText).toBe(quotation);
    expect(matches[0]?.references).toEqual([
      { surah: 23, ayah: 5 },
      { surah: 23, ayah: 6 },
      { surah: 23, ayah: 7 }
    ]);
    expect(matches[0]?.replacementText).toBeDefined();
    expect(matches[0]?.evidence.some(item =>
      item.type === "explicit-reference" && item.detail.includes("المؤمنون")
    )).toBe(true);
  });

  it("resolves the repeated passage with encoded whitespace and escaped stars", () => {
    const passageVerses = [
      { ayah: 5, uthmani: "وَالَّذِينَ هُمْ لِفُرُوجِهِمْ حَافِظُونَ", imlaei: "والذين هم لفروجهم حافظون" },
      { ayah: 6, uthmani: "إِلَّا عَلَىٰ أَزْوَاجِهِمْ أَوْ مَا مَلَكَتْ أَيْمَانُهُمْ فَإِنَّهُمْ غَيْرُ مَلُومِينَ", imlaei: "الا على ازواجهم او ما ملكت ايمانهم فانهم غير ملومين" },
      { ayah: 7, uthmani: "فَمَنِ ابْتَغَىٰ وَرَاءَ ذَٰلِكَ فَأُولَٰئِكَ هُمُ الْعَادُونَ", imlaei: "فمن ابتغى وراء ذلك فاولئك هم العادون" }
    ];
    const duplicateRecords: QuranAyahRecord[] = [
      ...passageVerses.map(verse => ({ id: "23:" + verse.ayah, surah: 23, ayah: verse.ayah, surahNameArabic: "المؤمنون", uthmani: verse.uthmani, imlaei: verse.imlaei })),
      ...passageVerses.map(verse => ({ id: "70:" + (verse.ayah + 24), surah: 70, ayah: verse.ayah + 24, surahNameArabic: "المعارج", uthmani: verse.uthmani, imlaei: verse.imlaei }))
    ];
    const passageDetector = new QuranAyahDetector(new InMemoryQuranIndex(duplicateRecords));
    const quotation = "﴿وَالَّذِينَ هُمْ لِفُرُوجِهِمْ حَافِظُونَ \\* إِلَّا عَلَىٰ أَزْوَاجِهِمْ أَوْ مَا مَلَكَتْ أَيْمَانُهُمْ فَإِنَّهُمْ غَيْرُ مَلُومِينَ \\* فَمَنِ ابْتَغَىٰ وَرَاءَ ذَٰلِكَ فَأُولَٰئِكَ هُمُ الْعَادُونَ﴾";
    const matches = passageDetector.detect(quotation + "&#x20;[المؤمنون: ٥-٧]");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchedText).toBe(quotation);
    expect(matches[0]?.references).toEqual([{ surah: 23, ayah: 5 }, { surah: 23, ayah: 6 }, { surah: 23, ayah: 7 }]);
    expect(matches[0]?.evidence.some(item => item.type === "explicit-reference" && item.detail.includes("المؤمنون"))).toBe(true);
    expect(matches[0]?.replacementText).toBeDefined();
  });

  it("uses an Al-Ma'arij range with mixed numeral forms to resolve the same passage", () => {
    const passageVerses = [
      { ayah: 5, uthmani: "وَالَّذِينَ هُمْ لِفُرُوجِهِمْ حَافِظُونَ", imlaei: "والذين هم لفروجهم حافظون" },
      { ayah: 6, uthmani: "إِلَّا عَلَىٰ أَزْوَاجِهِمْ أَوْ مَا مَلَكَتْ أَيْمَانُهُمْ فَإِنَّهُمْ غَيْرُ مَلُومِينَ", imlaei: "الا على ازواجهم او ما ملكت ايمانهم فانهم غير ملومين" },
      { ayah: 7, uthmani: "فَمَنِ ابْتَغَىٰ وَرَاءَ ذَٰلِكَ فَأُولَٰئِكَ هُمُ الْعَادُونَ", imlaei: "فمن ابتغى وراء ذلك فاولئك هم العادون" }
    ];
    const duplicateRecords: QuranAyahRecord[] = [
      ...passageVerses.map(verse => ({
        id: "23:" + verse.ayah, surah: 23, ayah: verse.ayah, surahNameArabic: "المؤمنون",
        uthmani: verse.uthmani, imlaei: verse.imlaei
      })),
      ...passageVerses.map(verse => ({
        id: "70:" + (verse.ayah + 24), surah: 70, ayah: verse.ayah + 24, surahNameArabic: "المعارج",
        uthmani: verse.uthmani, imlaei: verse.imlaei
      }))
    ];
    const passageDetector = new QuranAyahDetector(new InMemoryQuranIndex(duplicateRecords));
    const quotation = "﴿وَالَّذِينَ هُمْ لِفُرُوجِهِمْ حَافِظُونَ * إِلَّا عَلَىٰ أَزْوَاجِهِمْ أَوْ مَا مَلَكَتْ أَيْمَانُهُمْ فَإِنَّهُمْ غَيْرُ مَلُومِينَ * فَمَنِ ابْتَغَىٰ وَرَاءَ ذَٰلِكَ فَأُولَٰئِكَ هُمُ الْعَادُونَ﴾";
    const matches = passageDetector.detect(quotation + " [المعارج الآيات ٢٩–31]");

    expect(matches).toHaveLength(1);
    expect(matches[0]?.references).toEqual([
      { surah: 70, ayah: 29 },
      { surah: 70, ayah: 30 },
      { surah: 70, ayah: 31 }
    ]);
    expect(matches[0]?.replacementText).toBeDefined();
  });

  it("does not use a missing or conflicting citation to guess between repeated passages", () => {
    const passageVerses = [
      { ayah: 5, uthmani: "وَالَّذِينَ هُمْ لِفُرُوجِهِمْ حَافِظُونَ", imlaei: "والذين هم لفروجهم حافظون" },
      { ayah: 6, uthmani: "إِلَّا عَلَىٰ أَزْوَاجِهِمْ أَوْ مَا مَلَكَتْ أَيْمَانُهُمْ فَإِنَّهُمْ غَيْرُ مَلُومِينَ", imlaei: "الا على ازواجهم او ما ملكت ايمانهم فانهم غير ملومين" },
      { ayah: 7, uthmani: "فَمَنِ ابْتَغَىٰ وَرَاءَ ذَٰلِكَ فَأُولَٰئِكَ هُمُ الْعَادُونَ", imlaei: "فمن ابتغى وراء ذلك فاولئك هم العادون" }
    ];
    const duplicateRecords: QuranAyahRecord[] = [
      ...passageVerses.map(verse => ({
        id: "23:" + verse.ayah, surah: 23, ayah: verse.ayah, surahNameArabic: "المؤمنون",
        uthmani: verse.uthmani, imlaei: verse.imlaei
      })),
      ...passageVerses.map(verse => ({
        id: "70:" + (verse.ayah + 24), surah: 70, ayah: verse.ayah + 24, surahNameArabic: "المعارج",
        uthmani: verse.uthmani, imlaei: verse.imlaei
      }))
    ];
    const passageDetector = new QuranAyahDetector(new InMemoryQuranIndex(duplicateRecords));
    const quotation = "﴿وَالَّذِينَ هُمْ لِفُرُوجِهِمْ حَافِظُونَ * إِلَّا عَلَىٰ أَزْوَاجِهِمْ أَوْ مَا مَلَكَتْ أَيْمَانُهُمْ فَإِنَّهُمْ غَيْرُ مَلُومِينَ * فَمَنِ ابْتَغَىٰ وَرَاءَ ذَٰلِكَ فَأُولَٰئِكَ هُمُ الْعَادُونَ﴾";

    const withoutReference = passageDetector.detect(quotation);
    const conflictingReference = passageDetector.detect(quotation + " [النور: ٥-٧]");

    expect(withoutReference.some(match => match.matchedText === quotation)).toBe(false);
    expect(conflictingReference.some(match => match.matchedText === quotation)).toBe(false);
  });
});

describe("bracketed quotation integrity", () => {
  it("does not replace a full Hūd 11:78 quotation with the partial Hijr 15:69 phrase when فاء changes to واو", () => {
    const hud: QuranAyahRecord = {
      id: "11:78", surah: 11, ayah: 78, surahNameArabic: "هود",
      uthmani: "وَجَآءَهُۥ قَوْمُهُۥ يُهْرَعُونَ إِلَيْهِ وَمِن قَبْلُ كَانُواْ يَعْمَلُونَ السَّيِّئَاتِ قَالَ يَا قَوْمِ هَٰؤُلَاءِ بَنَاتِي هُنَّ أَطْهَرُ لَكُمْ فَاتَّقُواْ اللَّهَ وَلَا تُخْزُونِ فِي ضَيْفِي أَلَيْسَ مِنْكُمْ رَجُلٌ رَشِيدٌ",
      imlaei: "وجاءه قومه يهرعون اليه ومن قبل كانوا يعملون السيئات قال يا قوم هؤلاء بناتي هن اطهر لكم فاتقوا الله ولا تخزون في ضيفي اليس منكم رجل رشيد"
    };
    const hijr: QuranAyahRecord = {
      id: "15:69", surah: 15, ayah: 69, surahNameArabic: "الحجر",
      uthmani: "وَاتَّقُوا اللَّهَ وَلَا تُخْزُونِ",
      imlaei: "واتقوا الله ولا تخزون"
    };
    const detector = new QuranAyahDetector(new InMemoryQuranIndex([hud, hijr]));
    const altered = hud.imlaei.replace("فاتقوا", "واتقوا");
    const text = `قال تعالى ﴿${altered}﴾`;
    const matches = detector.detect(text);
    expect(matches.some(match => match.references.some(ref => ref.surah === 15 && ref.ayah === 69))).toBe(false);
    expect(matches.some(match => match.sourceStart > text.indexOf("﴿") && match.sourceEnd < text.indexOf("﴾"))).toBe(false);
  });

  it("matches vocative spacing variants without changing letters", () => {
    const verse: QuranAyahRecord = {
      id: "2:35", surah: 2, ayah: 35, surahNameArabic: "البقرة",
      uthmani: "وَقُلْنَا يَٰٓـَٔادَمُ اسْكُنْ أَنتَ وَزَوْجُكَ الْجَنَّةَ",
      imlaei: "وقلنا يا ادم اسكن انت وزوجك الجنة"
    };
    const detector = new QuranAyahDetector(new InMemoryQuranIndex([verse]));
    const spaced = detector.detect("قال تعالى ﴿وقلنا يا آدم اسكن أنت وزوجك الجنة﴾");
    const joined = detector.detect("قال تعالى ﴿وقلنا ياآدم اسكن أنت وزوجك الجنة﴾");
    expect(spaced.some(match => match.references.some(ref => ref.surah === 2 && ref.ayah === 35))).toBe(true);
    expect(joined.some(match => match.references.some(ref => ref.surah === 2 && ref.ayah === 35))).toBe(true);
  });

  it("matches joined Uthmani يا النداء against separated imlaei يا أيها", () => {
    const verse: QuranAyahRecord = {
      id: "7:158",
      surah: 7,
      ayah: 158,
      surahNameArabic: "الأعراف",
      uthmani: "قُلْ يَٰٓأَيُّهَا النَّاسُ إِنِّي رَسُولُ اللَّهِ إِلَيْكُمْ جَمِيعًا",
      imlaei: "قل يا ايها الناس اني رسول الله اليكم جميعا"
    };
    const localDetector = new QuranAyahDetector(new InMemoryQuranIndex([verse]));
    const text = "قال تعالى ﴿قل يا أيها الناس إني رسول الله إليكم جميعا﴾";
    const matches = localDetector.detect(text);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.references).toEqual([{ surah: 7, ayah: 158 }]);
    expect(matches[0]?.replacementText).toContain("يَٰٓأَيُّهَا");
  });

  it("treats nested Qur'anic brackets as one complete outer quotation", () => {
    const hud: QuranAyahRecord = {
      id: "11:78", surah: 11, ayah: 78, surahNameArabic: "هود",
      uthmani: "وَجَآءَهُۥ قَوْمُهُۥ يُهْرَعُونَ إِلَيْهِ وَمِن قَبْلُ كَانُواْ يَعْمَلُونَ السَّيِّئَاتِ قَالَ يَا قَوْمِ هَٰؤُلَاءِ بَنَاتِي هُنَّ أَطْهَرُ لَكُمْ فَاتَّقُواْ اللَّهَ وَلَا تُخْزُونِ فِي ضَيْفِي أَلَيْسَ مِنْكُمْ رَجُلٌ رَشِيدٌ",
      imlaei: "وجاءه قومه يهرعون اليه ومن قبل كانوا يعملون السيئات قال يا قوم هؤلاء بناتي هن اطهر لكم فاتقوا الله ولا تخزون في ضيفي اليس منكم رجل رشيد"
    };
    const hijr: QuranAyahRecord = {
      id: "15:69", surah: 15, ayah: 69, surahNameArabic: "الحجر",
      uthmani: "وَاتَّقُوا اللَّهَ وَلَا تُخْزُونِ",
      imlaei: "واتقوا الله ولا تخزون"
    };
    const detector = new QuranAyahDetector(new InMemoryQuranIndex([hud, hijr]));
    const text = "قال تعالى ﴿قال يا قوم هؤلاء بناتي هن أطهر لكم ۖ ﴿واتقوا الله ولا تخزون﴾ في ضيفي ۖ أليس منكم رجل رشيد﴾";
    const matches = detector.detect(text);
    expect(matches.some(match => match.references.some(ref => ref.surah === 15 && ref.ayah === 69))).toBe(false);
    expect(matches.some(match => match.references.some(ref => ref.surah === 11 && ref.ayah === 78))).toBe(false);
    expect(matches.every(match => text.slice(match.sourceStart, match.sourceEnd) !== "واتقوا الله ولا تخزون")).toBe(true);
  });

});
