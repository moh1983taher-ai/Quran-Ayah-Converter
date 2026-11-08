# Quran Ayah Converter

A standalone TypeScript engine for detecting Qur'anic quotations in Word documents and replacing only verified quotation ranges with the approved Uthmani Hafs text.

## Project principles

- The Qur'an text used for replacement must come from a verified, versioned source.
- Detection and replacement are separate stages.
- Every detected passage carries source offsets, candidate surah/ayah references, evidence, and a confidence level.
- Ambiguous matches are reported for review; they are never silently replaced.
- Word integration is an adapter around the independent core engine.
- The engine must preserve all text outside the approved quotation range.

## Architecture

```text
src/
  core/
    types.ts          Shared domain types
    normalizer.ts     Arabic normalization with source-offset mapping
    quran-index.ts    Local Qur'an index contract
  word/
    word-adapter.ts   Office.js integration boundary (planned)
tests/
  normalizer.test.ts
data/
  README.md           Data provenance and licensing requirements
```

## Current status

The core now includes deterministic matching plus a conservative word-level fuzzy alignment pass. The fuzzy pass tolerates a small number of omitted, inserted, or altered words and labels these results for manual review. It does not authorize automatic replacement. The implementation also prepares a document's token index once and reuses it across candidate ayahs.

This repository still does not include Qur'an text, fonts, a Word add-in manifest, or document replacement functionality.

## Data provenance

The intended primary reference is the King Fahd Glorious Qur'an Printing Complex developer platform:

- https://qurancomplex.gov.sa/quran-dev/

Before redistributing any Qur'an dataset or font, the exact file's terms of use and attribution requirements must be checked. The application must record the source, edition, version, and checksum of every imported dataset.

The intended data model keeps both:
- Uthmani text for verified replacement.
- Imla'i text for search and matching.

## Development

Requirements: Node.js 20 or later.

```bash
npm install
npm test
npm run typecheck
```

## License

The original source code in this repository is MIT-licensed. This license does **not** grant rights to third-party Qur'an datasets, fonts, or other assets; those remain subject to their respective terms.


### Ayah identity resolution

The core includes an evidence-weighted identity resolver. It ranks candidates using exact/normalized text, verse-bracket markers, explicit surah-and-ayah references, and fuzzy-alignment penalties. When two distinct identities have close scores, the detector returns an `ambiguous` result with the competing references instead of silently selecting one. Ambiguous results intentionally carry no canonical replacement text.

This is a conservative first resolver, not a scholarly verification engine. Its weights and ambiguity margin require evaluation against a representative corpus of real Word documents before production use.
