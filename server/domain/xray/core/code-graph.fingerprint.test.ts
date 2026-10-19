import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildFingerprint, collectRepoFiles, resolveFingerprintPrefix, REPO_PREFIX } from "./code-graph.service.js";

describe("resolveFingerprintPrefix", () => {
  it("resolves 'oddjob' and REPO_PREFIX to repo:oddjob", () => {
    expect(resolveFingerprintPrefix("oddjob")).toBe(REPO_PREFIX);
    expect(resolveFingerprintPrefix("repo:oddjob")).toBe(REPO_PREFIX);
  });

  it("retains explicit prefixes like repo:, forge:, and blueprint:", () => {
    expect(resolveFingerprintPrefix("forge:custom-app")).toBe("forge:custom-app");
    expect(resolveFingerprintPrefix("blueprint:starter")).toBe("blueprint:starter");
  });

  it("defaults raw app slugs to forge: prefix", () => {
    expect(resolveFingerprintPrefix("my-app")).toBe("forge:my-app");
  });
});

/**
 * `createKnowledgeNodeSchema` caps `fingerprint` at 64 characters and the
 * column backs the partial unique index on (organizationId, fingerprint).
 * Exceeding the cap is rejected by the validated write path, so these bounds
 * are a correctness constraint, not a style preference.
 */
const FINGERPRINT_MAX = 64;

describe("buildFingerprint", () => {
  it("never exceeds the 64-character column/validation limit", () => {
    const brutal = "server/domain/knowledge/core/extraction/knowledge-extraction.service.ts";
    const fp = buildFingerprint(REPO_PREFIX, `${brutal}:someVeryLongExportedSymbolName`);
    expect(fp.length).toBeLessThanOrEqual(FINGERPRINT_MAX);
  });

  it("stays within the limit even for a pathological prefix", () => {
    const fp = buildFingerprint("forge:" + "x".repeat(300), "a/b/c.ts:name");
    expect(fp.length).toBeLessThanOrEqual(FINGERPRINT_MAX);
  });

  it("is deterministic", () => {
    const a = buildFingerprint(REPO_PREFIX, "server/a.ts:foo");
    const b = buildFingerprint(REPO_PREFIX, "server/a.ts:foo");
    expect(a).toBe(b);
  });

  it("distinguishes different symbols in the same file", () => {
    const a = buildFingerprint(REPO_PREFIX, "server/a.ts:foo");
    const b = buildFingerprint(REPO_PREFIX, "server/a.ts:bar");
    expect(a).not.toBe(b);
  });

  it("distinguishes the same symbol across different workspaces", () => {
    const a = buildFingerprint("forge:app-one", "src/a.ts:handler");
    const b = buildFingerprint("forge:app-two", "src/a.ts:handler");
    expect(a).not.toBe(b);
  });

  it("distinguishes workspaces whose prefixes share a long common head", () => {
    // The readable portion is truncated, so two long slugs can present the same
    // visible prefix — the hash must still separate them.
    const a = buildFingerprint("forge:customer-portal-alpha", "src/a.ts:handler");
    const b = buildFingerprint("forge:customer-portal-beta", "src/a.ts:handler");
    expect(a).not.toBe(b);
  });
});

describe("collectRepoFiles", () => {
  let repoRoot: string;

  beforeAll(async () => {
    repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "repofiles-"));
    const write = async (rel: string) => {
      const full = path.join(repoRoot, rel);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, "export const x = 1;\n", "utf-8");
    };

    await write("server/a.service.ts");
    await write("shared/schema/b.ts");
    await write("client/src/c.tsx");
    await write("scripts/d.ts");
    await write("server/nested/deep/e.ts");
    // Excluded by extension / declaration files.
    await write("server/types.d.ts");
    await write("server/notes.md");
    // Excluded directories.
    await write("server/node_modules/pkg/index.ts");
    await write("server/dist/bundle.js");
    // Outside the scanned source roots.
    await write("docs/ignored.ts");
  });

  afterAll(async () => {
    await fs.rm(repoRoot, { recursive: true, force: true });
  });

  it("collects source files across all configured roots", async () => {
    const files = await collectRepoFiles(repoRoot);
    expect(files).toContain("server/a.service.ts");
    expect(files).toContain("shared/schema/b.ts");
    expect(files).toContain("client/src/c.tsx");
    expect(files).toContain("scripts/d.ts");
    expect(files).toContain("server/nested/deep/e.ts");
  });

  it("excludes declaration files, non-source files, and skipped directories", async () => {
    const files = await collectRepoFiles(repoRoot);
    expect(files).not.toContain("server/types.d.ts");
    expect(files).not.toContain("server/notes.md");
    expect(files.some(f => f.includes("node_modules"))).toBe(false);
    expect(files.some(f => f.includes("dist/"))).toBe(false);
  });

  it("does not walk outside the configured source roots", async () => {
    const files = await collectRepoFiles(repoRoot);
    expect(files.some(f => f.startsWith("docs/"))).toBe(false);
  });

  it("returns posix-separated repo-relative paths on every platform", async () => {
    const files = await collectRepoFiles(repoRoot);
    expect(files.every(f => !f.includes("\\"))).toBe(true);
    expect(files.every(f => !path.isAbsolute(f))).toBe(true);
  });

  it("honours the file limit", async () => {
    const files = await collectRepoFiles(repoRoot, 2);
    expect(files).toHaveLength(2);
  });
});
