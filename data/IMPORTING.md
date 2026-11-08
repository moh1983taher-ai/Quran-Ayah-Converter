# Importing the official Hafs dataset

The importer accepts the developer export published by the King Fahd Glorious Qur'an Printing Complex (KFGQPC).

Official portal: https://qurancomplex.gov.sa/quran-dev/

## Preferred edition

Use **Unicode Uthmanic Font (Hafs Narration)**, not the separate smart-device font, when selecting the display font. The official portal lists that font's Hafs update as 15.0, last modified 2026-09-30. This font version must not be assumed to be the dataset release version; record the dataset's own version separately. The portal documents these useful columns:

- `sura_no`, `sura_name_ar`, `aya_no`
- `aya_text_unicode` — display/replacement text
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

The rows in tests are synthetic structural fixtures only. They are not Qur'an text and must never be used as a replacement dataset.
