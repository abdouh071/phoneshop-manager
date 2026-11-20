/**
 * searchUtils.ts — Professional-grade ranked + fuzzy search helpers.
 *
 * All normalization is intentionally delegated to `normalizeArabic()` so the
 * Arabic / Latin / digit folding stays in one place and stays consistent with
 * the mobile app.
 *
 * Scoring (higher = better match):
 *   100  exact full match
 *    80  text starts with the query
 *    60  a word inside the text starts with the query
 *    40  text contains the query as a substring
 *    20  fuzzy: 1-char edit distance for query words ≥ 5 chars
 *     0  no match  →  item is excluded
 */
import { normalizeArabic } from './normalizeText';

// ─── Levenshtein distance (bounded at 2 for performance) ─────────────────────

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j], dp[j - 1]) + 1;
      prev = temp;
    }
  }
  return dp[n];
}

/** Returns true when `word` is within 1 edit of any word-length window inside `target`. */
export function fuzzyMatch(word: string, target: string): boolean {
  if (word.length < 5) return false; // only fuzzy for longer words
  if (target.includes(word)) return false; // exact substring already handled above
  // Check 1-char typo tolerance: allow edit distance 1
  // Also check each individual word in target
  const targetWords = target.split(' ');
  for (const tw of targetWords) {
    if (Math.abs(tw.length - word.length) <= 1 && levenshtein(word, tw) <= 1) return true;
  }
  return false;
}

// ─── Single-query scorer ──────────────────────────────────────────────────────

/**
 * Score how well `query` matches `text` (both should already be normalized).
 * Returns 0 when there is no match (item should be hidden).
 */
export function scoreMatch(normalizedQuery: string, normalizedText: string): number {
  if (!normalizedQuery || !normalizedText) return 0;

  // Exact full match
  if (normalizedText === normalizedQuery) return 100;

  // Text starts with the full query
  if (normalizedText.startsWith(normalizedQuery)) return 80;

  // Any word in the text starts with the query
  const textWords = normalizedText.split(' ');
  if (textWords.some(w => w.startsWith(normalizedQuery))) return 60;

  // Query is a substring of the text
  if (normalizedText.includes(normalizedQuery)) return 40;

  // Fuzzy (1-char edit, words ≥ 5 chars only)
  if (fuzzyMatch(normalizedQuery, normalizedText)) return 20;

  return 0;
}

// ─── Multi-word scorer ────────────────────────────────────────────────────────

/**
 * Score an item against a (potentially multi-word) query.
 * All words must produce a non-zero score (AND logic preserved).
 * Returns the sum of per-word scores, or 0 if any word fails.
 */
function scoreItem(normalizedQuery: string, normalizedFields: string): number {
  const words = normalizedQuery.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;

  let total = 0;
  for (const word of words) {
    const s = scoreMatch(word, normalizedFields);
    if (s === 0) return 0; // AND: all words must match
    total += s;
  }
  return total;
}

// ─── Main ranked search ───────────────────────────────────────────────────────

/**
 * Filter and rank `items` by `query`.
 *
 * @param items       The full list of items to search.
 * @param query       The raw (un-normalized) search string from the user.
 * @param getFields   Function that returns an array of searchable string fields
 *                    for each item (e.g. `[p.name, p.sku, p.color]`).
 * @returns Items sorted best-match-first, with zero-score items excluded.
 */
export function searchAndRank<T>(
  items: T[],
  query: string,
  getFields: (item: T) => string[],
): T[] {
  const nq = normalizeArabic(query);
  if (!nq) return items;

  const scored: Array<{ item: T; score: number }> = [];

  for (const item of items) {
    const fields = getFields(item).filter(Boolean);
    const combined = normalizeArabic(fields.join(' '));
    const score = scoreItem(nq, combined);
    if (score > 0) scored.push({ item, score });
  }

  // Stable sort: highest score first; ties preserve original order
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.item);
}

// ─── Match Highlighting ───────────────────────────────────────────────────────

/**
 * Split `text` into segments and mark which portions match the query.
 * Returns an array of `{ text, highlight }` segments ready for rendering.
 *
 * Usage:
 *   highlightSegments("iPhone 15 Pro", "15 pro")
 *   → [{ text: "iPhone ", highlight: false }, { text: "15 Pro", highlight: true }]
 */
export function highlightSegments(
  text: string,
  query: string,
): Array<{ text: string; highlight: boolean }> {
  if (!query.trim() || !text) return [{ text, highlight: false }];

  const nq = normalizeArabic(query);
  const words = nq.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [{ text, highlight: false }];

  // Build a combined regex that matches any query word (case-insensitive)
  const pattern = words
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  let regex: RegExp;
  try {
    regex = new RegExp(`(${pattern})`, 'gi');
  } catch {
    return [{ text, highlight: false }];
  }

  const parts = text.split(regex);
  return parts
    .filter(p => p.length > 0)
    .map(part => ({
      text: part,
      highlight: regex.test(part),
    }));
}

