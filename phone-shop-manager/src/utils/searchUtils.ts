/**
 * searchUtils.ts — Professional-grade ranked + fuzzy search helpers.
 *
 * All normalization is intentionally delegated to `normalizeArabic()` so the
 * Arabic / Latin / digit folding stays in one place and stays consistent with
 * the mobile app.
 *
 * ── Why per-field scoring? ────────────────────────────────────────────────────
 * Joining all fields into one string before scoring causes "cross-field" false
 * positives.  Example:
 *   product  name="AF-REDMI 9 ORG"  storage="9A"
 *   query    "REDMI 9A"
 *   joined   "af redmi 9 org 9a ..."  → both words match → WRONG inclusion
 *
 * Fix: score each field INDEPENDENTLY.  ALL query words must be satisfied
 * within ONE field (or the natural name+model pair).  A match in the storage
 * field cannot "complete" a partial match from the name field.
 *
 * Scoring (higher = better match, per field):
 *   100  exact full-field match
 *    80  field starts with the full query
 *    75  a word in field starts with the full query phrase
 *    70  field contains the full query phrase as a substring
 *    60  every query word: a field-word starts with that query word
 *    40  every query word: appears as a substring within a field-word
 *    20  every query word: fuzzy match (1-char edit, words ≥ 5 chars)
 *     0  no match → item excluded
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

/** Returns true when `word` is within 1 edit of any word in `target`. */
export function fuzzyMatch(word: string, target: string): boolean {
  if (word.length < 5) return false; // only fuzzy for longer words
  const targetWords = target.split(' ');
  for (const tw of targetWords) {
    if (tw === word) return false; // exact already handled
    if (Math.abs(tw.length - word.length) <= 1 && levenshtein(word, tw) <= 1) return true;
  }
  return false;
}

// ─── Single query-word scorer against a single normalized field ───────────────

/**
 * Score how well a single query word matches a single normalized field string.
 * Returns 0 when there is no match.
 */
export function scoreMatch(normalizedQueryWord: string, normalizedField: string): number {
  if (!normalizedQueryWord || !normalizedField) return 0;

  const fieldWords = normalizedField.split(' ');

  // Exact whole-field match
  if (normalizedField === normalizedQueryWord) return 100;

  // Alpha-only restriction: pure-alphabetic tokens (brand names like "redmi", "samsung")
  // allow prefix/substring expansion.  Numeric/alphanumeric tokens ("9", "15", "9a")
  // must match EXACTLY as whole words — no prefix expansion — so "9" ≠ "9a".
  const isAlphaOnly = /^[a-z\u0600-\u06ff]+$/.test(normalizedQueryWord);

  // Field starts with the query word (score 80 — higher than whole-word score 70).
  // Restricted to alpha-only tokens so numeric "9" does NOT match field "9a" via startsWith.
  if (isAlphaOnly && normalizedField.startsWith(normalizedQueryWord)) return 80;

  // Any field-word exactly equals the query word (whole-word exact match)
  if (fieldWords.some(w => w === normalizedQueryWord)) return 70;

  // Prefix matching: a field-word starts with the query word.
  // Also alpha-only: "9" must not prefix-match "9a".
  if (isAlphaOnly && fieldWords.some(w => w.startsWith(normalizedQueryWord))) return 60;

  // Intra-word substring: query appears inside a field-word.
  // Same alpha-only restriction: "9" must not partial-match "9a".
  if (isAlphaOnly && fieldWords.some(w => w.includes(normalizedQueryWord))) return 40;

  // Fuzzy (1-char edit, words ≥ 5 chars only)
  if (fuzzyMatch(normalizedQueryWord, normalizedField)) return 20;

  return 0;
}

// ─── Per-field multi-word scorer ──────────────────────────────────────────────

/**
 * Score a SINGLE field against ALL query words.
 * ALL words must match within THIS one field — returns 0 if any word fails.
 * This prevents "cross-field" false positives.
 */
function scoreField(queryWords: string[], normalizedField: string): number {
  if (!normalizedField) return 0;

  // Bonus: if the field contains the entire query as a phrase, score high.
  // "startsWith" check requires a true word boundary after the phrase so that
  // e.g. query "redmi 9" does NOT match field "redmi 9a" (9 ≠ 9a).
  const phrase = queryWords.join(' ');
  if (normalizedField === phrase) return 100 * queryWords.length;

  // Field starts with the phrase AND the next char (if any) is a space (word boundary).
  const afterPhrase = normalizedField.slice(phrase.length);
  if (normalizedField.startsWith(phrase) && (afterPhrase === '' || afterPhrase.startsWith(' '))) {
    return 80 * queryWords.length;
  }

  const fieldWords = normalizedField.split(' ');

  // A single field-word starts with the full phrase (unusual but handle it).
  // Also enforce word boundary: the phrase must end at a word boundary inside `w`.
  if (fieldWords.some(w => w.startsWith(phrase) && (w.length === phrase.length || w[phrase.length] === ' '))) {
    return 75 * queryWords.length;
  }

  // The field contains the phrase as a substring (preceded/followed by spaces or edges).
  const phraseInField = new RegExp(`(?:^| )${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?= |$)`);
  if (phraseInField.test(normalizedField)) return 70 * queryWords.length;

  // All query words must individually satisfy this field
  let total = 0;
  for (const word of queryWords) {
    const s = scoreMatch(word, normalizedField);
    if (s === 0) return 0; // AND — one failure disqualifies this field
    total += s;
  }
  return total;
}

// ─── Main ranked search ───────────────────────────────────────────────────────

/**
 * Filter and rank `items` by `query`.
 *
 * Each item is scored against its fields INDIVIDUALLY (not joined).
 * The item's final score is the best score across all its fields plus
 * the natural name+model pair (fields[0]+fields[1]).
 *
 * @param items       The full list of items to search.
 * @param query       The raw (un-normalized) search string from the user.
 * @param getFields   Function returning searchable fields for each item.
 *                    The FIRST two fields should be name and model/variant —
 *                    they are also scored together as a natural pair.
 * @returns Items sorted best-match-first, with zero-score items excluded.
 */
export function searchAndRank<T>(
  items: T[],
  query: string,
  getFields: (item: T) => string[],
): T[] {
  const nq = normalizeArabic(query);
  if (!nq) return items;

  const queryWords = nq.trim().split(/\s+/).filter(Boolean);
  if (!queryWords.length) return items;

  const scored: Array<{ item: T; score: number }> = [];

  for (const item of items) {
    const rawFields = getFields(item).filter(Boolean);
    if (!rawFields.length) continue;

    let bestScore = 0;

    // Score each field individually — ALL query words must match within ONE field
    for (const field of rawFields) {
      const nf = normalizeArabic(field);
      const s = scoreField(queryWords, nf);
      if (s > bestScore) bestScore = s;
      if (bestScore >= 100 * queryWords.length) break; // can't do better
    }

    // Also score the natural name+model pair (first two fields joined)
    // e.g. name="iPhone" model="15 Pro" → "iphone 15 pro"
    if (rawFields.length >= 2) {
      const nameModel = normalizeArabic(rawFields.slice(0, 2).join(' '));
      const s = scoreField(queryWords, nameModel);
      if (s > bestScore) bestScore = s;
    }

    if (bestScore > 0) scored.push({ item, score: bestScore });
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

