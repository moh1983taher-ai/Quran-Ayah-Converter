import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXPECTED_TOTAL = 6236;
const SOURCE_REPOSITORY = "https://github.com/thetruetruth/quran-data-kfgqpc";
const SOURCE_COMMIT = "281dbbe8eed1370daa5a023b6cd81655cbfd6473";
const SOURCE_PATH = "hafs/data/hafsData_v18.csv";
const SOURCE_URL = `https://raw.githubusercontent.com/thetruetruth/quran-data-kfgqpc/${SOURCE_COMMIT}/${SOURCE_PATH}`;
const EXPECTED_BYTES = 2441337;
const EXPECTED_GIT_BLOB_SHA1 = "9e2229cdb9c6e010429989a3f379c55ea25712a7";
const SURAH_COUNTS = [7,286,200,176,120,165,206,75,129,109,123,111,43,52,99,128,111,110,98,135,112,78,118,64,77,227,93,88,69,60,34,30,73,54,45,83,182,88,75,85,54,53,89,59,37,35,38,29,18,45,60,49,62,55,78,96,29,22,24,13,14,11,11,18,12,12,30,52,52,44,28,28,20,56,40,31,50,40,46,42,29,19,36,25,22,17,19,26,30,20,15,21,11,8,8,19,5,8,8,11,11,8,3,9,5,4,7,3,6,3,5,4,5,6];

function fail(message) { throw new Error(message); }
function gitBlobSha1(bytes) {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}
function decode(bytes) { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.length === 0) quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (quoted) fail("Malformed CSV: unterminated quoted field");
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) fail("CSV file is empty");
  const headers = rows.shift().map((h, i) => (i === 0 ? h.replace(/^\uFEFF/, "") : h).trim());
  return rows.filter(r => r.some(v => v.length)).map(values =>
    Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ""]))
  );
}

function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length !== EXPECTED_TOTAL) {
    fail(`Expected ${EXPECTED_TOTAL} ayahs; received ${rows?.length ?? "non-array"}`);
  }
  const seen = new Set();
  const counts = Array(114).fill(0);
  const records = rows.map((row, i) => {
    const surah = Number(row.sora_no ?? row.sura_no);
    const ayah = Number(row.aya_no);
    const id = String(row.id ?? `${surah}:${ayah}`);
    const uthmani = String(row.aya_text ?? row.aya_text_unicode ?? "").trim();
    const imlaei = String(row.aya_text_emlaey ?? "").trim();
    const surahNameArabic = String(row.sora_name_ar ?? row.sura_name_ar ?? "").trim();
    if (!Number.isInteger(surah) || surah < 1 || surah > 114) fail(`Invalid sura number at CSV row ${i + 2}`);
    if (!Number.isInteger(ayah) || ayah < 1) fail(`Invalid ayah number at CSV row ${i + 2}`);
    if (!surahNameArabic || !uthmani || !imlaei) fail(`Missing Arabic data at CSV row ${i + 2}`);
    const key = `${surah}:${ayah}`;
    if (seen.has(key)) fail(`Duplicate ayah reference: ${key}`);
    seen.add(key);
    counts[surah - 1] += 1;
    const record = { id, surah, ayah, surahNameArabic, uthmani, imlaei };
    for (const [source, target] of [["jozz","juz"],["page","page"],["line_start","lineStart"],["line_end","lineEnd"]]) {
      const value = Number(row[source]);
      if (Number.isInteger(value) && value > 0) record[target] = value;
    }
    return record;
  });
  for (let s = 1; s <= 114; s += 1) {
    if (counts[s - 1] !== SURAH_COUNTS[s - 1]) fail(`Surah ${s}: expected ${SURAH_COUNTS[s - 1]} ayahs, got ${counts[s - 1]}`);
    for (let a = 1; a <= SURAH_COUNTS[s - 1]; a += 1) {
      if (!seen.has(`${s}:${a}`)) fail(`Missing ayah ${s}:${a}`);
    }
  }
  return records;
}

async function main() {
  const response = await fetch(SOURCE_URL, {
    redirect: "follow",
    signal: AbortSignal.timeout(60000),
    headers: { "User-Agent": "Quran-Ayah-Converter/0.1.0" }
  });
  if (!response.ok) fail(`Pinned GitHub mirror returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== EXPECTED_BYTES) fail(`CSV size mismatch: expected ${EXPECTED_BYTES}, received ${bytes.byteLength}`);
  const blobSha1 = gitBlobSha1(bytes);
  if (blobSha1 !== EXPECTED_GIT_BLOB_SHA1) fail(`Git blob SHA-1 mismatch: ${blobSha1}; refusing unverified data`);

  const sourceRows = parseCsv(decode(bytes));
  const records = validateRows(sourceRows);
  const output = {
    schemaVersion: 1,
    source: "KFGQPC Hafs data, retrieved from a pinned GitHub mirror",
    riwayah: "Hafs",
    datasetRelease: "v18 / update 10.0 (source README dated 2021-10-25)",
    sourceRepository: SOURCE_REPOSITORY,
    sourceCommit: SOURCE_COMMIT,
    sourceFile: SOURCE_PATH,
    sourceGitBlobSha1: blobSha1,
    importedAt: new Date().toISOString(),
    recordCount: records.length,
    records
  };
  const outputPath = join(ROOT, "data", "quran-hafs.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output));
  console.log(`Validated ${records.length} ayahs from pinned KFGQPC mirror and wrote ${outputPath}`);
}

main().catch(error => {
  console.error("KFGQPC import failed:", error.message);
  process.exitCode = 1;
});
