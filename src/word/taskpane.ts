import { QuranAyahDetector } from "../core/detector.js";
import { loadQuranDatasetJson } from "../core/dataset-loader.js";
import { createReviewItems, setReviewDecision, type ReviewItem } from "./review-workflow.js";


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
  const button = byId<HTMLButtonElement>("applyButton");
  button.disabled = count === 0;
  button.textContent = count ? `اعتماد ${count} موضع للمراجعة النهائية ←` : "اعتماد المحدد ←";
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
    ref.textContent = item.references.map(r => `${r.surah}:${r.ayah}`).join("، ");
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
      for (const entry of entries) context.trackedObjects.remove(entry.range);
      await context.sync();
    });
  }
  itemRanges.clear();
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
        const local = createReviewItems(paragraphText, detector.detect(paragraphText));
        const scoped = local.map(item => ({
          ...item,
          id: `p${index}:${item.id}`,
          evidence: [...item.evidence, { type: "context" as const, detail: `الفقرة ${index + 1}` }]
        }));

        for (const item of scoped) {
          if (item.status === "ambiguous" || !item.replacementText.trim()) continue;

          let start = item.sourceStart;
          let end = item.sourceEnd;
          if (paragraphText[start - 1] === "﴿" && paragraphText[end] === "﴾") {
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
      setStatus("اكتمل فحص المستند", `${paragraphs.items.length} فقرة · ${tables.items.length} جدول · ${reviewItems.length} نتيجة`, "اكتمل");
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
    const match = matches.items[occurrence];
    if (!match) throw new Error(`لم يُعثر على النص المطابق في مجموعة نتائج Word (الموضع ${occurrence + 1}).`);
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

    const prefixRange = prefixMatches.items[prefixOccurrence];
    const suffixRange = suffixMatches.items[suffixOccurrence];
    if (!prefixRange || !suffixRange) {
      throw new Error("تعذر تثبيت بداية الآية ونهايتها في Word.");
    }
    exactRange = prefixRange.expandTo(suffixRange).load("text");
    await context.sync();
  }

  exactRange.load("text");
  await context.sync();
  if (exactRange.text !== expected) {
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

      const resolvedEntries: Array<typeof entries[number] & { range: WordRange }> = [];
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
        resolvedEntries.push({ ...entry, range: resolved.range });
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
        const inserted = entry.range.insertText(entry.item.replacementText, "Replace");
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
    setStatus("اكتمل الاستبدال", `تم تحويل ${approved.length} موضعًا بعد إعادة التحقق منها.`, "اكتمل");
    toast(`اكتمل تحويل ${approved.length} موضعًا معتمدًا.`);
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
  byId<HTMLButtonElement>("selectNone").addEventListener("click", () => {
    reviewItems = reviewItems.map(item => item.decision === "applied" ? item : ({ ...item, decision: "pending" }));
    renderResults();
    toast("أُلغي تحديد جميع النتائج.");
  });
  byId<HTMLButtonElement>("applyButton").addEventListener("click", () => void applyApprovedReplacements());
});