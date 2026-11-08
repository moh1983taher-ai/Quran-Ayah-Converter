# Quran Ayah Converter

A standalone TypeScript engine and Microsoft Word task pane for detecting Qur'anic quotations and preparing verified replacements using Uthmani Hafs text.

## Project principles

- Quran text used for replacement must come from a verified, versioned source.
- Detection, human review, and replacement are separate stages.
- Ambiguous matches are never silently replaced.
- Word ranges are revalidated immediately before replacement.
- Only approved quotation ranges are changed; surrounding paragraph text is not rebuilt.
- Quran datasets and fonts are not redistributed until their specific terms are reviewed.

## Repository layout

- `src/core/`: Arabic normalization, indexing, alignment, and detection.
- `src/word/`: Word task pane and guarded Office.js adapter.
- `tests/`: automated unit and integration tests.
- `data/`: provenance and import metadata; no redistributable Quran dataset is currently committed.
- `manifest.xml`: Microsoft Word task pane add-in manifest.
- `.github/workflows/deploy-word-addin.yml`: build and GitHub Pages deployment.

## Build and test

```bash
npm install
npm run typecheck
npm test
npm run build:taskpane
```

## Deployment

GitHub Actions builds the task pane and publishes the static site to GitHub Pages. The manifest's task pane URL is:

`https://moh1983taher-ai.github.io/Quran-Ayah-Converter/taskpane.html`

The add-in will not complete a scan until a validated `data/quran-hafs.json` is supplied. This is intentional: the app fails closed rather than using guessed or unverified Quran text.

## Current limitations

- Body paragraphs are supported; tables, footnotes, and endnotes are not yet traversed.
- Word range replacement is guarded by exact-text and unique-search checks.
- Mixed-format preservation inside the replaced range still needs verification in actual Word clients.
- The dataset's redistribution rights have not yet been cleared.

The MIT license in this repository applies to original source code only, not third-party Quran datasets, fonts, or other assets.
