/** @vitest-environment node */
import { afterAll, describe, expect, it } from "vitest";
import { copyFileSync, readdirSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createPlatformDocumentationLibrary, PLATFORM_DOCUMENTATION_MANIFEST } from "./platform-documentation.service.js";
import { platformMatchesFilter, retrievePlatformDocumentation } from "./platform-documentation-retrieval.js";

const root = mkdtempSync(path.join(os.tmpdir(), "oddjob-public-docs-"));
for (const entry of PLATFORM_DOCUMENTATION_MANIFEST) {
  mkdirSync(path.dirname(path.join(root, entry.file)), { recursive: true });
  copyFileSync(path.resolve("docs", entry.file), path.join(root, entry.file));
}
writeFileSync(path.join(root, "private-organization-upload.md"), "privatetenantcanary928541 confidential customer information");
const library = createPlatformDocumentationLibrary(root);
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("published platform documentation boundary", () => {
  it("marks template excerpts as reference guidance rather than verified product claims", () => {
    const hits=library.search("42% Governed AI",1,50);
    const campaign=hits.find(hit=>hit.id.includes("marketing-campaign"));
    expect(campaign).toBeDefined();
    expect(campaign!.metadata.referenceOnly).toBe(true);
    expect(campaign!.textContent).toMatch(/^\[PLATFORM REFERENCE ONLY/);
    expect(campaign!.textContent).toContain("Do not present template metrics");
  });

  it("makes the same versioned public guides available to existing and new orgs", () => {
    expect(library.list(1)).toHaveLength(PLATFORM_DOCUMENTATION_MANIFEST.length);
    expect(library.list(2)).toEqual(library.list(1));
    expect(library.list(999999)).toEqual(library.list(1));
    for (const doc of library.list(1)) {
      expect(doc).toMatchObject({ scope: "platform", readOnly: true, sourceType: "platform_documentation" });
      expect(doc.version).toMatch(/^[a-f0-9]{64}$/);
      expect(doc.id).toMatch(/^platform:[a-z0-9-]+$/);
    }
  });
  it.each([null, undefined, 0, -1, NaN, 1.5])("does not supply shared content without valid org context (%s)", org => {
    expect(library.list(org)).toEqual([]);
    expect(library.get("platform:keys-and-credentials", org)).toBeNull();
    expect(library.search("Gemini", org)).toEqual([]);
  });
  it("never discovers unlisted files, tenant uploads or numeric private document IDs", () => {
    expect(library.search("privatetenantcanary928541", 1)).toEqual([]);
    expect(library.get("private-organization-upload.md", 1)).toBeNull();
    expect(library.get("42", 1)).toBeNull();
    expect(library.get("platform:../../private-organization-upload.md", 1)).toBeNull();
  });
  it("covers every packaged best-practice source and retrieves its content for every org", () => {
    const published = PLATFORM_DOCUMENTATION_MANIFEST.filter(entry => entry.file.startsWith("platform/"));
    const disk = readdirSync(path.resolve("docs/platform"), {recursive:true, withFileTypes:true})
      .filter(entry => entry.isFile() && /\.(md|yaml|json|ts)$/.test(entry.name))
      .map(entry => path.relative(path.resolve("docs"), path.join(entry.parentPath, entry.name)).replace(/\\/g,"/"));
    expect(published.map(entry=>entry.file).sort()).toEqual(disk.sort());
    expect(published).toHaveLength(81);
    expect(new Set(PLATFORM_DOCUMENTATION_MANIFEST.map(entry=>entry.slug)).size).toBe(PLATFORM_DOCUMENTATION_MANIFEST.length);
    for (const entry of published) {
      const doc=library.get(`platform:${entry.slug}`, 1)!;
      expect(doc.textContent).toBe(readFileSync(path.resolve("docs",entry.file),"utf8"));
      expect(library.get(doc.id, 999999)).toEqual(doc);
      expect(library.search(entry.title,1,50).map(hit=>hit.id)).toContain(doc.id);
    }
  });
  it("finds organization key guidance without embeddings or an AI provider", () => {
    const hits = library.search("BYOK credentials", 1);
    expect(hits.map(hit => hit.id)).toContain("platform:keys-and-credentials");
    expect(library.search("BYOK credentials", 2)).toEqual(hits);
    expect(hits.every(hit => hit.textContent && hit.url.startsWith("/knowledge/platform-docs?id="))).toBe(true);
  });
  it("does not let a consumer mutate the published index", () => {
    const doc = library.get("platform:first-mission", 1)!;
    doc.textContent = "tenant replacement";
    expect(library.get(doc.id, 2)!.textContent).not.toBe("tenant replacement");
  });
  it("fails visibly if a published document is missing rather than returning a green empty index", () => {
    expect(() => createPlatformDocumentationLibrary(path.join(root, "missing"))).toThrow();
  });
});

describe("platform retrieval respects explicit scopes", () => {
  it("returns published chunks to both organizations with namespaced provenance", () => {
    const first = retrievePlatformDocumentation("BYOK credentials", { organizationId: 1 });
    expect(first.length).toBeGreaterThan(0);
    expect(retrievePlatformDocumentation("BYOK credentials", { organizationId: 2 })).toEqual(first);
    expect(first.every(hit => hit.metadata.scope === "platform" && hit.metadata.readOnly)).toBe(true);
  });
  it.each(["attachment", "projectId", "sessionId", "organizationId"])("does not broaden a %s-scoped retrieval", key => {
    const filter = { must: [{ key: key === "attachment" ? "assetType" : key, match: { value: key === "attachment" ? "attachment" : 1 } }] };
    expect(retrievePlatformDocumentation("Gemini", { organizationId: 1, filter })).toEqual([]);
  });
  it("honors classification, exclusions, thresholds and unsupported filters", () => {
    expect(platformMatchesFilter({ must: [{ key: "securityClassification", range: { lte: 1 } }] })).toBe(true);
    expect(platformMatchesFilter({ must: [{ key: "securityClassification", range: { lt: 1 } }] })).toBe(false);
    expect(platformMatchesFilter({ must_not: [{ key: "sourceType", match: { value: "platform_documentation" } }] })).toBe(false);
    expect(platformMatchesFilter({ min_should: { conditions: [], min_count: 0 } })).toBe(false);
    expect(retrievePlatformDocumentation("Gemini", { organizationId: 1, scoreThreshold: 1 })).toEqual([]);
    expect(retrievePlatformDocumentation("Gemini", { organizationId: 1, missionId: 7 })).toEqual([]);
    expect(retrievePlatformDocumentation("Gemini", { organizationId: 1, before: "2020-01-01" })).toEqual([]);
  });
});
