import type { QuranAyahRecord } from "./types.js";

export interface QuranDatasetProvenance {
  source: "KFGQPC";
  sourceUrl: string;
  edition: string;
  riwayah: "Hafs";
  version: string;
  publishedAt: string;
  fileName: string;
  fileSha256: string;
  termsReviewed: boolean;
}

export interface ImportedQuranDataset {
  provenance: QuranDatasetProvenance;
  records: QuranAyahRecord[];
}

export interface KfgqpcRawRow {
  id?: string | number;
  sura_no?: string | number;
  sura_name_ar?: string;
  aya_no?: string | number;
  aya_text_unicode?: string;
  aya_text?: string;
  aya_text_emlaey?: string;
  jozz?: string | number;
  page?: string | number;
  line_start?: string | number;
  line_end?: string | number;
  surah?: string | number;
  surahNameArabic?: string;
  ayah?: string | number;
  uthmani?: string;
  imlaei?: string;
}

export const EXPECTED_AYAH_COUNTS: readonly number[] = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109, 123, 111, 43, 52,
  99, 128, 111, 110, 98, 135, 112, 78, 118, 64, 77, 227, 93, 88,
  69, 60, 34, 30, 73, 54, 45, 83, 182, 88, 75, 85, 54, 53, 89,
  59, 37, 35, 38, 29, 18, 45, 60, 49, 62, 55, 78, 96, 29, 22,
  24, 13, 14, 11, 11, 18, 12, 12, 30, 52, 52, 44, 28, 28, 20,
  56, 40, 31, 50, 40, 46, 42, 29, 19, 36, 25, 22, 17, 19, 26,
  30, 20, 15, 21, 11, 8, 8, 19, 5, 8, 8, 11, 11, 8, 3, 9, 5,
  4, 7, 3, 6, 3, 5, 4, 5, 6
];

export const EXPECTED_TOTAL_AYAHS = 6236;

/**
 * Convert rows from the official KFGQPC Hafs data export into the app schema.
 * This function validates completeness and provenance; it does not fetch files
 * or grant permission to redistribute third-party content.
 */
export function importKfgqpcHafsRows(
  rows: readonly KfgqpcRawRow[],
  provenance: QuranDatasetProvenance
): ImportedQuranDataset {
  validateProvenance(provenance);

  if (rows.length !== EXPECTED_TOTAL_AYAHS) {
    throw new Error(`Expected ${EXPECTED_TOTAL_AYAHS} ayahs; received ${rows.length}`);
  }

  const records = rows.map((row, index): QuranAyahRecord => {
    const surah = toInteger(row.sura_no ?? row.surah, "sura_no", index);
    const ayah = toInteger(row.aya_no ?? row.ayah, "aya_no", index);
    const surahNameArabic = (row.sura_name_ar ?? row.surahNameArabic ?? "").trim();
    const uthmani = (row.aya_text_unicode ?? row.aya_text ?? row.uthmani ?? "").trim();
    const imlaei = (row.aya_text_emlaey ?? row.imlaei ?? "").trim();
    const id = String(row.id ?? `${surah}:${ayah}`).trim();

    if (surah < 1 || surah > 114) throw new Error(`Invalid surah at row ${index + 1}`);
    if (!surahNameArabic || !uthmani || !imlaei) {
      throw new Error(`Missing required Arabic data at row ${index + 1}`);
    }

    const record: QuranAyahRecord = {
      id,
      surah,
      ayah,
      surahNameArabic,
      uthmani,
      imlaei
    };

    const juzValue = optionalInteger(row.jozz);
    const pageValue = optionalInteger(row.page);
    const lineStartValue = optionalInteger(row.line_start);
    const lineEndValue = optionalInteger(row.line_end);
    if (juzValue !== undefined) record.juz = juzValue;
    if (pageValue !== undefined) record.page = pageValue;
    if (lineStartValue !== undefined) record.lineStart = lineStartValue;
    if (lineEndValue !== undefined) record.lineEnd = lineEndValue;
    return record;
  });

  validateCompleteQuran(records);
  return { provenance: { ...provenance }, records };
}

export function validateCompleteQuran(records: readonly QuranAyahRecord[]): void {
  if (records.length !== EXPECTED_TOTAL_AYAHS) {
    throw new Error(`Dataset must contain exactly ${EXPECTED_TOTAL_AYAHS} ayahs`);
  }

  const seen = new Set<string>();
  const names = new Map<number, string>();
  const counts = new Array<number>(114).fill(0);

  for (const record of records) {
    const key = `${record.surah}:${record.ayah}`;
    if (record.surah < 1 || record.surah > 114) throw new Error(`Invalid surah: ${key}`);
    if (!Number.isInteger(record.ayah) || record.ayah < 1) throw new Error(`Invalid ayah: ${key}`);
    if (seen.has(key)) throw new Error(`Duplicate ayah reference: ${key}`);
    if (!record.id || !record.surahNameArabic.trim() || !record.uthmani.trim() || !record.imlaei.trim()) {
      throw new Error(`Incomplete ayah record: ${key}`);
    }

    const priorName = names.get(record.surah);
    if (priorName && priorName !== record.surahNameArabic) {
      throw new Error(`Inconsistent Arabic surah name for surah ${record.surah}`);
    }
    names.set(record.surah, record.surahNameArabic);
    counts[record.surah - 1] = (counts[record.surah - 1] ?? 0) + 1;
    seen.add(key);
  }

  for (let surah = 1; surah <= 114; surah += 1) {
    const expected = EXPECTED_AYAH_COUNTS[surah - 1];
    const actual = counts[surah - 1] ?? 0;
    if (actual !== expected) {
      throw new Error(`Surah ${surah}: expected ${expected} ayahs; received ${actual}`);
    }
    for (let ayah = 1; ayah <= expected; ayah += 1) {
      if (!seen.has(`${surah}:${ayah}`)) {
        throw new Error(`Missing ayah reference: ${surah}:${ayah}`);
      }
    }
  }
}

function validateProvenance(value: QuranDatasetProvenance): void {
  if (
    value.source !== "KFGQPC" ||
    !value.sourceUrl.startsWith("https://qurancomplex.gov.sa/") ||
    !value.edition.trim() ||
    value.riwayah !== "Hafs" ||
    !value.version.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.publishedAt) ||
    !value.fileName.trim() ||
    !/^[a-f0-9]{64}$/i.test(value.fileSha256) ||
    value.termsReviewed !== true
  ) {
    throw new Error("Dataset provenance is incomplete or terms have not been reviewed");
  }
}

function toInteger(value: string | number | undefined, field: string, index: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Invalid ${field} at row ${index + 1}`);
  return parsed;
}

function optionalInteger(value: string | number | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
