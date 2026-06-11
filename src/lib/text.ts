// Vietnamese-friendly text matching. Vietnamese users frequently type names
// WITHOUT diacritics (e.g. "nguyen" for "Nguyễn"), so search must fold accents
// to match. We lower-case, strip combining diacritical marks via NFD
// normalization, and special-case đ/Đ (a distinct base letter, not a combining
// mark) → d.
export function foldVN(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks
    .replace(/[đĐ]/g, "d") // đ / Đ
    .toLowerCase()
    .trim();
}

// True if `haystack` contains `needle`, ignoring case AND Vietnamese diacritics.
export function matchesVN(haystack: string, needle: string): boolean {
  return foldVN(haystack).includes(foldVN(needle));
}
