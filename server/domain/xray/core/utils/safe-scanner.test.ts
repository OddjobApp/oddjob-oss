import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const mockReaddir = vi.fn();
const mockRealpath = vi.fn();
const mockStat = vi.fn();

vi.mock("node:fs/promises", () => ({
  default: {
    readdir: (...args: any[]) => mockReaddir(...args),
    realpath: (...args: any[]) => mockRealpath(...args),
    stat: (...args: any[]) => mockStat(...args),
  },
}));

import { listSourceFilesSafe } from "./safe-scanner.js";

describe("listSourceFilesSafe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array if directory does not exist (ENOENT)", async () => {
    mockReaddir.mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    );

    const result = await listSourceFilesSafe("/project/missing", "/project");
    expect(result).toEqual([]);
  });

  it("returns empty array if directory is inaccessible (EACCES)", async () => {
    mockReaddir.mockRejectedValue(
      Object.assign(new Error("EACCES"), { code: "EACCES" })
    );

    const result = await listSourceFilesSafe("/project/locked", "/project");
    expect(result).toEqual([]);
  });

  it("skips directories in skipDirs", async () => {
    const projectRoot = "/project";
    const entries = [
      { name: "node_modules", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
      { name: ".git", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
      { name: "dist", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
      { name: ".next", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
      { name: "storage", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
      { name: "app.ts", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
    ];

    mockReaddir.mockResolvedValue(entries);

    const result = await listSourceFilesSafe("/project/src", projectRoot);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("app.ts");
  });

  it("only includes files with matching extensions", async () => {
    const projectRoot = "/project";
    const entries = [
      { name: "index.ts", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
      { name: "style.css", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
      { name: "App.tsx", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
      { name: "main.js", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
      { name: "Button.jsx", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
      { name: "readme.md", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
      { name: "data.json", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
    ];

    mockReaddir.mockResolvedValue(entries);

    const result = await listSourceFilesSafe("/project/src", projectRoot);
    expect(result).toHaveLength(4);
    expect(result.map((f) => path.basename(f))).toEqual(
      expect.arrayContaining(["index.ts", "App.tsx", "main.js", "Button.jsx"])
    );
  });

  it("respects custom extensions option", async () => {
    const projectRoot = "/project";
    const entries = [
      { name: "index.ts", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
      { name: "style.css", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
    ];

    mockReaddir.mockResolvedValue(entries);

    const result = await listSourceFilesSafe("/project/src", projectRoot, {
      extensions: [".css"],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("style.css");
  });

  it("respects maxFiles limit and returns partial results", async () => {
    const projectRoot = "/project";
    const entries = Array.from({ length: 10 }, (_, i) => ({
      name: `file${i}.ts`,
      isDirectory: () => false,
      isFile: () => true,
      isSymbolicLink: () => false,
    }));

    mockReaddir.mockResolvedValue(entries);

    const result = await listSourceFilesSafe("/project/src", projectRoot, {
      maxFiles: 5,
    });
    expect(result).toHaveLength(5);
  });

  it("respects maxDepth limit and returns partial results", async () => {
    const projectRoot = "/project";

    let callCount = 0;
    mockReaddir.mockImplementation(() => {
      callCount++;
      return Promise.resolve([
        // File entries come before subdirectory so they get collected
        // before depth-first recursion triggers the limit
        { name: `file${callCount}.ts`, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
        { name: `sub${callCount}`, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
      ]);
    });

    const result = await listSourceFilesSafe("/project/src", projectRoot, {
      maxDepth: 3,
    });
    // depth 0: collect file1.ts, then recurse sub1
    // depth 1: collect file2.ts, then recurse sub2
    // depth 2: collect file3.ts, then recurse sub3
    // depth 3: collect file4.ts, then recurse sub4
    // depth 4 (>3): limit hit, limitReached = true, return
    // Unwinding: limitReached prevents further processing
    // Result: file1.ts through file4.ts = 4 files collected before limit
    expect(result.length).toBeLessThanOrEqual(5);
    expect(result.length).toBeGreaterThan(0);
  });

  it("resolves symlinks and skips those outside project root", async () => {
    const projectRoot = "/project";
    const entries = [
      { name: "safe-link.ts", isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true },
      { name: "escape-link.ts", isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true },
    ];

    mockReaddir.mockResolvedValue(entries);
    mockRealpath.mockImplementation((p: string) => {
      if (p.includes("safe-link")) return Promise.resolve("/project/src/real-file.ts");
      if (p.includes("escape-link")) return Promise.resolve("/etc/secret.ts");
      return Promise.reject(new Error("ENOENT"));
    });
    mockStat.mockResolvedValue({ isDirectory: () => false, isFile: () => true });

    const result = await listSourceFilesSafe("/project/src", projectRoot);
    // Only safe-link.ts should be included (resolves within project root and has .ts extension)
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("safe-link.ts");
  });

  it("recurses into directories", async () => {
    const projectRoot = "/project";

    mockReaddir.mockImplementation((dir: string) => {
      const normalized = dir.replace(/\\/g, "/");
      if (normalized.endsWith("src")) {
        return Promise.resolve([
          { name: "components", isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false },
          { name: "index.ts", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
        ]);
      }
      if (normalized.endsWith("components")) {
        return Promise.resolve([
          { name: "Button.tsx", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
        ]);
      }
      return Promise.resolve([]);
    });

    const result = await listSourceFilesSafe("/project/src", projectRoot);
    expect(result).toHaveLength(2);
    expect(result.map((f) => path.basename(f))).toEqual(
      expect.arrayContaining(["index.ts", "Button.tsx"])
    );
  });

  it("handles symlink that cannot be resolved", async () => {
    const projectRoot = "/project";
    const entries = [
      { name: "broken-link", isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true },
      { name: "good.ts", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
    ];

    mockReaddir.mockResolvedValue(entries);
    mockRealpath.mockRejectedValue(new Error("ENOENT"));

    const result = await listSourceFilesSafe("/project/src", projectRoot);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("good.ts");
  });

  it("traverses symlink directories that resolve within project root", async () => {
    const projectRoot = "/project";
    const entries = [
      { name: "linked-dir", isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true },
    ];

    mockReaddir.mockImplementation((dir: string) => {
      const normalized = dir.replace(/\\/g, "/");
      if (normalized.endsWith("src")) {
        return Promise.resolve(entries);
      }
      if (normalized.includes("real-dir")) {
        return Promise.resolve([
          { name: "nested.ts", isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false },
        ]);
      }
      return Promise.resolve([]);
    });

    mockRealpath.mockResolvedValue("/project/real-dir");
    mockStat.mockResolvedValue({ isDirectory: () => true, isFile: () => false });

    const result = await listSourceFilesSafe("/project/src", projectRoot);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("nested.ts");
  });
});
