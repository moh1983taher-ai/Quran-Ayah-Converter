import { describe, expect, it } from "vitest";
import { validateQuranCitations } from "../src/word/citation-validator.js";
import type { QuranAyahRecord, QuranIndex } from "../src/core/types.js";
function makeIndex(): QuranIndex {
 const records: QuranAyahRecord[] = [];
 for (let surah=1;surah<=2;surah++) for(let ayah=1;ayah<=34;ayah++) records.push({surah,ayah,id:`${surah}:${ayah}`,surahNameArabic:surah===1?"الفاتحة":"البقرة",uthmani:"نص",imlaei:"نص"});
 return {get:r=>records.find(x=>x.surah===r.surah&&x.ayah===r.ayah),search:()=>[],all:()=>records,size:records.length};
}
describe("Quran citation validation",()=>{
 it("recognizes valid citation and Arabic digits",()=>{const result=validateQuranCitations("قال [الفاتحة: ٣] ثم",makeIndex());expect(result).toHaveLength(1);expect(result[0]?.status).toBe("valid");expect(result[0]?.suggestedCitation).toBe("[الفاتحة: 3]");});
 it("parses mixed Arabic and Latin digits in one citation number",()=>{const result=validateQuranCitations("[البقرة: ٣4]",makeIndex());expect(result).toHaveLength(1);expect(result[0]?.status).toBe("valid");expect(result[0]?.references).toEqual([{surah:2,ayah:34}]);expect(result[0]?.suggestedCitation).toBe("[البقرة: 34]");});
 it("rejects out-of-range ayah",()=>{expect(validateQuranCitations("[الفاتحة: 35]",makeIndex())[0]?.status).toBe("invalid");});
 it("rejects reversed range",()=>{expect(validateQuranCitations("[البقرة: 5-2]",makeIndex())[0]?.status).toBe("invalid");});
 it("flags unknown surah as ambiguous",()=>{expect(validateQuranCitations("[سورة مجهولة: 2]",makeIndex())[0]?.status).toBe("ambiguous");});
 it("validates ranges",()=>{const x=validateQuranCitations("[البقرة: 2–4]",makeIndex())[0];expect(x?.status).toBe("valid");expect(x?.references).toHaveLength(3);});
});
