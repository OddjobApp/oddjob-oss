/**
 * SQL Validator — enforces read-only queries client-side.
 * Rejects INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, CREATE.
 * Handles keywords in string literals and comments.
 */

const WRITE_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i;

/**
 * Returns true if the query is read-only (safe to execute).
 * Returns false if it contains write operations.
 */
export function isReadOnlyQuery(sql: string): boolean {
  if (!sql || typeof sql !== "string") return false;

  // Strip single-line comments (-- ...)
  let cleaned = sql.replace(/--[^\n]*/g, "");

  // Strip multi-line comments (/* ... */)
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");

  // Strip string literals ('...' and "...")
  cleaned = cleaned.replace(/'[^']*'/g, "''");
  cleaned = cleaned.replace(/"[^"]*"/g, '""');

  // Now check for write keywords in the cleaned SQL
  return !WRITE_KEYWORDS.test(cleaned);
}

/**
 * Returns the specific write keyword found, or null if read-only.
 */
export function findWriteKeyword(sql: string): string | null {
  if (!sql) return null;
  let cleaned = sql.replace(/--[^\n]*/g, "");
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, "");
  cleaned = cleaned.replace(/'[^']*'/g, "''");
  cleaned = cleaned.replace(/"[^"]*"/g, '""');

  const match = cleaned.match(WRITE_KEYWORDS);
  return match ? match[1].toUpperCase() : null;
}
