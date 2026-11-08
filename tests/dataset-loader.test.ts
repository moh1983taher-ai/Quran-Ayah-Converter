import { describe, expect, it } from "vitest";
import { loadQuranDatasetJson } from "../src/core/dataset-loader.js";
import { EXPECTED_AYAH_COUNTS } from "../src/core/dataset-importer.js";
import type { QuranAyahRecord } from "../src/core/types.js";

function fixture() {
  const records: QuranAyahRecord[] = [];
  for (let surah = 1; surah <= 114; surah += 1) {
    for (let ayah = 1; ayah <= EXPECTED_AYAH_COUNTS[surah - 1]!; ayah += 1) {
      records.push({
        id: String(records.length + 1),
        surah,
        ayah,
        surahNameArabic: `سورة ${surah}`,
        uthmani: `نص عثماني ${surah} ${ayah}`,
        imlaei: `نص إملائي ${surah} ${ayah}`
      });
    }
  }
  return {
    schemaVersion: 1,
    source: "KFGQPC Hafs data, retrieved from a pinned GitHub mirror",
    riwayah: "Hafs" as const,
    datasetRelease: "v18 / update 10.0",
    sourceRepository: "https://github.com/thetruetruth/quran-data-kfgqpc",
    sourceCommit: "281dbbe8eed1370daa5a023b6cd81655cbfd6473",
    sourceFile: "hafs/data/hafsData_v18.csv",
    sourceGitBlobSha1: "9e2229cdb9c6e010429989a3f379c55ea25712a7",
    importedAt: "2026-11-08T09:42:00.000Z",
    recordCount: records.length,
    records
  };
}

describe("Qur'an dataset loader", () => {
  it("loads a complete dataset and builds a searchable in-memory index", () => {
    const { dataset, index } = loadQuranDatasetJson(JSON.stringify(fixture()));
    expect(dataset.recordCount).toBe(6236);
    expect(index.size).toBe(6236);
    expect(index.get({ surah: 1, ayah: 1 })?.uthmani).toBe("نص عثماني 1 1");
    expect(index.get({ surah: 114, ayah: 6 })?.ayah).toBe(6);
  });

  it("rejects a record count that does not match the payload", () => {
    const data = fixture();
    data.recordCount -= 1;
    expect(() => loadQuranDatasetJson(JSON.stringify(data))).toThrow(/metadata/);
  });

  it("rejects a missing ayah even when metadata claims a full dataset", () => {
    const data = fixture();
    data.records.pop();
    data.recordCount -= 1;
    expect(() => loadQuranDatasetJson(JSON.stringify(data))).toThrow(/6236/);
  });

  it("rejects malformed source commit metadata", () => {
    const data = fixture();
    data.sourceCommit = "main";
    expect(() => loadQuranDatasetJson(JSON.stringify(data))).toThrow(/metadata/);
  });

  it("rejects invalid JSON", () => {
    expect(() => loadQuranDatasetJson("{")).toThrow(/valid JSON/);
  });
});
