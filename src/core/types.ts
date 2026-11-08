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
}

/** A normalized string plus a map back to UTF-16 offsets in the source. */
export interface NormalizedText {
  value: string;
  sourceStart: number[];
  sourceEnd: number[];
}

/** A verified or proposed match in the original document text. */
export interface AyahMatch {
  sourceStart: number;
  sourceEnd: number;
  references: AyahReference[];
  matchedText: string;
  canonicalText: string;
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
