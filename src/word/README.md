# Word task pane

The Word add-in task pane is served from GitHub Pages. The deployment workflow bundles `taskpane.ts` and publishes the HTML, CSS, JavaScript bundle, and application icons.

## Build

```bash
npm install
npm run typecheck
npm test
npm run build:taskpane
```

## Current integration

- Reads document body paragraphs and detects candidate Qur'anic quotations.
- Presents references, confidence, and evidence for explicit review.
- Re-reads and verifies the live paragraph before replacement.
- Resolves each approved quotation to one unique Word search range.
- Rejects changed paragraphs, missing anchors, repeated ambiguous anchors, and overlapping ranges.
- Replaces only the approved ranges, processing later ranges first.
- Tracks completed items to prevent accidental repeat conversion.

Tables, footnotes, and endnotes are not yet traversed. Preservation of mixed formatting within replaced ranges still requires testing in desktop Word and Word on the web.

## Dataset gate

The task pane loads `./data/quran-hafs.json` and stops safely when it is absent or invalid. The repository currently does not publish this file because the redistribution terms of the available Quran dataset have not yet been cleared. Do not add the dataset or Quran fonts to the Pages deployment until their exact licensing terms are reviewed.
