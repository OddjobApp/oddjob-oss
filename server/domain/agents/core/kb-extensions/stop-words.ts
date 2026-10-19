/**
 * Common English stop words used for keyword similarity comparison.
 * These are removed during tokenization to focus on content-bearing words.
 */
export const STOP_WORDS: Set<string> = new Set([
  // Articles
  "a", "an", "the",
  // Pronouns
  "i", "me", "my", "myself", "we", "our", "ours", "ourselves",
  "you", "your", "yours", "yourself", "yourselves",
  "he", "him", "his", "himself", "she", "her", "hers", "herself",
  "it", "its", "itself", "they", "them", "their", "theirs", "themselves",
  "what", "which", "who", "whom", "this", "that", "these", "those",
  // Verbs (common auxiliary/linking)
  "am", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "having",
  "do", "does", "did", "doing",
  "will", "would", "shall", "should",
  "can", "could", "may", "might", "must",
  // Prepositions
  "at", "by", "for", "from", "in", "into", "of", "on", "onto",
  "to", "with", "about", "above", "after", "against", "along",
  "among", "around", "before", "behind", "below", "beneath",
  "beside", "between", "beyond", "during", "except", "inside",
  "near", "off", "out", "outside", "over", "past", "through",
  "toward", "under", "until", "up", "upon", "within", "without",
  // Conjunctions
  "and", "but", "or", "nor", "for", "yet", "so",
  "although", "because", "since", "unless", "while",
  // Adverbs / Determiners
  "not", "no", "only", "very", "just", "also", "too",
  "more", "most", "less", "least",
  "all", "any", "both", "each", "every", "few", "many", "much",
  "some", "such", "no", "other", "own", "same",
  // Common functional words
  "than", "then", "when", "where", "how", "why",
  "here", "there", "now", "again", "further",
  "once", "always", "never", "sometimes", "often",
  // Contractions (without apostrophe, post-tokenization)
  "don", "doesn", "didn", "won", "wouldn", "shouldn",
  "couldn", "wasn", "weren", "isn", "aren", "hasn", "haven",
  // Misc
  "if", "else", "as", "well", "back", "even", "still",
  "get", "got", "let", "make", "like", "just",
]);
