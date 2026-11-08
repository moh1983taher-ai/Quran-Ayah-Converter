# Word task pane

Build with `npm install` then `npm run build:taskpane`.

The HTML loads the generated `taskpane.js` bundle. The validated Quran dataset is not committed by default. Package a legally distributable `quran-hafs.json` at `src/word/data/quran-hafs.json` (or the matching deployed URL) before scanning. The task pane fails closed if the dataset is absent, malformed, or does not contain 6,236 ayahs.

Current scope:
- Reads document body paragraphs.
- Runs the deterministic detector on each paragraph.
- Displays candidate text, references, confidence and evidence.
- Keeps every result pending until explicit user approval.
- Does not mutate the document yet.
- Tables are counted but not traversed; footnotes and endnotes are not supported yet.
