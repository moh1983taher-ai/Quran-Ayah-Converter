import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync } from "fflate";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ARCHIVE_URL = "https://download.qurancomplex.gov.sa/resources_dev/UthmanicHafs_v2-0.zip";
const EXPECTED_ARCHIVE_SHA256 = "a7b0e5591945712ec5e4d6142938ae4d1e9b49bdc89dff06222789bfebdfd72c";
const EXPECTED_ARCHIVE_BYTES = 10729285;
const EXPECTED_TOTAL = 6236;
const SURAH_COUNTS = [7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6];

function fail(message) { throw new Error(message); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function decode(bytes) { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }

function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length !== EXPECTED_TOTAL) {
    fail(`Expected an array of ${EXPECTED_TOTAL} ayahs; received ${rows?.length ?? "non-array"}`);
  }
  const seen = new Set();
  const counts = Array(114).fill(0);
  const records = rows.map((row, i) => {
    const surah = Number(row.sura_no);
    const ayah = Number(row.aya_no);
    const id = String(row.id ?? `${surah}:${ayah}`);
    const uthmani = String(row.aya_text ?? row.aya_text_unicode ?? "").trim();
    const imlaei = String(row.aya_text_emlaey ?? "").trim();
    const surahNameArabic = String(row.sura_name_ar ?? "").trim();
    if (!Number.isInteger(surah) || surah < 1 || surah > 114) fail(`Invalid sura_no at row ${i+1}`);
    if (!Number.isInteger(ayah) || ayah < 1) fail(`Invalid aya_no at row ${i+1}`);
    if (!surahNameArabic || !uthmani || !imlaei) fail(`Missing Arabic text or surah name at row ${i+1}`);
    const key = `${surah}:${ayah}`;
    if (seen.has(key)) fail(`Duplicate ayah reference: ${key}`);
    seen.add(key);
    counts[surah - 1] += 1;
    const record = { id, surah, ayah, surahNameArabic, uthmani, imlaei };
    const juz = Number(row.jozz), page = Number(row.page);
    const lineStart = Number(row.line_start), lineEnd = Number(row.line_end);
    if (Number.isInteger(juz) && juz > 0) record.juz = juz;
    if (Number.isInteger(page) && page > 0) record.page = page;
    if (Number.isInteger(lineStart) && lineStart > 0) record.lineStart = lineStart;
    if (Number.isInteger(lineEnd) && lineEnd > 0) record.lineEnd = lineEnd;
    return record;
  });
  for (let s = 1; s <= 114; s++) {
    if (counts[s - 1] !== SURAH_COUNTS[s - 1]) {
      fail(`Surah ${s}: expected ${SURAH_COUNTS[s - 1]} ayahs, got ${counts[s - 1]}`);
    }
    for (let a = 1; a <= SURAH_COUNTS[s - 1]; a++) {
      if (!seen.has(`${s}:${a}`)) fail(`Missing ayah ${s}:${a}`);
    }
  }
  return records;
}

async function main() {
  const rawDir = join(ROOT, "data", "_raw");
  const archivePath = join(rawDir, "UthmanicHafs_v2-0.zip");
  await mkdir(rawDir, { recursive: true });

  let archive;
  try {
    archive = new Uint8Array(await readFile(archivePath));
    console.log("Using existing archive:", archivePath);
  } catch {
    console.log("Downloading official KFGQPC archive...");
    const response = await fetch(ARCHIVE_URL, { redirect: "follow" });
    if (!response.ok) fail(`Download failed: HTTP ${response.status}`);
    archive = new Uint8Array(await response.arrayBuffer());
    await writeFile(archivePath, archive);
  }

  if (archive.byteLength !== EXPECTED_ARCHIVE_BYTES) {
    fail(`Archive size mismatch: expected ${EXPECTED_ARCHIVE_BYTES}, received ${archive.byteLength}`);
  }
  const archiveHash = sha256(archive);
  if (archiveHash !== EXPECTED_ARCHIVE_SHA256) {
    fail(`Archive SHA-256 mismatch. Actual: ${archiveHash}. No data was imported.`);
  }

  const entries = unzipSync(archive);
  const jsonPath = Object.keys(entries).find(name => name.endsWith("hafsData_v2-0.json"));
  if (!jsonPath) fail("hafsData_v2-0.json was not found in the archive");
  const sourceRows = JSON.parse(decode(entries[jsonPath]));
  const records = validateRows(sourceRows);

  const output = {
    schemaVersion: 1,
    source: "KFGQPC",
    riwayah: "Hafs",
    datasetRelease: "13.0",
    archiveSha256: archiveHash,
    archiveUrl: ARCHIVE_URL,
    importedAt: new Date().toISOString(),
    recordCount: records.length,
    records
  };
  const outputPath = join(ROOT, "data", "quran-hafs.json");
  await writeFile(outputPath, JSON.stringify(output));
  console.log(`Validated and wrote ${records.length} ayahs to ${outputPath}`);
}

main().catch(error => {
  console.error("KFGQPC import failed:", error.message);
  process.exitCode = 1;
});
