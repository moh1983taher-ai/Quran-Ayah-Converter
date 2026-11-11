import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { tokenizeArabic } from "../src/core/alignment.js";
import { QuranAyahDetector, tokenizeUthmaniAyah } from "../src/core/detector.js";
import { InMemoryQuranIndex } from "../src/core/quran-index.js";
import type { QuranAyahRecord } from "../src/core/types.js";
import { createReviewItems } from "../src/word/review-workflow.js";

const ayah24_33: QuranAyahRecord = {
  id: "24:33",
  surah: 24,
  ayah: 33,
  surahNameArabic: "النور",
  uthmani: "وَلۡيَسۡتَعۡفِفِ ٱلَّذِينَ لَا يَجِدُونَ نِكَاحًا حَتَّىٰ يُغۡنِيَهُمُ ٱللَّهُ مِن فَضۡلِهِۦۗ وَٱلَّذِينَ يَبۡتَغُونَ ٱلۡكِتَٰبَ مِمَّا مَلَكَتۡ أَيۡمَٰنُكُمۡ فَكَاتِبُوهُمۡ إِنۡ عَلِمۡتُمۡ فِيهِمۡ خَيۡرٗاۖ وَءَاتُوهُم مِّن مَّالِ ٱللَّهِ الَّذِيٓ ءَاتَىٰكُمۡۚ وَلَا تُكۡرِهُواْ فَتَيَٰتِكُمۡ عَلَى ٱلۡبِغَآءِ إِنۡ أَرَدْنَ تَحَصُّنٗا لِّتَبۡتَغُواْ عَرَضَ ٱلۡحَيَوٰةِ ٱلدُّنۡيَاۚ وَمَن يُكۡرِهۡهُنَّ فَإِنَّ ٱللَّهَ مِنۢ بَعۡدِ إِكۡرَٰهِهِنَّ غَفُورٞ رَّحِيمٞ ٣٣",
  imlaei: "وليستعفف الذين لا يجدون نكاحا حتى يغنيهم الله من فضله والذين يبتغون الكتاب مما ملكت أيمانكم فكاتبوهم إن علمتم فيهم خيرا وآتوهم من مال الله الذي آتاكم ولا تكرهوا فتياتكم على البغاء إن أردن تحصنا لتبتغوا عرض الحياة الدنيا ومن يكرهن فإن الله من بعد إكراههن غفور رحيم"
};

const userQuotation = "وَلْيَسْتَعْفِفِ الَّذِينَ لَا يَجِدُونَ نِكَاحًا حَتَّىٰ يُغْنِيَهُمُ اللَّهُ مِنْ فَضْلِهِ ۗ وَالَّذِينَ يَبْتَغُونَ الْكِتَابَ مِمَّا مَلَكَتْ أَيْمَانُكُمْ فَكَاتِبُوهُمْ إِنْ عَلِمْتُمْ فِيهِمْ خَيْرًا ۖ وَآتُوهُمْ مِنْ مَالِ اللَّهِ الَّذِي آتَاكُمْ ۚ وَلَا تُكْرِهُوا فَتَيَاتِكُمْ عَلَى الْبِغَاءِ إِنْ أَرَدْنَ تَحَصُّنًا لِتَبْتَغُوا عَرَضَ الْحَيَاةِ الدُّنْيَا ۚ وَمَنْ يُكْرِهْهُنَّ فَإِنَّ اللَّهَ مِنْ بَعْدِ إِكْرَاهِهِنَّ غَفُورٌ رَحِيمٌ";

function recordWith(uthmani: string, ayah = 33): QuranAyahRecord {
  return {
    id: `24:${ayah}`,
    surah: 24,
    ayah,
    surahNameArabic: "النور",
    uthmani,
    imlaei: "هذا نص اختباري"
  };
}

function normalizeDigits(value: string): string {
  return [...value].map(character => {
    const code = character.codePointAt(0)!;
    if (code >= 0x0660 && code <= 0x0669) return String(code - 0x0660);
    if (code >= 0x06f0 && code <= 0x06f9) return String(code - 0x06f0);
    return character;
  }).join("");
}

describe("terminal printed ayah-number tokenization", () => {
  it("removes only the matching terminal ayah number after a real whitespace separator", () => {
    const source = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ ٣٣";
    const record = recordWith(source);
    const before = tokenizeArabic(source);
    const after = tokenizeUthmaniAyah(record);

    expect(normalizeDigits(before.at(-1)?.value ?? "")).toBe("33");
    expect(after).toEqual(before.slice(0, -1));
    expect(record.uthmani).toBe(source);
  });

  it("does not remove a terminal number that disagrees with the record reference", () => {
    const source = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ ٣٤";
    const before = tokenizeArabic(source);
    expect(tokenizeUthmaniAyah(recordWith(source))).toEqual(before);
  });

  it("does not remove digits attached directly to the final Arabic word", () => {
    const source = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ٣٣";
    const before = tokenizeArabic(source);
    expect(tokenizeUthmaniAyah(recordWith(source))).toEqual(before);
  });

  it("does not remove a matching number when it is not the final token", () => {
    const source = "بِسْمِ اللَّهِ ٣٣ الرَّحْمَٰنِ الرَّحِيمِ";
    const before = tokenizeArabic(source);
    expect(tokenizeUthmaniAyah(recordWith(source))).toEqual(before);
  });

  it("recognizes common whitespace separators, including non-breaking spaces, without broadening the number check", () => {
    for (const separator of [" ", "\t", "\n", "\u00A0", "\u2007", "\u202F"]) {
      const source = `بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ${separator}٣٣`;
      const record = recordWith(source);
      const before = tokenizeArabic(source);
      expect(tokenizeUthmaniAyah(record), JSON.stringify(separator)).toEqual(before.slice(0, -1));
    }
  });
});

describe("Al-Noor 24:33 detection without an adjacent reference", () => {
  const detector = new QuranAyahDetector(new InMemoryQuranIndex([ayah24_33]));

  it("detects the supplied fully vocalized quotation without a surah/ayah citation", () => {
    const text = `﴿${userQuotation}﴾`;
    const matches = detector.detect(text);
    const match = matches.find(item =>
      item.references.some(reference => reference.surah === 24 && reference.ayah === 33)
    );

    expect(match).toBeDefined();
    expect(match?.references).toEqual([{ surah: 24, ayah: 33 }]);
    expect(match?.status).not.toBe("ambiguous");
    expect(text.slice(match!.sourceStart, match!.sourceEnd)).toBe(text);
    const expectedCanonicalExcerpt = ayah24_33.uthmani.replace(/\s+[٠-٩۰-۹0-9]+$/u, "").trimEnd();
    expect(match?.replacementText).toBe(expectedCanonicalExcerpt);

    const cards = createReviewItems(text, matches);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.originalText).toBe(text);
    expect(cards[0]?.replacementText).toBe(expectedCanonicalExcerpt);
  });

  it("continues to resolve the same quotation when its explicit reference is present", () => {
    const text = `﴿${userQuotation}﴾ [النور: ٣٣]`;
    const match = detector.detect(text).find(item =>
      item.references.some(reference => reference.surah === 24 && reference.ayah === 33)
    );
    expect(match).toBeDefined();
    expect(match?.references).toEqual([{ surah: 24, ayah: 33 }]);
  });

  it("does not accept a same-length character substitution as the one-character insertion already supported", () => {
    const mutated = userQuotation.replace("نِكَاحًا", "نِفَاحًا");
    expect(mutated).not.toBe(userQuotation);
    const matches = detector.detect(`﴿${mutated}﴾`);
    expect(matches.some(item =>
      item.references.some(reference => reference.surah === 24 && reference.ayah === 33)
    )).toBe(false);
  });

  it("does not accept multiple character edits in the same word", () => {
    const mutated = userQuotation.replace("يُكْرِهْهُنَّ", "يُكْرِهْهُنَّاا");
    expect(mutated).not.toBe(userQuotation);
    const matches = detector.detect(`﴿${mutated}﴾`);
    expect(matches.some(item =>
      item.references.some(reference => reference.surah === 24 && reference.ayah === 33)
    )).toBe(false);
  });
});

describe("whole KFGQPC Hafs corpus audit for terminal ayah numbers", () => {
  const datasetUrl = new URL("../data/quran-hafs.json", import.meta.url);

  it.skipIf(!existsSync(datasetUrl))("removes exactly one matching terminal number from all 6,236 imported records", () => {
    const imported = JSON.parse(readFileSync(datasetUrl, "utf8")) as {
      recordCount: number;
      records: QuranAyahRecord[];
    };
    expect(imported.recordCount).toBe(6236);
    expect(imported.records).toHaveLength(6236);

    let verified = 0;
    for (const record of imported.records) {
      const before = tokenizeArabic(record.uthmani);
      const after = tokenizeUthmaniAyah(record);
      const finalToken = before.at(-1);
      const previousToken = before.at(-2);
      expect(finalToken, record.id).toBeDefined();
      expect(previousToken, record.id).toBeDefined();
      expect(finalToken!.end, record.id).toBe(record.uthmani.trimEnd().length);
      const separator = record.uthmani.slice(previousToken!.end, finalToken!.start);
      expect(/^\s+$/u.test(separator), record.id).toBe(true);
      expect(normalizeDigits(record.uthmani.slice(finalToken!.start, finalToken!.end)), record.id)
        .toBe(String(record.ayah));
      expect(after, record.id).toEqual(before.slice(0, -1));
      expect(after).toHaveLength(before.length - 1);
      verified += 1;
    }
    expect(verified).toBe(6236);
  });
});
