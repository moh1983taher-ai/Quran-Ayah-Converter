# Importing the official Hafs dataset

The original intended source is the developer export published by the King Fahd Glorious Qur'an Printing Complex (KFGQPC). The current automated acquisition uses a pinned GitHub mirror of KFGQPC Hafs v18 data because the official download host failed TLS name validation from GitHub Actions.

Official portal: https://qurancomplex.gov.sa/quran-dev/

## Preferred edition

Use **Unicode Uthmanic Font (Hafs Narration)**, not the separate smart-device font, when selecting the display font. The portal currently lists the computer Unicode Hafs font as version 15.0, last modified 2026-09-30. This is a font release, not the data export version. The archived developer package identified for the Hafs dataset is `UthmanicHafs_v2-0.zip`, version 13.0, last modified 2023-09-19. Keep these versions separate. The portal documents these useful columns:

- `sura_no`, `sura_name_ar`, `aya_no`
- `aya_text` (archived v13 export) or `aya_text_unicode` (newer schema, if supplied) — display/replacement text
- `aya_text_emlaey` — search text
- `jozz`, `page`, `line_start`, `line_end` — optional layout metadata

The importer maps those fields to the internal `QuranAyahRecord` type and rejects partial or inconsistent datasets. It requires exactly 6,236 ayahs and checks the expected count and every sequential reference in all 114 surahs.

## Provenance is mandatory

Before importing a real export, record the exact filename, version, publication date, SHA-256 digest, and official download URL. Set `termsReviewed: true` only after the specific package terms have been read and the intended use (local application, installer bundling, and/or redistribution) has been confirmed as permitted.

The portal's availability of a download is not, by itself, a blanket redistribution license. Do not commit the source data or font into this repository until those terms are confirmed.

## Example

```ts
import { importKfgqpcHafsRows } from "../src/core/dataset-importer.js";

const imported = importKfgqpcHafsRows(parsedRows, {
  source: "KFGQPC",
  sourceUrl: "https://qurancomplex.gov.sa/quran-dev/",
  edition: "Unicode Uthmanic Font",
  riwayah: "Hafs",
  version: "15.0",
  publishedAt: "2026-09-30",
  fileName: "the-exact-downloaded-file.json",
  fileSha256: "64-character-sha256-hex-digest",
  termsReviewed: true
});
```

The rows in tests are synthetic structural fixtures only. They are not Qur'an text and must never be used as a replacement dataset. See `source-manifest.json` for the identified archive, checksum reported by the source mirror, and current verification status. The JSON payload was imported successfully in GitHub Actions and independently inspected: 6,236 unique ayah records, all 114 surahs, and no missing Uthmani or Imla'i text. The generated artifact remains a temporary workflow artifact; it has not been committed to the public repository.

## Automated local acquisition

Run `npm run import:kfgqpc` from the repository root. The script downloads the official ZIP archive directly from the Complex's documented download host (or reuses a previously downloaded archive in `data/_raw/`), checks the archive size and SHA-256 against the currently recorded source-mirror values, extracts `hafsData_v2-0.json`, validates all 6,236 ayahs and writes `data/quran-hafs.json`.

The importer deliberately stops if the pinned file's size or Git blob hash differs. It never modifies the source text and does not publish the resulting dataset.

The raw archive and generated JSON are local build inputs and are excluded from Git. Before distributing either file or bundling the font, review the exact KFGQPC package terms for the intended use.


## Current acquisition path (pinned mirror fallback)

The official KFGQPC download host failed TLS name validation from GitHub Actions in the current environment. The importer therefore now downloads the KFGQPC Hafs v18 CSV from a **pinned commit** of the public `thetruetruth/quran-data-kfgqpc` mirror. It checks the exact byte length and Git blob SHA-1 before parsing, then validates all 6,236 ayahs and the expected count in each of the 114 surahs.

This fallback is transparently identified in the generated dataset and in `data/source-manifest.json`. It is a mirror of KFGQPC data, not a direct official-host download. The source README identifies the data as KFGQPC Uthmanic Hafs v18, update 10.0, dated 2021-10-25. The mirrored data's own redistribution terms still need review before bundling or publishing the dataset or font.
