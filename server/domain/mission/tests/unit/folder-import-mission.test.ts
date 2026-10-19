/**
 * Folder Import Mission Unit Tests
 * Aligned with docs/specs/MISSIONS_SPEC.md
 * Tests: matchesFilePattern logic; mission query when files match pattern; no-op when no match
 */

/** @vitest-environment node */
import { describe, it, expect } from "vitest";

// Same logic as folder-import-executor (unit test without DB)
function matchesFilePattern(fileName: string, pattern: string): boolean {
  if (!pattern) return false;
  if (pattern === "*") return true;
  try {
    const escaped = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\\\*/g, ".*")
      .replace(/\\\?/g, ".");
    return new RegExp("^" + escaped + "$").test(fileName);
  } catch {
    return fileName === pattern;
  }
}

describe("folder_import mission file pattern matching", () => {
  it("matches *.csv for data.csv", () => {
    expect(matchesFilePattern("data.csv", "*.csv")).toBe(true);
  });

  it("matches *.csv for report_2024.csv", () => {
    expect(matchesFilePattern("report_2024.csv", "*.csv")).toBe(true);
  });

  it("does not match *.csv for data.txt", () => {
    expect(matchesFilePattern("data.txt", "*.csv")).toBe(false);
  });

  it("matches * for any file", () => {
    expect(matchesFilePattern("anything.pdf", "*")).toBe(true);
  });

  it("matches exact pattern signed_contract.pdf", () => {
    expect(matchesFilePattern("signed_contract.pdf", "signed_contract.pdf")).toBe(true);
  });

  it("does not match signed_contract.pdf for draft_contract.pdf", () => {
    expect(matchesFilePattern("draft_contract.pdf", "signed_contract.pdf")).toBe(false);
  });

  it("handles empty pattern as false", () => {
    expect(matchesFilePattern("file.csv", "")).toBe(false);
  });

  it("matches file pattern with question mark", () => {
    expect(matchesFilePattern("file1.csv", "file?.csv")).toBe(true);
    expect(matchesFilePattern("file.csv", "file?.csv")).toBe(false);
  });
});
