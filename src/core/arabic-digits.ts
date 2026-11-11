/**
 * Converts Arabic-Indic and Eastern Arabic-Indic digits to ASCII digits.
 * Mixed digit scripts are intentionally supported within the same number.
 */
const ARABIC_INDIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const EASTERN_ARABIC_INDIC_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeArabicDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/gu, digit => {
    const arabicIndex = ARABIC_INDIC_DIGITS.indexOf(digit);
    return String(arabicIndex >= 0
      ? arabicIndex
      : EASTERN_ARABIC_INDIC_DIGITS.indexOf(digit));
  });
}
