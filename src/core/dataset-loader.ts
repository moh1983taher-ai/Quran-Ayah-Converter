import { validateCompleteQuran } from "./dataset-importer.js";
import { InMemoryQuranIndex } from "./quran-index.js";
import type { QuranAyahRecord, QuranIndex } from "./types.js";

export interface QuranDatasetEnvelope {
  schemaVersion: number;
  source: string;
  riwayah: "Hafs";
  datasetRelease: string;
  sourceRepository: string;
  sourceCommit: string;
  sourceFile: string;
  sourceGitBlobSha1: string;
  importedAt: string;
  recordCount: number;
  records: QuranAyahRecord[];
}

/**
 * Parse and validate a generated dataset JSON before making it available
 * to the detector. This checks structural completeness and provenance
 * identifiers; it does not certify the scholarly authenticity or reuse
 * license of a third-party source.
 */
export function loadQuranDatasetJson(json: string): {
  dataset: QuranDatasetEnvelope;
  index: QuranIndex;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Qur'an dataset is not valid JSON");
  }

  if (!isRecord(parsed)) throw new Error("Qur'an dataset root must be an object");
  const value = parsed as Partial<QuranDatasetEnvelope>;

  if (
    value.schemaVersion !== 1 ||
    value.riwayah !== "Hafs" ||
    typeof value.source !== "string" ||
    typeof value.datasetRelease !== "string" ||
    typeof value.sourceRepository !== "string" ||
    typeof value.sourceCommit !== "string" ||
    !/^[a-f0-9]{40}$/i.test(value.sourceCommit) ||
    typeof value.sourceFile !== "string" ||
    !/^[a-f0-9]{40}$/i.test(value.sourceGitBlobSha1) ||
    typeof value.importedAt !== "string" ||
    !Number.isFinite(Date.parse(value.importedAt)) ||
    !Array.isArray(value.records) ||
    value.recordCount !== value.records.length
  ) {
    throw new Error("Qur'an dataset metadata is incomplete or invalid");
  }

  const records = value.records as QuranAyahRecord[];
  validateCompleteQuran(records);
  const dataset = value as QuranDatasetEnvelope;
  return { dataset, index: new InMemoryQuranIndex(records) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
