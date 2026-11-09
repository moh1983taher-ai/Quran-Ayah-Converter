/** Stable identity of one Qur'anic ayah. */
export interface AyahReference {
  surah: number;
  ayah: number;
}

/** One imported ayah, retaining both search and display forms. */
export interface QuranAyahRecord extends AyahReference {
  id: string;
  surahNameArabic: string;
  uthmani: string;
  imlaei: string;
  juz?: number;
  page?: number;
  lineStart?: number;
  lineEnd?: number;
}

/** A normalized string plus a map back to UTF-16 offsets in the source. */
export interface NormalizedText {
  value: string;
  sourceStart: number[];
  sourceEnd: number[];
  /** Original string used to build the UTF-16 offset map. */
  sourceText: string;
}

/** A verified or proposed match in the original document text. */
export interface AyahMatch {
  sourceStart: number;
  sourceEnd: number;
  references: AyahReference[];
  matchedText: string;
  /** Full canonical ayah text used to establish Qur'anic identity. */
  canonicalText: string;
  /** Exact canonical text to insert; set for partial-ayah excerpts only. */
  replacementText?: string;
  confidence: number;
  evidence: MatchEvidence[];
  status: "high-confidence" | "needs-review" | "ambiguous";
}

export type MatchEvidence =
  | { type: "verse-brackets"; detail: string }
  | { type: "explicit-reference"; detail: string }
  | { type: "exact-text"; detail: string }
  | { type: "normalized-text"; detail: string }
  | { type: "fuzzy-alignment"; detail: string }
  | { type: "context"; detail: string };

export interface QuranIndex {
  get(reference: AyahReference): QuranAyahRecord | undefined;
  search(normalizedQuery: string): QuranAyahRecord[];
  all(): readonly QuranAyahRecord[];
  readonly size: number;
}
