import { QuranAyahDetector } from "../core/detector.js";
import { loadQuranDatasetJson } from "../core/dataset-loader.js";
import { createReviewItems, setReviewDecision, type ReviewItem } from "./review-workflow.js";

declare const Office: { onReady(callback: () => void): void };
declare const Word: { run<T>(callback: (context: WordContext) => Promise<T>): Promise<T> };
interface WordCollection<T> { items: T[]; load(property: string): WordCollection<T>; }
interface WordParagraph { text: string; }
interface WordContext { document: { body: { paragraphs: WordCollection<WordParagraph>; tables: WordCollection<unknown>; } }; sync(): Promise<void>; }

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element: ${id}`);
  return element as T;
};
let reviewItems: ReviewItem[] = [];
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
      const paragraphs = context.document.body.paragraphs.load("items");
      const tables = context.document.body.tables.load("items");
      await context.sync();
      const detector = new QuranAyahDetector(loaded.index);
      reviewItems = [];
      paragraphs.items.forEach((paragraph, index) => {
        const local = createReviewItems(paragraph.text, detector.detect(paragraph.text));
        reviewItems.push(...local.map(item => ({
          ...item,
          id: `p${index}:${item.id}`,
          evidence: [...item.evidence, { type: "context" as const, detail: `الفقرة ${index + 1}` }]
        })));
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
Office.onReady(() => {
  byId<HTMLButtonElement>("scanButton").addEventListener("click", () => void inspectDocument());
  byId<HTMLButtonElement>("selectNone").addEventListener("click", () => {
    reviewItems = reviewItems.map(item => ({ ...item, decision: "pending" }));
    renderResults();
    toast("أُلغي تحديد جميع النتائج.");
  });
  byId<HTMLButtonElement>("applyButton").addEventListener("click", () => {
    const count = reviewItems.filter(item => item.decision === "approved").length;
    toast(`تمت الموافقة على ${count} مواضع للمراجعة؛ لم يُعدّل المستند بعد.`);
  });
});