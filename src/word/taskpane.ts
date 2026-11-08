import { QuranAyahDetector } from "../core/detector.js";
import { loadQuranDatasetJson } from "../core/dataset-loader.js";
import { createReviewItems, setReviewDecision, type ReviewItem } from "./review-workflow.js";
import { assertParagraphSnapshot, createParagraphReplacementPlan, type ParagraphReplacementStep } from "./word-adapter.js";

declare const Office: { onReady(callback: () => void): void };
declare const Word: { run<T>(callback: (context: WordContext) => Promise<T>): Promise<T> };
interface WordCollection<T> { items: T[]; load(property: string): WordCollection<T>; }
interface WordRange { text: string; load(property: string): WordRange; search(query: string, options: { matchCase: boolean; matchWholeWord: boolean }): WordSearchCollection; insertText(text: string, location: "Replace"): WordRange; }
interface WordSearchCollection { items: WordRange[]; load(property: string): WordSearchCollection; }
interface WordParagraph { text: string; getRange(): WordRange; }
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
    checkbox.disabled = item.status === "ambiguous" || !item.replacementText;
    checkbox.addEventListener("change", () => {
      reviewItems = setReviewDecision(reviewItems, [item.id], checkbox.checked ? "approved" : "rejected");
      updateApplyButton();
    });
    label.append(checkbox, document.createTextNode(item.status === "ambiguous" ? "ملتبسة — غير قابلة للاعتماد" : "أوافق على تحويل هذا الموضع"));
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
      const paragraphs = context.document.body.paragraphs.load("items/text");
      const tables = context.document.body.tables.load("items");
      await context.sync();
      const detector = new QuranAyahDetector(loaded.index);
      reviewItems = [];
      paragraphSnapshots.clear();
      itemParagraphs.clear();
      paragraphs.items.forEach((paragraph, index) => {
        paragraphSnapshots.set(index, paragraph.text);
        const local = createReviewItems(paragraph.text, detector.detect(paragraph.text));
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
 * Two-phase Word operation:
 * 1) Re-read paragraph snapshots and resolve every approved quotation to one
 *    exact Word range. No document edits occur during this preflight.
 * 2) Only after all ranges pass, replace them from right to left.
 *
 * Repeated identical quotations in one paragraph are rejected because
 * Office.js search alone cannot safely disambiguate their original offsets.
 */
async function applyApprovedReplacements(): Promise<void> {
  const approved = reviewItems.filter(item => item.decision === "approved");
  if (!approved.length) return;
  const button = byId<HTMLButtonElement>("applyButton");
  button.disabled = true;
  setStatus("جارٍ التحقق من مواضع الاستبدال", "إعادة مطابقة النصوص داخل مستند Word قبل أي تعديل", "يتحقق");
  try {
    await Word.run(async context => {
      const paragraphs = context.document.body.paragraphs.load("items");
      await context.sync();

      const grouped = new Map<number, ReviewItem[]>();
      for (const item of approved) {
        const paragraphIndex = itemParagraphs.get(item.id);
        if (paragraphIndex === undefined || !paragraphSnapshots.has(paragraphIndex)) {
          throw new Error("تعذر تحديد الفقرة الأصلية لإحدى النتائج؛ أُلغي الاستبدال.");
        }
        const group = grouped.get(paragraphIndex) ?? [];
        group.push(item);
        grouped.set(paragraphIndex, group);
      }

      const pending: Array<{ step: ParagraphReplacementStep; range: WordRange }> = [];
      for (const [paragraphIndex, items] of grouped) {
        const paragraph = paragraphs.items[paragraphIndex];
        const snapshot = paragraphSnapshots.get(paragraphIndex);
        if (!paragraph || snapshot === undefined) {
          throw new Error("تغيرت بنية المستند منذ الفحص؛ أُلغي الاستبدال.");
        }
        assertParagraphSnapshot(paragraph.text, snapshot);

        const plan = createParagraphReplacementPlan(
          paragraphIndex,
          snapshot,
          items.map(item => ({
            start: item.sourceStart,
            end: item.sourceEnd,
            expectedOriginalText: item.originalText,
            replacementText: item.replacementText
          }))
        );

        for (const step of plan.steps) {
          const matches = paragraph.getRange().search(step.expectedOriginalText, {
            matchCase: true,
            matchWholeWord: false
          }).load("items");
          await context.sync();
          if (matches.items.length !== 1) {
            throw new Error(
              `تعذر تحديد موضع فريد للنص في الفقرة ${paragraphIndex + 1}. لم يُنفذ الاستبدال.`
            );
          }
          const range = matches.items[0]!;
          range.load("text");
          await context.sync();
          if (range.text !== step.expectedOriginalText) {
            throw new Error("لم يعد النص المطابق كما تمت مراجعته؛ أُلغي الاستبدال.");
          }
          pending.push({ step, range });
        }
      }

      // All approved locations have passed preflight. Execute right-to-left
      // within each paragraph so earlier offsets are not shifted.
      for (const entry of pending) {
        entry.range.insertText(entry.step.replacementText, "Replace");
      }
      await context.sync();

      for (const [paragraphIndex, items] of grouped) {
        const original = paragraphSnapshots.get(paragraphIndex)!;
        const plan = createParagraphReplacementPlan(
          paragraphIndex,
          original,
          items.map(item => ({
            start: item.sourceStart,
            end: item.sourceEnd,
            expectedOriginalText: item.originalText,
            replacementText: item.replacementText
          }))
        );
        const finalText = plan.steps.length
          ? plan.steps[plan.steps.length - 1]!.resultingParagraphText
          : original;
        paragraphSnapshots.set(paragraphIndex, finalText);
      }
    });

    reviewItems = reviewItems.map(item =>
      item.decision === "approved" ? { ...item, decision: "rejected" } : item
    );
    renderResults();
    setStatus("اكتمل الاستبدال", `تم تحويل ${approved.length} موضعًا مع إعادة التحقق من النص الأصلي.`, "اكتمل");
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
    reviewItems = reviewItems.map(item => ({ ...item, decision: "pending" }));
    renderResults();
    toast("أُلغي تحديد جميع النتائج.");
  });
  byId<HTMLButtonElement>("applyButton").addEventListener("click", () => void applyApprovedReplacements());
});