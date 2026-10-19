import { STOP_WORDS } from "./stop-words.js";

/**
 * Tokenizes text by lowercasing, splitting on whitespace and punctuation,
 * then removing stop words. Returns the set of remaining content words.
 */
function tokenize(text: string): Set<string> {
  if (!text || text.trim().length === 0) {
    return new Set();
  }

  const tokens = text
    .toLowerCase()
    .split(/[\s\p{P}]+/u)
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token));

  return new Set(tokens);
}

/**
 * Computes the Jaccard similarity index between two texts.
 *
 * Steps:
 * 1. Lowercases both inputs
 * 2. Tokenizes by splitting on whitespace and punctuation
 * 3. Removes common English stop words
 * 4. Computes Jaccard index: |A ∩ B| / |A ∪ B|
 *
 * @returns A number between 0.0 and 1.0 (inclusive)
 */
export function computeJaccardSimilarity(textA: string, textB: string): number {
  const setA = tokenize(textA);
  const setB = tokenize(textB);

  // Edge case: both empty or no content words remaining
  if (setA.size === 0 && setB.size === 0) {
    return 0;
  }

  // Edge case: one set empty, other has content words
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }

  let intersectionSize = 0;
  for (const word of setA) {
    if (setB.has(word)) {
      intersectionSize++;
    }
  }

  const unionSize = setA.size + setB.size - intersectionSize;

  if (unionSize === 0) {
    return 0;
  }

  return intersectionSize / unionSize;
}
