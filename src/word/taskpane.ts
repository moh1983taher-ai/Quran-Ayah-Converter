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
async function inspectDocument(): Promise<void> {
  const button = byId<HTMLButtonElement>("scanButton");
  button.disabled = true;
  button.textContent = "جارٍ قراءة المستند…";
  setStatus("جارٍ الاتصال بـ Word", "نقرأ بنية المستند دون إجراء أي تعديل", "يفحص");
  try {
    await Word.run(async context => {
      const paragraphs = context.document.body.paragraphs.load("items");
      const tables = context.document.body.tables.load("items");
      await context.sync();
      const paragraphCount = paragraphs.items.length;
      const tableCount = tables.items.length;
      const textLength = paragraphs.items.reduce((sum, paragraph) => sum + paragraph.text.length, 0);
      setStatus("اكتملت قراءة المستند", `${paragraphCount} فقرة · ${tableCount} جدول · ${textLength} حرفًا مقروءًا`, "تمت القراءة");
      byId("emptyState").querySelector("strong")!.textContent = "اكتملت قراءة المستند";
      byId("emptyState").querySelector("p")!.textContent =
        "تم الاتصال بـ Word وقراءة الفقرات والجداول. سيظهر كشف الآيات هنا بعد ربط محرك الاكتشاف بقاعدة البيانات داخل الإضافة.";
      toast("نجحت قراءة المستند. لم يُجرَ أي تعديل على النص.");
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("تعذر الاتصال بـ Word", message, "تعذر");
    toast("تعذر قراءة المستند: " + message);
  } finally {
    button.disabled = false;
    button.innerHTML = "<span>⌕</span> فحص المستند";
  }
}
Office.onReady(() => {
  byId<HTMLButtonElement>("scanButton").addEventListener("click", () => void inspectDocument());
  byId<HTMLButtonElement>("selectNone").addEventListener("click", () => {
    document.querySelectorAll<HTMLInputElement>(".result-card input[type=checkbox]").forEach(input => { input.checked = false; });
    byId<HTMLButtonElement>("applyButton").disabled = true;
    toast("أُلغي تحديد النتائج.");
  });
  byId<HTMLButtonElement>("applyButton").addEventListener("click", () => {
    toast("لم يُفعّل الاستبدال بعد؛ ستُتاح هذه الخطوة بعد ربط المراجعة بالمحرك.");
  });
});