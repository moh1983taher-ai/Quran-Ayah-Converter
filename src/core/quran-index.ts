import type { AyahReference, QuranAyahRecord, QuranIndex } from "./types.js";
import { normalizeArabic } from "./normalizer.js";

/**
 * In-memory index. It accepts records only after the dataset has been
 * independently sourced and validated by the import pipeline.
 */
export class InMemoryQuranIndex implements QuranIndex {
  private readonly records = new Map<string, QuranAyahRecord>();
  private readonly normalizedSearch = new Map<string, QuranAyahRecord[]>();

  constructor(records: readonly QuranAyahRecord[]) {
    for (const record of records) {
      validateRecord(record);
      const key = referenceKey(record);
      if (this.records.has(key)) {
        throw new Error(`Duplicate Qur'an reference: ${key}`);
      }

      this.records.set(key, record);
      const terms = new Set([
        normalizeArabic(record.uthmani),
        normalizeArabic(record.imlaei)
      ]);

      for (const term of terms) {
        const bucket = this.normalizedSearch.get(term) ?? [];
        bucket.push(record);
        this.normalizedSearch.set(term, bucket);
      }
    }
  }

  get(reference: AyahReference): QuranAyahRecord | undefined {
    return this.records.get(referenceKey(reference));
  }

  search(normalizedQuery: string): QuranAyahRecord[] {
    return this.normalizedSearch.get(normalizedQuery) ?? [];
  }

  get size(): number {
    return this.records.size;
  }
}

function referenceKey(reference: AyahReference): string {
  return `${reference.surah}:${reference.ayah}`;
}

function validateRecord(record: QuranAyahRecord): void {
  if (
    !Number.isInteger(record.surah) ||
    record.surah < 1 ||
    record.surah > 114 ||
    !Number.isInteger(record.ayah) ||
    record.ayah < 1 ||
    !record.id ||
    !record.uthmani.trim() ||
    !record.imlaei.trim()
  ) {
    throw new Error("Invalid Qur'an ayah record");
  }
}
