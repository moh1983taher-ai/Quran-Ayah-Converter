import { QuranAyahDetector } from "../core/detector.js";
import { loadQuranDatasetJson } from "../core/dataset-loader.js";
import { createReviewItems, setReviewDecision, type ReviewItem } from "./review-workflow.js";
import { assertParagraphSnapshot } from "./word-adapter.js";

declare const Office: { onReady(callback: () => void): void };
declare const Word: { run<T>(callback: (context: WordContext) => Promise<T>): Promise<T> };
interface WordCollection<T> { items: T[]; load(property: string): WordCollection<T>; }
interface WordRange { text: string; font: { name: string }; load(property: string): WordRange; expandTo(range: WordRange): WordRange; insertText(text: string, location: "Replace"): WordRange; search(query: string, options: { matchCase: boolean; matchWholeWord: boolean }): WordCollection<WordRange>; }
interface WordParagraph { text: string; getRange(location?: "Content" | "Whole"): WordRange; }
interface WordContext { document: { body: { paragraphs: WordCollection<WordParagraph>; tables: WordCollection<unknown>; } }; sync(): Promise<void>; }

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element: ${id}`);
  return element as T;
};
let reviewItems: ReviewItem[] = [];
const paragraphSnapshots = new Map<number, string>();
const itemParagraphs = new Map<string, number>();
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
    checkbox.disabled = item.status === "ambiguous" || !item.replacementText || item.decision === "applied";
    checkbox.addEventListener("change", () => {
      reviewItems = setReviewDecision(reviewItems, [item.id], checkbox.checked ? "approved" : "rejected");
      updateApplyButton();
    });
    label.append(checkbox, document.createTextNode(item.decision === "applied" ? "تم تحويل هذا الموضع" : item.status === "ambiguous" ? "ملتبسة — غير قابلة للاعتماد" : "أوافق على تحويل هذا الموضع"));
    card.append(top, original, canonical, evidence, label);
    root.append(card);
  }
  updateApplyButton();
}
async function inspectDocument(): Promise<void> {
  const button = byId<HTMLButtonElement>("scanButton");
  button.disabled = true;
  button.textContent = "جارٍ فحص المستند…";
  setStatus("جارٍ تحميل قاعدة المصحف", "التحقق من بيانات حفص قبل البحث", "يفحص");
  try {
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
      paragraphSnapshots.clear();
      itemParagraphs.clear();
      paragraphs.items.forEach((_paragraph, index) => {
        const paragraphText = contentRanges[index]!.text;
        paragraphSnapshots.set(index, paragraphText);
        const local = createReviewItems(paragraphText, detector.detect(paragraphText));
        const scoped = local.map(item => ({
          ...item,
          id: `p${index}:${item.id}`,
          evidence: [...item.evidence, { type: "context" as const, detail: `الفقرة ${index + 1}` }]
        }));
        for (const item of scoped) itemParagraphs.set(item.id, index);
        reviewItems.push(...scoped);
      });
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
 * Replace only the reviewed verse range. The paragraph is read solely for
 * validation and occurrence disambiguation; it is never rewritten.
 */
async function applyApprovedReplacements(): Promise<void> {
  const approved = reviewItems.filter(item => item.decision === "approved");
  if (!approved.length) return;
  const button = byId<HTMLButtonElement>("applyButton");
  button.disabled = true;
  setStatus("جارٍ التحقق من مواضع الاستبدال", "مطابقة نطاق كل آية وأقواسها قبل أي تعديل", "يتحقق");
  try {
    await Word.run(async context => {
      const paragraphs = context.document.body.paragraphs.load("items");
      await context.sync();

      const pending: Array<{
        paragraphIndex: number;
        start: number;
        range: WordRange;
        replacementText: string;
      }> = [];

      // Preflight every approved range before changing any text.
      for (const item of approved) {
        const paragraphIndex = itemParagraphs.get(item.id);
        const paragraph = paragraphIndex === undefined ? undefined : paragraphs.items[paragraphIndex];
        const snapshot = paragraphIndex === undefined ? undefined : paragraphSnapshots.get(paragraphIndex);
        if (paragraphIndex === undefined || !paragraph || snapshot === undefined) {
          throw new Error("تعذر تحديد الفقرة الأصلية؛ أُلغي الاستبدال.");
        }

        const liveRange = paragraph.getRange("Content").load("text");
        await context.sync();
        assertParagraphSnapshot(liveRange.text, snapshot);

        let start = item.sourceStart;
        let end = item.sourceEnd;
        // Include ornamental Qur'anic brackets in the replacement range.
        if (snapshot[start - 1] === "﴿" && snapshot[end] === "﴾") {
          start -= 1;
          end += 1;
        }
        const expected = snapshot.slice(start, end);
        if (!expected || snapshot.slice(item.sourceStart, item.sourceEnd) !== item.originalText) {
          throw new Error("لم يعد النص المحدد مطابقًا لما تمت مراجعته؛ أُلغي الاستبدال.");
        }

        // Resolve repeated identical text by its occurrence ordinal in the
        // immutable paragraph snapshot, then retain the exact Word range.
        const occurrence = snapshot.slice(0, start).split(expected).length - 1;
        const matches = paragraph.getRange("Content").search(expected, {
          matchCase: true,
          matchWholeWord: false
        }).load("items");
        await context.sync();
        if (matches.items.length <= occurrence) {
          throw new Error("تعذر العثور على نطاق الآية المطابق؛ أُلغي الاستبدال.");
        }
        pending.push({
          paragraphIndex,
          start,
          range: matches.items[occurrence]!,
          replacementText: item.replacementText
        });
      }

      // Refuse duplicate targets before making any change.
      const ordered = [...pending].sort((a, b) =>
        a.paragraphIndex - b.paragraphIndex || b.start - a.start
      );
      for (let i = 1; i < ordered.length; i += 1) {
        const previous = ordered[i - 1]!;
        const current = ordered[i]!;
        if (previous.paragraphIndex === current.paragraphIndex &&
            previous.start === current.start) {
          throw new Error("تكرر نطاق الاستبدال نفسه؛ أُلغي التنفيذ حمايةً للمستند.");
        }
      }

      // Replace only each exact verse range, never the paragraph.
      for (const entry of ordered) {
        const inserted = entry.range.insertText(entry.replacementText, "Replace");
        inserted.font.name = "KFGQPC Uthmanic Script HAFS";
      }
      await context.sync();
    });

    reviewItems = reviewItems.map(item =>
      item.decision === "approved" ? { ...item, decision: "applied" } : item
    );
    renderResults();
    setStatus("اكتمل الاستبدال", `تم تحويل ${approved.length} موضعًا دون إعادة كتابة الفقرات.`, "اكتمل");
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