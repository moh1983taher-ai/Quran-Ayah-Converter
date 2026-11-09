import { QuranAyahDetector } from "../core/detector.js";
import { normalizeArabic } from "../core/normalizer.js";
import { loadQuranDatasetJson } from "../core/dataset-loader.js";
import { createReviewItems, groupBracketedAyahMatches, setReviewDecision, type ReviewItem } from "./review-workflow.js";
import { ensureOrnamentalVerseBrackets } from "./verse-format.js";
import { formatQuranCitation, hasMatchingQuranCitation } from "./quran-citation.js";
import { findLegacyBracketPairs, type MatchedBracketPair } from "./bracket-normalizer.js";


declare const Office: {
  onReady(callback: () => void): void;
  context: { requirements: { isSetSupported(name: string, version: string): boolean } };
};
declare const Word: {
  run<T>(callback: (context: WordContext) => Promise<T>): Promise<T>;
  run<T>(objects: WordRange[], callback: (context: WordContext) => Promise<T>): Promise<T>;
};
interface WordCollection<T> {
  items: T[];
  load(property: string): WordCollection<T>;
}
interface WordRange {
  text: string;
  font: { name: string };
  load(property: string): WordRange;
  expandTo(range: WordRange): WordRange;
  insertText(text: string, location: "Replace"): WordRange;
  search(query: string, options: { matchCase: boolean; matchWholeWord: boolean }): WordCollection<WordRange>;
}
interface WordParagraph { text: string; getRange(location?: "Content" | "Whole"): WordRange; }
interface WordContext { document: { body: { paragraphs: WordCollection<WordParagraph>; tables: WordCollection<unknown>; } }; trackedObjects: { add(object: WordRange): void; remove(object: WordRange): void; }; sync(): Promise<void>; }

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element: ${id}`);
  return element as T;
};
let reviewItems: ReviewItem[] = [];
interface StoredReviewedRange {
  range?: WordRange;
  paragraphIndex: number;
  start: number;
  end: number;
  expectedText: string;
}
const itemRanges = new Map<string, StoredReviewedRange>();
let datasetPromise: Promise<ReturnType<typeof loadQuranDatasetJson>> | undefined;
const toast = (message: string): void => {
  const node = byId<HTMLDivElement>("toast");
  node.textContent = message;
  node.classList.add("show");
  window.setTimeout(() => node.classList.remove("show"), 2800);
};
const setStatus = (title: string, detail: string, tag: string): void => {
  byId("statusTitle").textContent = title;
  byId("statusText").textContent = detail;
  byId("statusTag").textContent = tag;
};
async function loadDataset() {
  const response = await fetch("./data/quran-hafs.json", { cache: "no-store" });
  if (!response.ok) throw new Error("قاعدة المصحف غير موجودة في حزمة الإضافة بعد.");
  const loaded = loadQuranDatasetJson(await response.text());
  if (loaded.index.size !== 6236) throw new Error("قاعدة المصحف غير مكتملة؛ أوقفنا الفحص حمايةً للنص.");
  return loaded;
}
function updateApplyButton(): void {
  const count = reviewItems.filter(item => item.decision === "approved").length;
  const selectableCount = reviewItems.filter(item =>
    item.decision !== "applied" && item.status !== "ambiguous" && Boolean(item.replacementText.trim())
  ).length;
  const selectAllButton = byId<HTMLButtonElement>("selectAll");
  selectAllButton.disabled = selectableCount === 0;
  selectAllButton.textContent = selectableCount ? `تحديد الكل (${selectableCount})` : "تحديد الكل";
  const button = byId<HTMLButtonElement>("applyButton");
  button.disabled = count === 0;
  button.textContent = count ? `اعتماد ${count} وحدة للمراجعة النهائية ←` : "اعتماد المحدد ←";
}
function renderResults(): void {
  const root = byId<HTMLElement>("results");
  root.replaceChildren();
  byId("resultCount").textContent = String(reviewItems.length);
  byId("emptyState").hidden = reviewItems.length > 0;
  for (const item of reviewItems) {
    const card = document.createElement("article");
    card.className = "result-card";
    const top = document.createElement("div");
    top.className = "result-top";
    const ref = document.createElement("strong");
    ref.className = "ref-label";
    const repeatedExcerpt = item.references.length > 1 &&
      Boolean(item.replacementText) &&
      item.evidence.some(e =>
        e.type === "context" && e.detail.includes("المقتطف مكرر في المواضع المذكورة")
      );
    ref.textContent = item.references.map(r => `${r.surah}:${r.ayah}`).join("، ") +
      (repeatedExcerpt ? " — مكرر في مواضع متعددة" : "");
    const score = document.createElement("span");
    score.className = "confidence";
    score.textContent = `الثقة ${Math.round(item.confidence * 100)}٪`;
    top.append(ref, score);
    const original = document.createElement("p");
    original.className = "result-meta";
    original.textContent = "النص الموجود: " + item.originalText;
    const canonical = document.createElement("p");
    canonical.className = "verse-text";
    canonical.textContent = item.replacementText || "نتيجة ملتبسة؛ لا يمكن اعتمادها آليًا.";
    const evidence = document.createElement("div");
    evidence.className = "result-meta";
    evidence.textContent = item.evidence.map(e => e.detail).join(" · ");
    const label = document.createElement("label");
    label.className = "check-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = item.decision === "approved" || item.decision === "applied";
    const hasWordRange = itemRanges.has(item.id);
    // Approval is a review decision, not proof that Word can currently resolve
    // the replacement range. Range validation remains mandatory at apply time.
    checkbox.disabled = item.status === "ambiguous" || !item.replacementText || item.decision === "applied";
    checkbox.addEventListener("change", () => {
      reviewItems = setReviewDecision(reviewItems, [item.id], checkbox.checked ? "approved" : "rejected");
      updateApplyButton();
    });
    const labelText = item.decision === "applied"
      ? "تم تحويل هذا الموضع"
      : item.status === "ambiguous"
        ? "ملتبسة — غير قابلة للاعتماد"
        : repeatedExcerpt
          ? "أوافق على تحويل المقتطف المكرر"
          : !hasWordRange
            ? "أوافق على الآية (سيُتحقق من موضع الاستبدال عند التنفيذ)"
            : "أوافق على تحويل هذا الموضع";
    label.append(checkbox, document.createTextNode(labelText));
    card.append(top, original, canonical, evidence, label);
    root.append(card);
  }
  updateApplyButton();
}
async function releaseReviewedRanges(): Promise<void> {
  const entries = [...itemRanges.values()];
  const trackedRanges = entries.flatMap(entry => entry.range ? [entry.range] : []);
  if (trackedRanges.length) {
    await Word.run(trackedRanges, async context => {
      for (const range of trackedRanges) context.trackedObjects.remove(range);
      await context.sync();
    });
  }
  itemRanges.clear();
}


interface BracketParagraphSnapshot {
  paragraphIndex: number;
  text: string;
  pairs: MatchedBracketPair[];
}
let bracketSnapshots: BracketParagraphSnapshot[] = [];

function cancelBracketPreview(): void {
  bracketSnapshots = [];
  byId<HTMLElement>("bracketPreview").hidden = true;
  byId<HTMLButtonElement>("applyBracketsButton").disabled = true;
}

async function inspectLegacyBrackets(): Promise<void> {
  const scanButton = byId<HTMLButtonElement>("scanBracketsButton");
  scanButton.disabled = true;
  scanButton.textContent = "جارٍ فحص الأقواس…";
  cancelBracketPreview();
  setStatus("جارٍ فحص الأقواس", "قراءة فقرات المستند دون إجراء أي تعديل", "يفحص");
  try {
    await Word.run(async context => {
      const paragraphs = context.document.body.paragraphs.load("items");
      await context.sync();
      const ranges = paragraphs.items.map(paragraph => paragraph.getRange("Content").load("text"));
      await context.sync();

      bracketSnapshots = [];
      let pairCount = 0;
      let unmatchedCount = 0;
      for (let index = 0; index < ranges.length; index += 1) {
        const paragraphText = ranges[index]!.text;
        const result = findLegacyBracketPairs(paragraphText);
        if (result.pairs.length) {
          bracketSnapshots.push({
            paragraphIndex: index,
            text: paragraphText,
            pairs: result.pairs
          });
          pairCount += result.pairs.length;
        }
        unmatchedCount += result.unmatchedSymbolCount;
      }

      byId("bracketPairCount").textContent = String(pairCount);
      byId("bracketUnmatchedCount").textContent = String(unmatchedCount);
      byId("bracketPreviewText").textContent = pairCount
        ? "لم يتغير المستند. راجع العدد ثم اختر التوحيد لتنفيذ التعديلات."
        : "لم يُعثر على أزواج قديمة متطابقة؛ لم يُجرَ أي تعديل.";
      byId<HTMLElement>("bracketPreview").hidden = false;
      byId<HTMLButtonElement>("applyBracketsButton").disabled = pairCount === 0;
      setStatus(
        pairCount ? "اكتمل فحص الأقواس" : "لا توجد أقواس تحتاج إلى توحيد",
        `${pairCount} زوجًا متطابقًا · ${unmatchedCount} رمزًا غير مكتمل`,
        "اكتمل"
      );
      toast(pairCount
        ? `عُثر على ${pairCount} زوج متطابق. المستند لم يتغير.`
        : "لم يُعثر على أزواج أقواس قديمة متطابقة.");
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("تعذر فحص الأقواس", message, "توقف");
    toast(message);
    cancelBracketPreview();
  } finally {
    scanButton.disabled = false;
    scanButton.textContent = "فحص الأقواس";
  }
}

function countExactSymbolOccurrencesBefore(text: string, symbol: string, offset: number): number {
  let count = 0;
  let cursor = 0;
  while (cursor < offset) {
    const found = text.indexOf(symbol, cursor);
    if (found < 0 || found >= offset) break;
    count += 1;
    cursor = found + symbol.length;
  }
  return count;
}

async function applyLegacyBracketNormalization(): Promise<void> {
  if (!bracketSnapshots.length) return;
  const button = byId<HTMLButtonElement>("applyBracketsButton");
  button.disabled = true;
  byId<HTMLButtonElement>("scanBracketsButton").disabled = true;
  setStatus("جارٍ توحيد الأقواس", "إعادة التحقق من النص قبل تطبيق التغييرات", "ينفّذ");

  try {
    const totalPairs = bracketSnapshots.reduce((sum, item) => sum + item.pairs.length, 0);
    await Word.run(async context => {
      const paragraphs = context.document.body.paragraphs.load("items");
      await context.sync();

      const pendingReplacements: Array<{ paragraphIndex: number; offset: number; range: WordRange; replacement: string }> = [];

      // Phase one: validate every paragraph and resolve every exact symbol
      // before queuing a single document mutation. A failed lookup therefore
      // leaves the document entirely unchanged.
      for (const snapshot of bracketSnapshots) {
        const paragraph = paragraphs.items[snapshot.paragraphIndex];
        if (!paragraph) {
          throw new Error("تغيرت بنية المستند بعد المعاينة؛ أُلغي توحيد الأقواس.");
        }
        const liveRange = paragraph.getRange("Content").load("text");
        await context.sync();
        if (liveRange.text !== snapshot.text) {
          throw new Error("تغير نص إحدى الفقرات بعد المعاينة؛ أُلغي التنفيذ حمايةً للمستند.");
        }

        const replacements = snapshot.pairs.flatMap(pair => [
          { offset: pair.openingOffset, symbol: pair.opening, replacement: "﴿" },
          { offset: pair.closingOffset, symbol: pair.closing, replacement: "﴾" }
        ]).sort((a, b) => b.offset - a.offset);

        for (const item of replacements) {
          const occurrence = countExactSymbolOccurrencesBefore(
            snapshot.text, item.symbol, item.offset
          );
          const matches = paragraph.getRange("Content")
            .search(item.symbol, { matchCase: true, matchWholeWord: false })
            .load("items");
          await context.sync();
          for (const candidate of matches.items) candidate.load("text");
          await context.sync();

          const exactMatches = matches.items.filter(candidate => candidate.text === item.symbol);
          const target = exactMatches[occurrence];
          if (!target) {
            throw new Error("تعذر تحديد أحد رموز الأقواس تطابقًا حرفيًا؛ أُلغي التنفيذ دون تغيير المستند.");
          }
          pendingReplacements.push({
            paragraphIndex: snapshot.paragraphIndex,
            offset: item.offset,
            range: target,
            replacement: item.replacement
          });
        }
      }

      // Phase two: apply only after all ranges have passed validation.
      // Descending document offsets protect every remaining source position.
      pendingReplacements.sort((a, b) =>
        b.paragraphIndex - a.paragraphIndex || b.offset - a.offset
      );
      for (const item of pendingReplacements) {
        item.range.insertText(item.replacement, "Replace");
      }
      await context.sync();
    });

    cancelBracketPreview();
    setStatus("اكتمل توحيد الأقواس", `تم توحيد ${totalPairs} زوجًا إلى ﴿ ﴾.`, "اكتمل");
    toast(`تم توحيد ${totalPairs} زوجًا. بقي النص والتشكيل كما هما.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("أُلغي توحيد الأقواس", message, "توقف");
    toast(message);
    // Keep the preview so the user can inspect it or cancel; a fresh scan is
    // required before retrying because the live document may have changed.
    button.disabled = true;
  } finally {
    byId<HTMLButtonElement>("scanBracketsButton").disabled = false;
  }
}

async function inspectDocument(): Promise<void> {
  const button = byId<HTMLButtonElement>("scanButton");
  button.disabled = true;
  button.textContent = "جارٍ فحص المستند…";
  setStatus("جارٍ تحميل قاعدة المصحف", "التحقق من بيانات حفص قبل البحث", "يفحص");
  try {
    await releaseReviewedRanges();
    datasetPromise ??= loadDataset();
    const loaded = await datasetPromise;
    await Word.run(async context => {
      const paragraphs = context.document.body.paragraphs.load("items");
      const tables = context.document.body.tables.load("items");
      await context.sync();
      // Capture the actual editable content range, excluding the paragraph mark.
      const contentRanges = paragraphs.items.map(paragraph => paragraph.getRange("Content").load("text"));
      await context.sync();
      const detector = new QuranAyahDetector(loaded.index);
      reviewItems = [];
      itemRanges.clear();
      for (let index = 0; index < paragraphs.items.length; index += 1) {
        const paragraph = paragraphs.items[index]!;
        const paragraphText = contentRanges[index]!.text;
        const detected = detector.detect(paragraphText);
        const grouped = groupBracketedAyahMatches(paragraphText, detected);
        const local = createReviewItems(paragraphText, grouped);
        const scoped = local.map(item => ({
          ...item,
          id: `p${index}:${item.id}`,
          // Every approved replacement uses the Qur'anic ornamental brackets.
          replacementText: `﴿${item.replacementText}﴾`,
          evidence: [...item.evidence, { type: "context" as const, detail: `الفقرة ${index + 1}` }]
        }));

        for (const item of scoped) {
          if (item.status === "ambiguous" || !item.replacementText.trim()) continue;

          let start = item.sourceStart;
          let end = item.sourceEnd;
          // Include any existing verse delimiters in the replacement range,
          // including the legacy private-use glyph pair used by older documents.
          const bracketPairs: ReadonlyArray<readonly [string, string]> = [
            ["﴿", "﴾"],
            ["", ""]
          ];
          const opening = paragraphText[start - 1];
          const closing = paragraphText[end];
          if (bracketPairs.some(([left, right]) => opening === left && closing === right)) {
            start -= 1;
            end += 1;
          }

          const stored: StoredReviewedRange = {
            paragraphIndex: index,
            start,
            end,
            expectedText: paragraphText.slice(start, end)
          };
          itemRanges.set(item.id, stored);
          try {
            const resolved = await resolveReviewedRange(context, paragraph, paragraphText, start, end);
            stored.range = resolved.range;
          } catch (error) {
            const detail = error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error);
            item.evidence.push({
              type: "context",
              detail: `تعذر تثبيت موضع الآية: ${detail}`
            });
          }
        }
        reviewItems.push(...scoped);
      }
      renderResults();
      setStatus("اكتمل فحص المستند", `${paragraphs.items.length} فقرة · ${tables.items.length} جدول · ${reviewItems.length} وحدة مراجعة`, "اكتمل");
      if (!reviewItems.length) {
        byId("emptyState").querySelector("strong")!.textContent = "لم نعثر على اقتباسات";
        byId("emptyState").querySelector("p")!.textContent = "لم تظهر مطابقات وفق قواعد الفحص الحالية.";
      }
      toast(`اكتمل الفحص: ${reviewItems.length} نتيجة. لم يتغير المستند.`);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("تعذر إكمال الفحص", message, "توقف");
    toast(message);
  } finally {
    button.disabled = false;
    button.innerHTML = "<span>⌕</span> فحص المستند";
  }
}

/**
 * Build the exact reviewed range from Word's absolute character positions.
 * No Search API, anchors, or paragraph reconstruction are used.
 */
function countAnchorOccurrencesBefore(text: string, anchor: string, offset: number): number {
  let count = 0;
  let cursor = 0;
  while (cursor < offset) {
    const found = text.indexOf(anchor, cursor);
    if (found < 0 || found >= offset) break;
    count += 1;
    cursor = found + anchor.length;
  }
  return count;
}

/**
 * Resolves a range once during scanning, verifies it, and tracks the actual
 * Word.Range proxy so the approval phase can reuse that same object.
 */
function normalizeForWordRange(text: string): string {
  return normalizeArabic(text).replace(/\\s+/gu, " ").trim();
}

async function resolveReviewedRange(
  context: WordContext,
  paragraph: WordParagraph,
  snapshot: string,
  start: number,
  end: number
): Promise<{ range: WordRange }> {
  const expected = snapshot.slice(start, end);
  if (!expected) throw new Error("نطاق الآية فارغ؛ أُلغي تثبيت الموضع.");

  const content = paragraph.getRange("Content");
  const options = { matchCase: true, matchWholeWord: false };
  let exactRange: WordRange;

  if (expected.length <= 240) {
    const occurrence = countAnchorOccurrencesBefore(snapshot, expected, start);
    const matches = content.search(expected, options).load("items");
    await context.sync();
    for (const candidate of matches.items) candidate.load("text");
    await context.sync();

    // Word search can return near-matches for Arabic text (for example,
    // differences involving diacritics). Keep only byte-for-byte text matches
    // before using the occurrence index derived from the paragraph snapshot.
    const exactMatches = matches.items.filter(candidate => normalizeForWordRange(candidate.text) === normalizeForWordRange(expected));
    const match = exactMatches[occurrence];
    if (!match) {
      throw new Error(`لم يُعثر على تطابق حرفي في نتائج Word (الموضع ${occurrence + 1} من ${exactMatches.length}).`);
    }
    exactRange = match;
  } else {
    // Word Search is limited to 255 characters; search two real text segments.
    const chunkLength = Math.min(200, Math.floor(expected.length / 2));
    const prefix = expected.slice(0, chunkLength);
    const suffix = expected.slice(expected.length - chunkLength);
    const prefixOccurrence = countAnchorOccurrencesBefore(snapshot, prefix, start);
    const suffixOccurrence = countAnchorOccurrencesBefore(snapshot, suffix, end - chunkLength);

    const prefixMatches = content.search(prefix, options).load("items");
    const suffixMatches = content.search(suffix, options).load("items");
    await context.sync();
    for (const candidate of [...prefixMatches.items, ...suffixMatches.items]) candidate.load("text");
    await context.sync();

    const exactPrefixes = prefixMatches.items.filter(candidate => normalizeForWordRange(candidate.text) === normalizeForWordRange(prefix));
    const exactSuffixes = suffixMatches.items.filter(candidate => normalizeForWordRange(candidate.text) === normalizeForWordRange(suffix));
    const prefixRange = exactPrefixes[prefixOccurrence];
    const suffixRange = exactSuffixes[suffixOccurrence];
    if (!prefixRange || !suffixRange) {
      throw new Error("تعذر تثبيت بداية الآية ونهايتها بتطابق حرفي في Word.");
    }
    exactRange = prefixRange.expandTo(suffixRange).load("text");
    await context.sync();
  }

  // Short exact matches already loaded candidate text in the search batch above;
  // avoid issuing a second load/sync for the same Word.Range proxy.
  if (normalizeForWordRange(exactRange.text) !== normalizeForWordRange(expected)) {
    throw new Error("موضع Word لا يطابق نص الآية الذي تمت مراجعته.");
  }

  // Persist the exact range through Office.js trackedObjects for the later
  // approval/apply Word.run session. Collections used to discover it need not be tracked.
  context.trackedObjects.add(exactRange);
  await context.sync();
  return { range: exactRange };
}

async function applyApprovedReplacements(): Promise<void> {
  const approved = reviewItems.filter(item => item.decision === "approved");
  if (!approved.length) return;

  const addCitations = byId<HTMLInputElement>("addCitations").checked;
  const quranIndex = addCitations
    ? await (datasetPromise ??= loadDataset()).then(loaded => loaded.index)
    : undefined;

  const entries = approved.map(item => {
    const stored = itemRanges.get(item.id);
    if (!stored) throw new Error("بيانات موضع الآية غير موجودة؛ أعد فحص المستند.");
    return { item, ...stored };
  });

  const button = byId<HTMLButtonElement>("applyButton");
  button.disabled = true;
  setStatus("جارٍ إعادة تحديد المواضع", "التحقق من النص داخل الفقرات قبل أي تعديل", "يتحقق");
  try {
    await Word.run(async context => {
      const paragraphs = context.document.body.paragraphs.load("items");
      await context.sync();

      const currentRanges = entries.map(entry => {
        const paragraph = paragraphs.items[entry.paragraphIndex];
        if (!paragraph) throw new Error("لم تعد الفقرة الأصلية موجودة؛ أُلغي الاستبدال.");
        return paragraph.getRange("Content").load("text");
      });
      await context.sync();

      const resolvedEntries: Array<typeof entries[number] & { range: WordRange; paragraphText: string }> = [];
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i]!;
        const paragraph = paragraphs.items[entry.paragraphIndex]!;
        const currentText = currentRanges[i]!.text;
        if (currentText.slice(entry.start, entry.end) !== entry.expectedText) {
          throw new Error("تغير النص أو موضع إحدى الآيات بعد الفحص؛ أُلغي الاستبدال حمايةً للمستند.");
        }
        const resolved = await resolveReviewedRange(
          context, paragraph, currentText, entry.start, entry.end
        );
        resolvedEntries.push({ ...entry, range: resolved.range, paragraphText: currentText });
      }

      const ordered = [...resolvedEntries].sort((a, b) =>
        a.paragraphIndex - b.paragraphIndex || b.start - a.start
      );
      for (let i = 1; i < ordered.length; i += 1) {
        const previous = ordered[i - 1]!;
        const current = ordered[i]!;
        if (previous.paragraphIndex === current.paragraphIndex &&
            current.end > previous.start) {
          throw new Error("تداخل نطاقا آيتين معتمدتين؛ أُلغي التنفيذ حمايةً للمستند.");
        }
      }

      for (const entry of ordered) {
        const finalVerseText = ensureOrnamentalVerseBrackets(entry.item.replacementText);
        const citation = quranIndex
          ? formatQuranCitation(entry.item.references, quranIndex)
          : undefined;
        const citationAlreadyPresent = citation
          ? hasMatchingQuranCitation(entry.paragraphText.slice(entry.end), citation)
          : false;
        const replacement = citation && !citationAlreadyPresent
          ? `${finalVerseText} ${citation}`
          : finalVerseText;
        const inserted = entry.range.insertText(replacement, "Replace");
        inserted.font.name = "KFGQPC Uthmanic Script HAFS";
      }
      await context.sync();
      for (const entry of resolvedEntries) context.trackedObjects.remove(entry.range);
      await context.sync();
    });

    for (const item of approved) itemRanges.delete(item.id);
    reviewItems = reviewItems.map(item =>
      item.decision === "approved" ? { ...item, decision: "applied" } : item
    );
    renderResults();
    setStatus("اكتمل الاستبدال", `تم تحويل ${approved.length} وحدة معتمدة بعد إعادة التحقق منها.`, "اكتمل");
    toast(`اكتمل تحويل ${approved.length} وحدة معتمدة.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("أُلغي الاستبدال", message, "توقف");
    toast(message);
  } finally {
    button.disabled = reviewItems.every(item => item.decision !== "approved");
  }
}
Office.onReady(() => {
  byId<HTMLButtonElement>("scanButton").addEventListener("click", () => void inspectDocument());
  byId<HTMLButtonElement>("scanBracketsButton").addEventListener("click", () => void inspectLegacyBrackets());
  byId<HTMLButtonElement>("applyBracketsButton").addEventListener("click", () => void applyLegacyBracketNormalization());
  byId<HTMLButtonElement>("cancelBracketsButton").addEventListener("click", cancelBracketPreview);
  byId<HTMLButtonElement>("selectAll").addEventListener("click", () => {
    const selectableIds = reviewItems
      .filter(item => item.decision !== "applied" && item.status !== "ambiguous" && Boolean(item.replacementText.trim()))
      .map(item => item.id);
    reviewItems = setReviewDecision(reviewItems, selectableIds, "approved");
    renderResults();
    toast(`تم تحديد ${selectableIds.length} نتيجة قابلة للاعتماد. لم يُعدّل المستند.`);
  });
  byId<HTMLButtonElement>("selectNone").addEventListener("click", () => {
    reviewItems = reviewItems.map(item => item.decision === "applied" ? item : ({ ...item, decision: "pending" }));
    renderResults();
    toast("أُلغي تحديد جميع النتائج.");
  });
  byId<HTMLButtonElement>("applyButton").addEventListener("click", () => void applyApprovedReplacements());
});