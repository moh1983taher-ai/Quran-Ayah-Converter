import { describe, expect, it } from "vitest";
import {
  EXPECTED_AYAH_COUNTS,
  EXPECTED_TOTAL_AYAHS,
  importKfgqpcHafsRows,
  validateCompleteQuran
} from "../src/core/dataset-importer.js";
import type { QuranAyahRecord } from "../src/core/types.js";

const provenance = {
  source: "KFGQPC" as const,
  sourceUrl: "https://qurancomplex.gov.sa/quran-dev/",
  edition: "Unicode Uthmanic Font",
  riwayah: "Hafs" as const,
  version: "15.0",
  publishedAt: "2026-09-30",
  fileName: "official-hafs-export.json",
  fileSha256: "a".repeat(64),
  termsReviewed: true
};

function completeFixture(): QuranAyahRecord[] {
  const records: QuranAyahRecord[] = [];
  for (let surah = 1; surah <= 114; surah += 1) {
    for (let ayah = 1; ayah <= EXPECTED_AYAH_COUNTS[surah - 1]!; ayah += 1) {
      records.push({
        id: `${surah}:${ayah}`,
        surah,
        ayah,
        surahNameArabic: `سورة ${surah}`,
        uthmani: `نص عثماني تجريبي ${surah} ${ayah}`,
        imlaei: `نص املائي تجريبي ${surah} ${ayah}`
      });
    }
  }
  return records;
}

describe("KFGQPC Hafs dataset importer", () => {
  it("uses the canonical 114-surah / 6236-ayah completeness profile", () => {
    expect(EXPECTED_AYAH_COUNTS).toHaveLength(114);
    expect(EXPECTED_AYAH_COUNTS.reduce((sum, count) => sum + count, 0)).toBe(EXPECTED_TOTAL_AYAHS);
  });

  it("imports complete rows with provenance", () => {
    const rows = completeFixture().map(record => ({
      id: record.id,
      sura_no: record.surah,
      sura_name_ar: record.surahNameArabic,
      aya_no: record.ayah,
      aya_text_unicode: record.uthmani,
      aya_text_emlaey: record.imlaei
    }));
    const result = importKfgqpcHafsRows(rows, provenance);
    expect(result.records).toHaveLength(6236);
    expect(result.records[0]?.id).toBe("1:1");
    expect(result.records.at(-1)?.id).toBe("114:6");
  });

  it("rejects incomplete data", () => {
    expect(() => validateCompleteQuran(completeFixture().slice(1))).toThrow(/6236/);
  });

  it("rejects a missing ayah even if the total row count is preserved", () => {
    const records = completeFixture();
    records[0] = { ...records[0]!, ayah: 2, id: "1:2" };
    expect(() => validateCompleteQuran(records)).toThrow(/Duplicate|expected|Missing/);
  });

  it("refuses import until provenance and terms review are supplied", () => {
    const rows = completeFixture().map(record => ({
      id: record.id,
      sura_no: record.surah,
      sura_name_ar: record.surahNameArabic,
      aya_no: record.ayah,
      aya_text_unicode: record.uthmani,
      aya_text_emlaey: record.imlaei
    }));
    expect(() => importKfgqpcHafsRows(rows, { ...provenance, termsReviewed: false })).toThrow(/provenance/);
  });
});
