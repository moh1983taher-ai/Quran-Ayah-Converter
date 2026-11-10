import { QuranAyahDetector } from "../core/detector.js";
import { normalizeArabic } from "../core/normalizer.js";
import { loadQuranDatasetJson } from "../core/dataset-loader.js";
import { createReviewItems, createScopedReviewItems, getReviewSelectionCounts, groupBracketedAyahMatches, setReviewDecision, type ReviewItem } from "./review-workflow.js";
import { ensureOrnamentalVerseBrackets } from "./verse-format.js";
import { formatQuranCitation, hasMatchingQuranCitation, inspectAdjacentQuranCitation } from "./quran-citation.js";
import { findLegacyBracketPairs, type MatchedBracketPair } from "./bracket-normalizer.js";
import { validateQuranCitations, type QuranCitationIssue } from "./citation-validator.js";


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
  isNullObject: boolean;
  paragraphs: WordCollection<WordParagraph>;
  font: { name: string };
  load(property: string): WordRange;
  expandTo(range: WordRange): WordRange;
  intersectWithOrNullObject(range: WordRange): WordRange;
  insertText(text: string, location: "Replace"): WordRange;
  search(query: string, options: { matchCase: boolean; matchWholeWord: boolean }): WordCollection<WordRange>;
}
interface WordParagraph { text: string; getRange(location?: "Content" | "Whole"): WordRange; }
interface WordContext { document: { getSelection(): WordRange; body: { paragraphs: WordCollection<WordParagraph>; tables: WordCollection<unknown>; } }; trackedObjects: { add(object: WordRange): void; remove(object: WordRange): void; }; sync(): Promise<void>; }

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element: ${id}`);
  return element as T;
};
let reviewItems: ReviewItem[] = [];
interface StoredReviewedRange {
  range?: WordRange;
  scope?: "selection";
  scopeSnapshot?: string;
  /** Tracked Word range representing the exact selected paragraph intersection. */
  scopeRange?: WordRange;
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

/**
 * Report real scan work completed. The counter is stage-specific: paragraphs
 * during detection and individual ranges during Word range resolution.
 */
function updateScanProgress(
  phase: string,
  completed: number,
  total: number,
  detail?: string
): void {
  const panel = byId<HTMLElement>("scanProgress");
  const bar = byId<HTMLElement>("scanProgressBar");
  const fill = bar.querySelector<HTMLElement>("span");
  if (!fill) throw new Error("Missing scan progress fill element.");
  const phaseNode = byId<HTMLElement>("scanProgressPhase");
  const countNode = byId<HTMLElement>("scanProgressCount");
  const remainingNode = byId<HTMLElement>("scanProgressRemaining");
  const percentNode = byId<HTMLElement>("scanProgressPercent");
  const safeTotal = Math.max(0, total);
  const safeCompleted = Math.min(Math.max(0, completed), safeTotal);
  const percent = safeTotal ? Math.round((safeCompleted / safeTotal) * 100) : 0;
  panel.hidden = false;
  phaseNode.textContent = phase;
  countNode.textContent = safeTotal
    ? `${safeCompleted.toLocaleString("ar")} من ${safeTotal.toLocaleString("ar")}`
    : (detail ?? "جارٍ التحضير…");
  remainingNode.textContent = safeTotal
    ? `المتبقي: ${(safeTotal - safeCompleted).toLocaleString("ar")}`
    : "";
  percentNode.textContent = safeTotal ? `${percent.toLocaleString("ar")}٪` : "…";
  fill.style.width = `${percent}%`;
  bar.setAttribute("aria-valuenow", String(percent));
  bar.setAttribute("aria-valuetext", safeTotal
    ? `${percent} بالمئة، أُنجز ${safeCompleted} من ${safeTotal}`
    : phase);
  panel.classList.toggle("is-indeterminate", safeTotal === 0);
}

/** Yield to the task pane so progress updates can paint during long scans. */
function yieldToUi(): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, 0));
}

interface ScanDiagnostics {
  totalMs: number;
  datasetMs: number;
  wordReadMs: number;
  detectionMs: number;
  rangeMs: number;
  renderMs: number;
  paragraphCount: number;
  characterCount: number;
  detectedCount: number;
  rangeRequestCount: number;
  resolvedRangeCount: number;
  detector?: {
    detectCalls: number; bracketPassageCalls: number; bracketPassageMs: number;
    exactPassageMs: number; fuzzyPassageMs: number; fuzzyCandidateRecords: number;
    fuzzyAlignmentCalls: number; overlapResolutionMs: number;
  };
}
function formatElapsed(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  if (milliseconds < 1000) return `${Math.round(milliseconds)} مللي ثانية`;
  return `${(milliseconds / 1000).toFixed(2)} ثانية`;
}
function renderScanDiagnostics(metrics: ScanDiagnostics): void {
  const root = byId<HTMLElement>("scanDiagnostics");
  const values: Array<[string, number]> = [
    ["تحميل قاعدة المصحف وتجهيزها", metrics.datasetMs],
    ["قراءة المستند من Word", metrics.wordReadMs],
    ["كشف الآيات وتجهيز النتائج", metrics.detectionMs],
    ["تحديد مواضع الآيات داخل Word", metrics.rangeMs],
    ["بناء بطاقات المراجعة وعرضها", metrics.renderMs],
    ...(metrics.detector ? [
      ["المطابقة الدقيقة للمقاطع", metrics.detector.exactPassageMs],
      ["المطابقة التقريبية", metrics.detector.fuzzyPassageMs],
      ["مطابقة الاقتباسات المحاطة بأقواس", metrics.detector.bracketPassageMs],
      ["معالجة تداخل النتائج", metrics.detector.overlapResolutionMs]
    ] as Array<[string, number]> : [])
  ];
  const list = byId<HTMLElement>("scanDiagnosticsRows");
  list.replaceChildren();
  for (const [label, duration] of values) {
    const row = document.createElement("div");
    row.className = "diagnostic-row";
    const name = document.createElement("span");
    name.textContent = label;
    const time = document.createElement("strong");
    time.textContent = formatElapsed(duration);
    row.append(name, time);
    list.append(row);
  }
  byId("scanDiagnosticsTotal").textContent = formatElapsed(metrics.totalMs);
  byId("scanDiagnosticsSummary").textContent =
    `${metrics.paragraphCount.toLocaleString("ar")} فقرة · ${metrics.characterCount.toLocaleString("ar")} محرف · ${metrics.detectedCount.toLocaleString("ar")} نتيجة · ${metrics.resolvedRangeCount.toLocaleString("ar")} موضعًا ثُبّت من أصل ${metrics.rangeRequestCount.toLocaleString("ar")} طلب`;
  if (metrics.detector) {
    byId<HTMLElement>("scanDiagnosticsSummary").textContent +=
      ` · مرشحو التقريب: ${metrics.detector.fuzzyCandidateRecords.toLocaleString("ar")} · محاذاة منفذة: ${metrics.detector.fuzzyAlignmentCalls.toLocaleString("ar")}`;
  }
  root.hidden = false;
}
async function loadDataset() {
  const response = await fetch("./data/quran-hafs.json", { cache: "no-store" });
  if (!response.ok) throw new Error("قاعدة المصحف غير موجودة في حزمة الإضافة بعد.");
  const loaded = loadQuranDatasetJson(await response.text());
  if (loaded.index.size !== 6236) throw new Error("قاعدة المصحف غير مكتملة؛ أوقفنا الفحص حمايةً للنص.");
  return loaded;
}
function updateApplyButton(): void {
  const { approvedCount: count, selectableCount } = getReviewSelectionCounts(reviewItems);
  const selectAllButton = byId<HTMLButtonElement>("selectAll");
  selectAllButton.disabled = selectableCount === 0;
  selectAllButton.textContent = selectableCount ? `تحديد الكل (${selectableCount})` : "تحديد الكل";
  const selectNoneButton = byId<HTMLButtonElement>("selectNone");
  selectNoneButton.disabled = count === 0;
  selectNoneButton.textContent = count ? `إلغاء التحديد (${count})` : "إلغاء التحديد";
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
    const citationEvidence = item.citationReview
      ? `التخريج: ${item.citationReview.detail}`
      : "";
    evidence.textContent = [
      ...item.evidence.map(e => e.detail),
      ...(citationEvidence ? [citationEvidence] : [])
    ].join(" · ");
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
  const trackedRanges = [...new Set(entries.flatMap(entry => [
    ...(entry.range ? [entry.range] : []),
    ...(entry.scopeRange ? [entry.scopeRange] : [])
  ]))];
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
  const scanStartedAt = performance.now();
  const metrics: ScanDiagnostics = {
    totalMs: 0, datasetMs: 0, wordReadMs: 0, detectionMs: 0,
    rangeMs: 0, renderMs: 0, paragraphCount: 0, characterCount: 0,
    detectedCount: 0, rangeRequestCount: 0, resolvedRangeCount: 0
  };
  const button = byId<HTMLButtonElement>("scanButton");
  button.disabled = true;
  button.textContent = "جارٍ فحص المستند…";
  updateScanProgress("تحميل قاعدة المصحف", 0, 0, "التحقق من بيانات حفص قبل البحث");
  setStatus("جارٍ تحميل قاعدة المصحف", "التحقق من بيانات حفص قبل البحث", "يفحص");
  try {
    const datasetStartedAt = performance.now();
    await releaseReviewedRanges();
    datasetPromise ??= loadDataset();
    const loaded = await datasetPromise;
    metrics.datasetMs = performance.now() - datasetStartedAt;
    updateScanProgress("قراءة المستند من Word", 0, 0, "جارٍ قراءة الفقرات والجداول");
    await Word.run(async context => {
      const wordReadStartedAt = performance.now();
      const paragraphs = context.document.body.paragraphs.load("items");
      const tables = context.document.body.tables.load("items");
      await context.sync();
      // Capture the actual editable content range, excluding the paragraph mark.
      const contentRanges = paragraphs.items.map(paragraph => paragraph.getRange("Content").load("text"));
      await context.sync();
      metrics.wordReadMs = performance.now() - wordReadStartedAt;
      metrics.paragraphCount = paragraphs.items.length;
      metrics.characterCount = contentRanges.reduce((sum, range) => sum + range.text.length, 0);
      const detectionStartedAt = performance.now();
      const detector = new QuranAyahDetector(loaded.index);
      updateScanProgress("كشف الآيات في فقرات المستند", 0, paragraphs.items.length);
      reviewItems = [];
      itemRanges.clear();
      const pendingRangeRequests: Array<{ item: ReviewItem; stored: StoredReviewedRange; paragraph: WordParagraph; snapshot: string }> = [];
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

          const expectedCitation = formatQuranCitation(item.references, loaded.index);
          const citationReview = inspectAdjacentQuranCitation(
            paragraphText, end, expectedCitation, item.references, loaded.index
          );
          item.citationReview = citationReview;
          // A clearly incorrect adjacent citation is part of this review unit.
          // The stored range then covers verse + separator + citation, so a
          // single guarded Word replacement repairs both without duplication.
          if (citationReview.status === "incorrect" && citationReview.end !== undefined) {
            end = citationReview.end;
          }
          const stored: StoredReviewedRange = {
            paragraphIndex: index,
            start,
            end,
            expectedText: paragraphText.slice(start, end)
          };
          itemRanges.set(item.id, stored);
          pendingRangeRequests.push({ item, stored, paragraph, snapshot: paragraphText });
        }
        reviewItems.push(...scoped);
        // Update only after a paragraph has been fully processed.
        updateScanProgress("كشف الآيات في فقرات المستند", index + 1, paragraphs.items.length);
        // Let the browser paint the counter before the next CPU-heavy paragraph.
        await yieldToUi();
      }
      metrics.detectionMs = performance.now() - detectionStartedAt;
      metrics.detector = detector.getDiagnostics();
      metrics.detectedCount = reviewItems.length;
      metrics.rangeRequestCount = pendingRangeRequests.length;
      const rangeStartedAt = performance.now();
      updateScanProgress("تثبيت مواضع الآيات داخل Word", 0, pendingRangeRequests.length);
      // Word search calls are queued in bounded batches; Office.js performs
      // only a small number of sync round-trips per batch, not per quotation.
      const scanBatchSize = 60;
      for (let offset = 0; offset < pendingRangeRequests.length; offset += scanBatchSize) {
        const batch = pendingRangeRequests.slice(offset, offset + scanBatchSize);
        const resolved = await resolveReviewedRangesBatch(context, batch.map(entry => ({
          searchScope: entry.paragraph.getRange("Content"),
          snapshot: entry.snapshot,
          start: entry.stored.start,
          end: entry.stored.end
        })));
        resolved.forEach((result, index) => {
          const entry = batch[index]!;
          if (result.range) {
            entry.stored.range = result.range;
          } else {
            entry.item.evidence.push({
              type: "context",
              detail: `تعذر تثبيت موضع الآية: ${result.error ?? "تعذر التحقق من النطاق"}`
            });
          }
        });
        updateScanProgress(
          "تثبيت مواضع الآيات داخل Word",
          Math.min(offset + batch.length, pendingRangeRequests.length),
          pendingRangeRequests.length
        );
        await yieldToUi();
      }
      metrics.rangeMs = performance.now() - rangeStartedAt;
      metrics.resolvedRangeCount = pendingRangeRequests.filter(entry => Boolean(entry.stored.range)).length;

      const renderStartedAt = performance.now();
      renderResults();
      metrics.renderMs = performance.now() - renderStartedAt;
      updateScanProgress("اكتمل فحص المستند", 1, 1);
      setStatus("اكتمل فحص المستند", `${paragraphs.items.length} فقرة · ${tables.items.length} جدول · ${reviewItems.length} وحدة مراجعة`, "اكتمل");
      if (!reviewItems.length) {
        byId("emptyState").querySelector("strong")!.textContent = "لم نعثر على اقتباسات";
        byId("emptyState").querySelector("p")!.textContent = "لم تظهر مطابقات وفق قواعد الفحص الحالية.";
      }
      toast(`اكتمل الفحص: ${reviewItems.length} نتيجة. لم يتغير المستند.`);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateScanProgress("توقف الفحص", 0, 0, message);
    setStatus("تعذر إكمال الفحص", message, "توقف");
    toast(message);
  } finally {
    metrics.totalMs = performance.now() - scanStartedAt;
    renderScanDiagnostics(metrics);
    button.disabled = false;
    button.innerHTML = "<span>⌕</span> فحص المستند";
  }
}



async function inspectSelectedText(): Promise<void> {
  const scanStartedAt = performance.now();
  const metrics: ScanDiagnostics = {
    totalMs: 0, datasetMs: 0, wordReadMs: 0, detectionMs: 0,
    rangeMs: 0, renderMs: 0, paragraphCount: 0, characterCount: 0,
    detectedCount: 0, rangeRequestCount: 0, resolvedRangeCount: 0
  };
  const button = byId<HTMLButtonElement>("scanSelectionButton");
  button.disabled = true;
  button.textContent = "جارٍ فحص النص المحدد…";
  updateScanProgress("تحميل قاعدة المصحف", 0, 0, "التحقق من بيانات حفص قبل البحث");
  setStatus("جارٍ فحص النص المحدد", "تجزئة التحديد إلى فقرات وفحصها تدريجيًا دون المساس ببقية المستند", "يفحص");

  try {
    const datasetStartedAt = performance.now();
    await releaseReviewedRanges();
    reviewItems = [];
    itemRanges.clear();
    renderResults();
    datasetPromise ??= loadDataset();
    const loaded = await datasetPromise;
    metrics.datasetMs = performance.now() - datasetStartedAt;

    await Word.run(async context => {
      const wordReadStartedAt = performance.now();
      const selection = context.document.getSelection();
      const selectedParagraphs = selection.paragraphs.load("items");
      await context.sync();

      if (selectedParagraphs.items.length === 0) {
        throw new Error("لم يُحدّد نص قابل للفحص. ظلّل النص المراد فحصه ثم أعد المحاولة.");
      }

      // WordApi 1.3 is declared by this add-in's manifest. Intersecting each
      // paragraph with the actual selection clips partial first/last paragraphs
      // and prevents scanning text outside the user's selection.
      const paragraphIntersections = selectedParagraphs.items.map((paragraph, index) => ({
        paragraphIndex: index,
        range: paragraph.getRange("Content")
          .intersectWithOrNullObject(selection)
          .load("text")
      }));
      updateScanProgress(
        "قراءة فقرات النص المحدد",
        0,
        0,
        `تحديد نطاق ${selectedParagraphs.items.length.toLocaleString("ar")} فقرة داخل التحديد`
      );
      await context.sync();

      const segments = paragraphIntersections
        .filter(entry => !entry.range.isNullObject && entry.range.text.length > 0)
        .map(entry => ({
          paragraphIndex: entry.paragraphIndex,
          range: entry.range,
          text: entry.range.text
        }));

      if (segments.length === 0) {
        throw new Error("التحديد لا يحتوي على نص داخل الفقرات. تأكد من تظليل النص نفسه لا موضع المؤشر فقط.");
      }

      metrics.wordReadMs = performance.now() - wordReadStartedAt;
      metrics.paragraphCount = segments.length;
      metrics.characterCount = segments.reduce((sum, segment) => sum + segment.text.length, 0);

      const detector = new QuranAyahDetector(loaded.index);
      const detectionStartedAt = performance.now();
      reviewItems = [];
      itemRanges.clear();
      const pending: Array<{
        item: ReviewItem;
        stored: StoredReviewedRange;
        searchScope: WordRange;
        snapshot: string;
      }> = [];
      const bracketPairs: ReadonlyArray<readonly [string, string]> = [
        ["﴿", "﴾"],
        ["", ""]
      ];
      // Keep each selected paragraph intersection alive across review and apply.
      // The Word selection itself may change when the user focuses the task pane.
      const trackedSelectionScopes = new Set<WordRange>();

      updateScanProgress("كشف الآيات في فقرات التحديد", 0, segments.length);
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index]!;
        const detected = detector.detect(segment.text);
        const grouped = groupBracketedAyahMatches(segment.text, detected);
        const scoped = createScopedReviewItems(
          segment.text,
          grouped,
          `selection:p${segment.paragraphIndex}`,
          `ضمن النص المحدد · الفقرة ${segment.paragraphIndex + 1}`
        ).map(item => ({
          ...item,
          // All selected-text results use the same canonical outer brackets.
          replacementText: `﴿${item.replacementText}﴾`
        }));

        for (const item of scoped) {
          if (item.status === "ambiguous" || !item.replacementText.trim()) continue;

          let start = item.sourceStart;
          let end = item.sourceEnd;
          // Match the whole-document path: replace existing supported outer
          // delimiters as part of the same range, never duplicate them.
          if (bracketPairs.some(([left, right]) =>
            segment.text[start - 1] === left && segment.text[end] === right
          )) {
            start -= 1;
            end += 1;
          }

          if (!trackedSelectionScopes.has(segment.range)) {
            context.trackedObjects.add(segment.range);
            trackedSelectionScopes.add(segment.range);
          }
          const expectedCitation = formatQuranCitation(item.references, loaded.index);
          const citationReview = inspectAdjacentQuranCitation(
            segment.text,
            end,
            expectedCitation,
            item.references,
            loaded.index,
            { start: 0, end: segment.text.length }
          );
          item.citationReview = citationReview;
          if (citationReview.status === "incorrect" && citationReview.end !== undefined) {
            end = citationReview.end;
          }
          const stored: StoredReviewedRange = {
            scope: "selection",
            scopeSnapshot: segment.text,
            scopeRange: segment.range,
            paragraphIndex: segment.paragraphIndex,
            start,
            end,
            expectedText: segment.text.slice(start, end)
          };
          itemRanges.set(item.id, stored);
          pending.push({
            item,
            stored,
            searchScope: segment.range,
            snapshot: segment.text
          });
        }

        reviewItems.push(...scoped);
        updateScanProgress("كشف الآيات في فقرات التحديد", index + 1, segments.length);
        // Let the task pane render progress between CPU-bound detector passes.
        await yieldToUi();
      }
      if (trackedSelectionScopes.size) await context.sync();
      metrics.detectionMs = performance.now() - detectionStartedAt;
      metrics.detector = detector.getDiagnostics();
      metrics.detectedCount = reviewItems.length;

      const rangeStartedAt = performance.now();
      metrics.rangeRequestCount = pending.length;
      updateScanProgress(
        "تثبيت مواضع الآيات داخل فقرات التحديد",
        0,
        pending.length,
        pending.length ? undefined : "لا توجد نتائج تحتاج إلى تثبيت مواضع"
      );
      // Resolve in the same bounded batches as the full-document scanner.
      // Each query is restricted to its paragraph/selection intersection.
      const scanBatchSize = 60;
      for (let offset = 0; offset < pending.length; offset += scanBatchSize) {
        const batch = pending.slice(offset, offset + scanBatchSize);
        const resolved = await resolveReviewedRangesBatch(context, batch.map(entry => ({
          searchScope: entry.searchScope,
          snapshot: entry.snapshot,
          start: entry.stored.start,
          end: entry.stored.end
        })));
        resolved.forEach((result, index) => {
          const entry = batch[index]!;
          if (result.range) {
            entry.stored.range = result.range;
          } else {
            entry.item.evidence.push({
              type: "context",
              detail: `تعذر تثبيت موضع النص المحدد: ${result.error ?? "تعذر التحقق من النطاق"}`
            });
          }
        });
        updateScanProgress(
          "تثبيت مواضع الآيات داخل فقرات التحديد",
          Math.min(offset + batch.length, pending.length),
          pending.length
        );
        // Also yield between Office batches, not only between paragraphs.
        await yieldToUi();
      }
      metrics.rangeMs = performance.now() - rangeStartedAt;
      metrics.resolvedRangeCount = pending.filter(entry => Boolean(entry.stored.range)).length;

      const renderStartedAt = performance.now();
      renderResults();
      metrics.renderMs = performance.now() - renderStartedAt;
      updateScanProgress("اكتمل فحص النص المحدد", 1, 1);
      setStatus(
        "اكتمل فحص النص المحدد",
        `${metrics.paragraphCount.toLocaleString("ar")} فقرة · ${metrics.characterCount.toLocaleString("ar")} محرف · ${reviewItems.length.toLocaleString("ar")} وحدة مراجعة`,
        "اكتمل"
      );
      if (!reviewItems.length) {
        byId("emptyState").querySelector("strong")!.textContent = "لم نعثر على اقتباسات";
        byId("emptyState").querySelector("p")!.textContent = "لم تظهر مطابقات قرآنية في النص المحدد وفق قواعد الفحص الحالية.";
      }
      toast(`اكتمل فحص النص المحدد: ${reviewItems.length} نتيجة في ${metrics.paragraphCount} فقرة. لم يتغير المستند.`);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateScanProgress("توقف فحص النص المحدد", 0, 0, message);
    setStatus("تعذر فحص النص المحدد", message, "توقف");
    toast(message);
  } finally {
    metrics.totalMs = performance.now() - scanStartedAt;
    renderScanDiagnostics(metrics);
    button.disabled = false;
    button.textContent = "فحص النص المحدد";
  }
}


/**
 * Build the exact reviewed range from Word's absolute character positions.
 * No Search API, anchors, or paragraph reconstruction are used.
 */
/** Normalize Arabic search text while preserving Word's existing comparison policy. */
function normalizeForWordRange(text: string): string {
  return normalizeArabic(text).replace(/\\s+/gu, " ").trim();
}

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

interface RangeRequest {
  searchScope: WordRange;
  snapshot: string;
  start: number;
  end: number;
}
interface BatchRangeResult {
  range?: WordRange;
  error?: string;
}

/**
 * Queues all searches in a batch before syncing. Each result is validated
 * independently so one ambiguous Word search does not discard other matches.
 */
async function resolveReviewedRangesBatch(
  context: WordContext,
  requests: readonly RangeRequest[]
): Promise<BatchRangeResult[]> {
  type Pending = {
    request: RangeRequest;
    expected: string;
    shortMatches?: WordCollection<WordRange>;
    prefixMatches?: WordCollection<WordRange>;
    suffixMatches?: WordCollection<WordRange>;
    prefix?: string;
    suffix?: string;
    prefixOccurrence?: number;
    suffixOccurrence?: number;
    error?: string;
  };

  const pending: Pending[] = requests.map(request => {
    const expected = request.snapshot.slice(request.start, request.end);
    if (!expected) return { request, expected, error: "نطاق الآية فارغ." };
    if (expected.length <= 240) {
      return {
        request, expected,
        shortMatches: request.searchScope
          .search(expected, { matchCase: true, matchWholeWord: false }).load("items")
      };
    }
    const chunkLength = Math.min(200, Math.floor(expected.length / 2));
    const prefix = expected.slice(0, chunkLength);
    const suffix = expected.slice(expected.length - chunkLength);
    return {
      request, expected, prefix, suffix,
      prefixOccurrence: countAnchorOccurrencesBefore(request.snapshot, prefix, request.start),
      suffixOccurrence: countAnchorOccurrencesBefore(request.snapshot, suffix, request.end - chunkLength),
      prefixMatches: request.searchScope
        .search(prefix, { matchCase: true, matchWholeWord: false }).load("items"),
      suffixMatches: request.searchScope
        .search(suffix, { matchCase: true, matchWholeWord: false }).load("items")
    };
  });

  const result: BatchRangeResult[] = pending.map(() => ({}));
  if (pending.some(item => item.shortMatches || item.prefixMatches || item.suffixMatches)) {
    await context.sync();
  }

  const candidates: WordRange[] = [];
  for (const item of pending) {
    if (item.shortMatches) candidates.push(...item.shortMatches.items);
    if (item.prefixMatches) candidates.push(...item.prefixMatches.items);
    if (item.suffixMatches) candidates.push(...item.suffixMatches.items);
  }
  for (const candidate of candidates) candidate.load("text");
  if (candidates.length) await context.sync();

  const longToVerify: Array<{ index: number; range: WordRange; expected: string }> = [];
  const tracked: WordRange[] = [];
  pending.forEach((item, index) => {
    if (item.error) {
      result[index] = { error: item.error };
      return;
    }
    try {
      if (item.shortMatches) {
        const exact = item.shortMatches.items.filter(candidate =>
          normalizeForWordRange(candidate.text) === normalizeForWordRange(item.expected)
        );
        const occurrence = countAnchorOccurrencesBefore(
          item.request.snapshot, item.expected, item.request.start
        );
        const match = exact[occurrence];
        if (!match) throw new Error(
          `لم يُعثر على تطابق حرفي في Word (الموضع ${occurrence + 1} من ${exact.length}).`
        );
        result[index] = { range: match };
        tracked.push(match);
        return;
      }

      const exactPrefixes = item.prefixMatches!.items.filter(candidate =>
        normalizeForWordRange(candidate.text) === normalizeForWordRange(item.prefix!)
      );
      const exactSuffixes = item.suffixMatches!.items.filter(candidate =>
        normalizeForWordRange(candidate.text) === normalizeForWordRange(item.suffix!)
      );
      const prefixRange = exactPrefixes[item.prefixOccurrence!];
      const suffixRange = exactSuffixes[item.suffixOccurrence!];
      if (!prefixRange || !suffixRange) {
        throw new Error("تعذر تثبيت بداية الآية ونهايتها بتطابق حرفي في Word.");
      }
      const expanded = prefixRange.expandTo(suffixRange).load("text");
      longToVerify.push({ index, range: expanded, expected: item.expected });
    } catch (error) {
      result[index] = { error: error instanceof Error ? error.message : String(error) };
    }
  });

  if (longToVerify.length) {
    await context.sync();
    for (const item of longToVerify) {
      if (normalizeForWordRange(item.range.text) !== normalizeForWordRange(item.expected)) {
        result[item.index] = { error: "موضع Word لا يطابق نص الآية الذي تمت مراجعته." };
      } else {
        result[item.index] = { range: item.range };
        tracked.push(item.range);
      }
    }
  }

  for (const range of tracked) context.trackedObjects.add(range);
  if (tracked.length) await context.sync();
  return result;
}




async function inspectQuranCitations(): Promise<void> {
  const button = byId<HTMLButtonElement>("validateCitationsButton");
  button.disabled = true;
  button.textContent = "جارٍ التحقق…";
  try {
    datasetPromise ??= loadDataset();
    const loaded = await datasetPromise;
    await Word.run(async context => {
      const paragraphs = context.document.body.paragraphs.load("items");
      await context.sync();
      const ranges = paragraphs.items.map(p => p.getRange("Content").load("text"));
      await context.sync();
      const issues: Array<QuranCitationIssue & { paragraph: number }> = [];
      for (let i = 0; i < ranges.length; i++) {
        for (const issue of validateQuranCitations(ranges[i]!.text, loaded.index)) {
          issues.push({ ...issue, paragraph: i + 1 });
        }
      }
      const root = byId<HTMLElement>("citationValidationResults");
      root.replaceChildren();
      byId("citationValidationCount").textContent = String(issues.length);
      if (!issues.length) {
        const empty = document.createElement("p");
        empty.textContent = "لم يُعثر على تخريجات بالصيغة المعروفة للتحقق.";
        root.append(empty);
      }
      for (const issue of issues) {
        const card = document.createElement("article");
        card.className = "result-card";
        const heading = document.createElement("strong");
        heading.textContent = issue.original + " · الفقرة " + issue.paragraph;
        const detail = document.createElement("p");
        detail.className = "result-meta";
        detail.textContent = issue.message;
        const status = document.createElement("span");
        status.className = "confidence";
        status.textContent = issue.status === "valid" ? "صحيح" : issue.status === "invalid" ? "غير صحيح" : "يحتاج إلى مراجعة";
        card.append(heading, status, detail);
        if (issue.suggestedCitation) {
          const suggestion = document.createElement("p");
          suggestion.className = "verse-text";
          suggestion.textContent = "التخريج: " + issue.suggestedCitation;
          card.append(suggestion);
        }
        root.append(card);
      }
      byId<HTMLElement>("citationValidationPanel").hidden = false;
      setStatus("اكتمل التحقق", "عدد الإحالات التي جرى فحصها: " + issues.length + ". لم يتغير المستند.", "اكتمل");
      toast("اكتمل التحقق من التخريجات: " + issues.length + " نتيجة. لم يتغير المستند.");
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("تعذر التحقق", message, "توقف");
    toast(message);
  } finally {
    button.disabled = false;
    button.textContent = "التحقق من التخريجات";
  }
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
    if (!stored) throw new Error("بيانات موضع الآية غير موجودة؛ أعد فحص النص.");
    return { item, ...stored };
  });
  type ApplyEntry = typeof entries[number];
  type ResolvedApplyEntry = ApplyEntry & { range: WordRange; paragraphText: string };

  const button = byId<HTMLButtonElement>("applyButton");
  button.disabled = true;
  setStatus("جارٍ إعادة تحديد المواضع", "التحقق من النص قبل أي تعديل", "يتحقق");

  const applyResolvedEntries = async (
    context: WordContext,
    resolvedEntries: ResolvedApplyEntry[]
  ): Promise<void> => {
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
      const citationReview = entry.item.citationReview;
      let replacement = finalVerseText;
      if (citation && addCitations) {
        if (citationReview?.status === "missing") {
          replacement = `${finalVerseText}${citationReview.separator ?? " "}${citation}`;
        } else if (citationReview?.status === "incorrect") {
          replacement = `${finalVerseText} ${citation}`;
        } else if (citationReview?.status === "correct") {
          replacement = finalVerseText;
        } else if (citationReview?.status === "unavailable") {
          replacement = finalVerseText;
        }
      } else if (citationReview?.status === "incorrect" && citationReview.existingCitation) {
        // Preserve an unapproved citation exactly as it appeared in the source.
        replacement = `${finalVerseText} ${citationReview.existingCitation}`;
      }
      const inserted = entry.range.insertText(replacement, "Replace");
      inserted.font.name = "KFGQPC HAFS Uthmanic Script";
    }
    await context.sync();
    for (const entry of resolvedEntries) context.trackedObjects.remove(entry.range);
    await context.sync();
  };

  try {
    const selectedScope = entries.some(entry => entry.scope === "selection");
    if (selectedScope) {
      if (entries.some(entry =>
        entry.scope !== "selection" || !entry.scopeRange || !entry.scopeSnapshot
      )) {
        throw new Error("تعذر تثبيت نطاق إحدى فقرات النص المحدد. أعد فحص النص قبل الاستبدال.");
      }

      // Resolve again at apply time inside the precise paragraph intersections
      // captured during scanning. This follows the same guarded strategy as
      // the whole-document apply path and avoids relying on stale hit objects.
      const selectedScopes = [...new Set(entries.map(entry => entry.scopeRange!))];
      await Word.run(selectedScopes, async context => {
        for (const scope of selectedScopes) scope.load("text");
        await context.sync();

        for (const entry of entries) {
          if (entry.scopeRange!.text !== entry.scopeSnapshot) {
            throw new Error("تغير النص المحدد بعد الفحص؛ أُلغي الاستبدال حمايةً للمستند. أعد الفحص ثم اعتمد النتائج.");
          }
        }

        const requests = entries.map(entry => ({
          searchScope: entry.scopeRange!,
          snapshot: entry.scopeSnapshot!,
          start: entry.start,
          end: entry.end
        }));
        const resolvedRanges: WordRange[] = [];
        let replacementsApplied = false;
        try {
          const applyBatchSize = 60;
          for (let offset = 0; offset < requests.length; offset += applyBatchSize) {
            const batch = requests.slice(offset, offset + applyBatchSize);
            const results = await resolveReviewedRangesBatch(context, batch);
            const failedIndex = results.findIndex(result => !result.range);
            resolvedRanges.push(...results.flatMap(result => result.range ? [result.range] : []));
            if (failedIndex >= 0) {
              throw new Error(
                results[failedIndex]!.error ??
                "تعذر إعادة تحديد أحد مواضع النص المحدد؛ لم يُعدّل المستند."
              );
            }
          }

          const resolvedEntries: ResolvedApplyEntry[] = entries.map((entry, index) => ({
            ...entry,
            range: resolvedRanges[index]!,
            paragraphText: entry.scopeSnapshot!
          }));
          await applyResolvedEntries(context, resolvedEntries);
          replacementsApplied = true;

          // Release scan-time hit objects and the paragraph-intersection
          // anchors after the newly resolved ranges have been applied.
          for (const entry of entries) {
            if (entry.range) context.trackedObjects.remove(entry.range);
          }
          for (const scope of selectedScopes) context.trackedObjects.remove(scope);
          await context.sync();
        } catch (error) {
          if (!replacementsApplied && resolvedRanges.length) {
            for (const range of resolvedRanges) {
              try { context.trackedObjects.remove(range); } catch { /* already released */ }
            }
            await context.sync();
          }
          throw error;
        }
      });
    } else {
      await Word.run(async context => {
        const paragraphs = context.document.body.paragraphs.load("items");
        await context.sync();

        const currentRanges = entries.map(entry => {
          const paragraph = paragraphs.items[entry.paragraphIndex];
          if (!paragraph) throw new Error("لم تعد الفقرة الأصلية موجودة؛ أُلغي الاستبدال.");
          return paragraph.getRange("Content").load("text");
        });
        await context.sync();

        const rangeRequests = entries.map((entry, index) => {
          const paragraph = paragraphs.items[entry.paragraphIndex]!;
          const currentText = currentRanges[index]!.text;
          if (currentText.slice(entry.start, entry.end) !== entry.expectedText) {
            throw new Error("تغير النص أو موضع إحدى الآيات بعد الفحص؛ أُلغي الاستبدال حمايةً للمستند.");
          }
          return {
            searchScope: paragraph.getRange("Content"),
            snapshot: currentText,
            start: entry.start,
            end: entry.end
          };
        });

        const resolvedRanges: WordRange[] = [];
        const applyBatchSize = 60;
        try {
          for (let offset = 0; offset < rangeRequests.length; offset += applyBatchSize) {
            const batch = rangeRequests.slice(offset, offset + applyBatchSize);
            const results = await resolveReviewedRangesBatch(context, batch);
            const failed = results.find(result => !result.range);
            if (failed) {
              throw new Error(failed.error ?? "تعذر التحقق من أحد مواضع الآيات؛ لم يُعدّل المستند.");
            }
            resolvedRanges.push(...results.map(result => result.range!));
          }
        } catch (error) {
          for (const range of resolvedRanges) context.trackedObjects.remove(range);
          if (resolvedRanges.length) await context.sync();
          throw error;
        }

        const resolvedEntries: ResolvedApplyEntry[] = entries.map((entry, index) => ({
          ...entry,
          range: resolvedRanges[index]!,
          paragraphText: currentRanges[index]!.text
        }));
        await applyResolvedEntries(context, resolvedEntries);
      });
    }

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
  byId<HTMLButtonElement>("validateCitationsButton").addEventListener("click", () => void inspectQuranCitations());
  byId<HTMLButtonElement>("scanButton").addEventListener("click", () => void inspectDocument());
  byId<HTMLButtonElement>("scanSelectionButton").addEventListener("click", () => void inspectSelectedText());
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