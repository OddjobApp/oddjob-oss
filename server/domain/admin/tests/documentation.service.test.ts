import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import fs from "node:fs/promises";
import { documentationService } from "../documentation.service.js";
import { knowledgeService } from "@domain/knowledge/core/knowledge.service.js";
import { NotFoundError } from "@server/utils/errors.js";

// Helper for query mocks
const createMockQuery = (result: any = []) => {
  const query = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(result),
    execute: vi.fn().mockResolvedValue(result),
    then: (onFulfilled: any) => Promise.resolve(result).then(onFulfilled),
    catch: (onRejected: any) => Promise.resolve(result).catch(onRejected),
  };
  return query;
};

// Mock crypto so fingerprinting is completely deterministic in tests
let mockFingerprint = "mock-fingerprint";
vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  const mockedCreateHash = () => ({
    update: () => ({
      digest: () => mockFingerprint,
    }),
  });
  return {
    ...actual,
    createHash: mockedCreateHash,
    default: {
      ...actual,
      createHash: mockedCreateHash,
    },
  };
});

// Mock the dependencies
vi.mock("node:fs/promises", () => ({
  default: {
    readdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
    access: vi.fn(),
  },
}));

vi.mock("@server/database_service.js", () => ({
  db: {
    select: vi.fn(() => createMockQuery()),
    insert: vi.fn(() => createMockQuery()),
    update: vi.fn(() => createMockQuery()),
    delete: vi.fn(() => createMockQuery()),
  },
}));

vi.mock("@domain/knowledge/core/knowledge.service.js", () => ({
  knowledgeService: {
    getDocumentByTitle: vi.fn(),
    getDocumentById: vi.fn(),
    listDocumentsByGeneratedFrom: vi.fn(),
    getGeneratedSpecMeta: vi.fn(),
    searchGeneratedSpecs: vi.fn(),
    createDocument: vi.fn(),
    updateDocument: vi.fn(),
  },
}));

// The real queue is BullMQ on Redis. Unmocked, generateForFeature enqueues on it and
// hangs until the test times out wherever Redis is not running, including the
// hermetic verify job in CI; it only passed where a dev Redis happened to be up.
vi.mock("@domain/knowledge/knowledge-queue.js", () => ({
  queueExtractionJob: vi.fn().mockResolvedValue({ id: "job-1" }),
}));

vi.mock("@domain/ai/core/system-ai.service.js", () => ({
  systemAiService: {
    generateText: vi.fn().mockImplementation(async (prompt: string) =>
      prompt.includes("release notes")
        ? "Added the Auth architecture reference, establishing coverage for the module's current implementation."
        : "Mocked AI architecture overview narrative"
    ),
  },
}));

describe("DocumentationService", () => {
  const mockOrgId = 1;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFingerprint = "mock-fingerprint";
    // Flush cache of scanned features between tests to ensure filesystem mocks are hit
    (documentationService as any).scanCache = null;
    (documentationService as any).scanCachedAt = 0;
    (fs.access as Mock).mockResolvedValue(undefined);
    (knowledgeService.getGeneratedSpecMeta as Mock).mockResolvedValue(new Map());
    (knowledgeService.getDocumentByTitle as Mock).mockResolvedValue(null);
    (knowledgeService.listDocumentsByGeneratedFrom as Mock).mockResolvedValue([]);
    (knowledgeService.createDocument as Mock).mockResolvedValue({ id: 101 });
  });

  describe("Feature Scanning & Retrieval", () => {
    it("should scan server/domain directories and parse routes and dependencies", async () => {
      // Mock readdir for server/domain
      (fs.readdir as Mock).mockImplementation(async (dirPath: string) => {
        if (dirPath.endsWith("domain")) {
          return [
            { name: "auth", isDirectory: () => true },
            { name: "jobs", isDirectory: () => true },
          ];
        }
        return [];
      });

      // Mock listSourceFiles/fs.readdir for subdirectories
      (fs.readdir as Mock).mockImplementation(async (dirPath: string) => {
        if (dirPath.endsWith("domain")) {
          return [
            { name: "auth", isDirectory: () => true, isFile: () => false },
            { name: "jobs", isDirectory: () => true, isFile: () => false },
          ];
        } else if (dirPath.endsWith("auth")) {
          return [
            { name: "auth.route.ts", isDirectory: () => false, isFile: () => true },
          ];
        } else if (dirPath.endsWith("jobs")) {
          return [
            { name: "jobs.service.ts", isDirectory: () => false, isFile: () => true },
          ];
        }
        return [];
      });

      // Mock fs.stat to return file mtimes
      (fs.stat as Mock).mockResolvedValue({ mtimeMs: 1000 });

      // Mock fs.readFile for auth.route.ts and jobs.service.ts
      (fs.readFile as Mock).mockImplementation(async (filePath: string) => {
        if (filePath.endsWith("auth.route.ts")) {
          return `
            import { something } from "@domain/core";
            router.post("/login", loginHandler);
            router.get("/session", sessionHandler);
          `;
        } else if (filePath.endsWith("jobs.service.ts")) {
          return `
            import { authService } from "@domain/auth";
            import { db } from "@server/database";
          `;
        }
        return "";
      });

      const features = await documentationService.getFeatures(mockOrgId);

      expect(features).toHaveLength(2);
      const authFeature = features.find((f) => f.id === "auth");
      const jobsFeature = features.find((f) => f.id === "jobs");

      expect(authFeature).toBeDefined();
      expect(authFeature?.apis).toContain("POST /login");
      expect(authFeature?.apis).toContain("GET /session");

      expect(jobsFeature).toBeDefined();
      expect(jobsFeature?.dependencies).toContain("auth");
    });

    it("includes cross-cutting supplemental features (Cycles, Workstreams) that live inside shared modules", async () => {
      // No top-level domain modules — isolate the supplemental (cross-cutting) scan.
      (fs.readdir as Mock).mockImplementation(async (dirPath: string) => {
        const p = String(dirPath).replace(/\\/g, "/");
        if (p.endsWith("mission/core")) {
          return [{ name: "cycle-dag.service.ts", isDirectory: () => false, isFile: () => true }];
        }
        if (p.endsWith("domain/mission")) {
          return [{ name: "workstreams.route.ts", isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });
      (fs.stat as Mock).mockResolvedValue({ mtimeMs: 2000 });
      (fs.readFile as Mock).mockImplementation(async (filePath: string) => {
        if (String(filePath).endsWith("cycle-dag.service.ts")) {
          return `import { x } from "@domain/mission";`;
        }
        if (String(filePath).endsWith("workstreams.route.ts")) {
          return `router.get("/workstreams", handler);`;
        }
        return "";
      });

      const features = await documentationService.getFeatures(mockOrgId);

      const cycles = features.find((f) => f.id === "cycles");
      expect(cycles).toBeDefined();
      expect(cycles?.name).toBe("Cycles");
      expect(cycles?.dependencies).toContain("mission");

      const workstreams = features.find((f) => f.id === "workstreams");
      expect(workstreams).toBeDefined();
      expect(workstreams?.apis).toContain("GET /workstreams");
    });

    it("a real server/domain/<id> module shadows a same-id supplemental feature (no duplicate rows)", async () => {
      // A real server/domain/cycles module exists AND a supplemental "cycles"
      // would be produced — the real one must win, with no duplicate entry.
      (fs.readdir as Mock).mockImplementation(async (dirPath: string) => {
        const p = String(dirPath).replace(/\\/g, "/");
        if (p.endsWith("domain")) {
          return [{ name: "cycles", isDirectory: () => true, isFile: () => false }];
        }
        if (p.endsWith("domain/cycles")) {
          return [{ name: "cycles.service.ts", isDirectory: () => false, isFile: () => true }];
        }
        if (p.endsWith("mission/core")) {
          return [{ name: "cycle-dag.service.ts", isDirectory: () => false, isFile: () => true }];
        }
        return [];
      });
      (fs.stat as Mock).mockResolvedValue({ mtimeMs: 3000 });
      (fs.readFile as Mock).mockResolvedValue("");

      const features = await documentationService.getFeatures(mockOrgId);

      const cyclesFeatures = features.filter((f) => f.id === "cycles");
      expect(cyclesFeatures).toHaveLength(1);
      // The real module wins — its directory_path is the actual dir, not the
      // supplemental's human-readable label.
      expect(cyclesFeatures[0].directory_path).toBe("server/domain/cycles");
    });
  });

  describe("getFeatureSpec", () => {
    beforeEach(() => {
      // Seed the cache with a known feature
      (documentationService as any).scanCache = [
        {
          id: "auth",
          name: "Auth",
          description: "Mock Auth feature",
          apis: ["POST /login"],
          dependencies: [],
          relatedResourceTypes: [],
          mcpTools: [],
          directory_path: "server/domain/auth",
          lastSourceModifiedMs: 500,
        },
      ];
      // Mark the seeded cache fresh so getScannedFeatures uses it instead of
      // re-scanning the (mocked) filesystem — keeps these tests hermetic.
      (documentationService as any).scanCachedAt = Date.now();
    });

    it("returns persisted spec when present in knowledge graph", async () => {
      const mockDocument = {
        title: "Auth — Architecture Reference",
        summary: "Auth summary",
        textContent: "Mocked stored spec content",
        updatedAt: new Date(1000),
        createdAt: new Date(1000),
      };
      (knowledgeService.getDocumentByTitle as Mock).mockResolvedValue(mockDocument);

      (knowledgeService.getGeneratedSpecMeta as Mock).mockResolvedValue(
        new Map([
          [
            "Auth — Architecture Reference",
            {
              updatedAt: new Date(1000),
              fingerprint: "mock-fingerprint",
              summary: "Auth summary",
            },
          ],
        ])
      );

      const spec = await documentationService.getFeatureSpec("auth", mockOrgId);

      expect(spec.featureId).toBe("auth");
      expect(spec.persisted).toBe(true);
      expect(spec.markdown).toBe("Mocked stored spec content");
      expect(spec.generatedAt).toBe(mockDocument.updatedAt.toISOString());
      expect(spec.status).toBe("up-to-date");
    });

    it("falls back to building markdown on demand when absent from knowledge graph", async () => {
      (knowledgeService.getDocumentByTitle as Mock).mockResolvedValue(null);
      (knowledgeService.getGeneratedSpecMeta as Mock).mockResolvedValue(new Map());

      const spec = await documentationService.getFeatureSpec("auth", mockOrgId);

      expect(spec.featureId).toBe("auth");
      expect(spec.persisted).toBe(false);
      expect(spec.generatedAt).toBeNull();
      expect(spec.markdown).toContain("# Auth");
      expect(spec.status).toBe("missing");
    });

    it("reports outdated status if fingerprint doesn't match", async () => {
      const mockDocument = {
        title: "Auth — Architecture Reference",
        summary: "Auth summary",
        textContent: "Mocked stored spec content",
        updatedAt: new Date(1000),
      };
      (knowledgeService.getDocumentByTitle as Mock).mockResolvedValue(mockDocument);
      (knowledgeService.getGeneratedSpecMeta as Mock).mockResolvedValue(
        new Map([
          [
            "Auth — Architecture Reference",
            {
              updatedAt: new Date(1000),
              fingerprint: "different-fingerprint",
              summary: "Auth summary",
            },
          ],
        ])
      );

      const spec = await documentationService.getFeatureSpec("auth", mockOrgId);

      expect(spec.status).toBe("outdated");
    });

    it("throws NotFoundError on unknown feature", async () => {
      await expect(
        documentationService.getFeatureSpec("unknown-id", mockOrgId)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("generateForFeature", () => {
    it("creates a document in the knowledge service", async () => {
      (documentationService as any).scanCache = [
        {
          id: "auth",
          name: "Auth",
          description: "Mock Auth feature",
          apis: ["GET /changes"],
          dependencies: [],
          relatedResourceTypes: [],
          mcpTools: [],
          directory_path: "server/domain/auth",
          lastSourceModifiedMs: 500,
        },
      ];
      (documentationService as any).scanCachedAt = Date.now();

      (knowledgeService.createDocument as Mock).mockResolvedValue({ id: "doc-123" });
      (knowledgeService.getGeneratedSpecMeta as Mock).mockResolvedValue(new Map());

      const success = await documentationService.generateForFeature("auth", mockOrgId);

      expect(success).toBe(true);
      expect(knowledgeService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Auth — Architecture Reference",
          textContent: expect.stringContaining("Mocked AI architecture overview narrative"),
        }),
        expect.objectContaining({
          organizationId: mockOrgId,
        })
      );
      expect(knowledgeService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: expect.stringContaining("Added Auth — Architecture Reference"),
          metadata: expect.objectContaining({
            generatedFrom: "documentation-change-register",
            documentKey: "auth",
            kind: "addition",
            addedRoutes: [{ module: null, method: "GET", path: "/changes" }],
          }),
        }),
        expect.objectContaining({ organizationId: mockOrgId }),
      );
    });
  });

  describe("change register and releases", () => {
    it("publishes an idempotent capability spec and structured register entry", async () => {
      (knowledgeService.createDocument as Mock)
        .mockResolvedValueOnce({ id: 201 })
        .mockResolvedValueOnce({ id: 202 });

      await documentationService.publishCapabilityDocumentationChange({
        organizationId: mockOrgId,
        manifest: {
          schema_version: 1,
          capability_version: "1.1.0",
          capability_id: "extract_invoice_rows",
          metadata: { display_name: "Extract Invoice Rows", category: "Data Operations", description: "Extract rows.", owner: "data" },
          technical_spec: { inputs: { image: "string" }, outputs: { rows: "array" } },
          documentation_meta: { summary: "Extract invoice rows.", business_use_cases: [], guardrails: [] },
          runtime_context: { risk_profile: "Low", execution_environment: "Host", dependencies: [] },
        },
        markdown: "# Extract Invoice Rows\n\nVersion 1.1.0",
        revision: 2,
        source: "code",
        changeKind: "behavioral",
        changedFields: [{ path: "inputs.image", changeType: "added", old: undefined, new: "string" }],
        contentHash: "content-2",
        docPath: "docs/capabilities/extract_invoice_rows.md",
      });

      expect(knowledgeService.createDocument).toHaveBeenNthCalledWith(1,
        expect.objectContaining({
          metadata: expect.objectContaining({
            generatedFrom: "documentation-change-register",
            specType: "capability",
            capabilityVersion: "1.1.0",
            revision: 2,
          }),
        }),
        expect.objectContaining({ organizationId: mockOrgId }),
      );
      expect(knowledgeService.createDocument).toHaveBeenNthCalledWith(2,
        expect.objectContaining({
          title: "Capability extract_invoice_rows — Capability Reference",
          metadata: expect.objectContaining({ generatedFrom: "documentation-service", specType: "capability" }),
        }),
        expect.objectContaining({ organizationId: mockOrgId }),
      );
    });

    it("aggregates selected changes into grouped draft release notes", async () => {
      (knowledgeService.listDocumentsByGeneratedFrom as Mock).mockResolvedValue([
        {
          id: 1,
          title: "change-1",
          summary: "Auth was added.",
          textContent: "+# Auth",
          createdAt: new Date("2026-07-15T10:00:00Z"),
          metadata: {
            documentKey: "auth",
            documentTitle: "Auth",
            specType: "module",
            kind: "addition",
            explanation: "Auth was added.",
            occurredAt: "2026-07-15T10:00:00Z",
            addedLines: 1,
            removedLines: 0,
          },
        },
      ]);
      (knowledgeService.createDocument as Mock).mockResolvedValue({ id: 55 });

      const release = await documentationService.createReleaseNotes(mockOrgId, {
        title: "July release",
        version: "1.2.0",
        changeIds: [1],
      });

      expect(release).toMatchObject({ id: 55, title: "July release", version: "1.2.0", status: "draft", changeIds: [1] });
      expect(release.markdown).toContain("## Additions");
      expect(knowledgeService.createDocument).toHaveBeenCalledWith(
        expect.objectContaining({
          textContent: expect.stringContaining("Auth was added."),
          metadata: expect.objectContaining({ generatedFrom: "documentation-release-notes", status: "draft", changeIds: [1] }),
        }),
        expect.objectContaining({ organizationId: mockOrgId }),
      );
    });

    it("rejects non-semantic release versions", async () => {
      (knowledgeService.listDocumentsByGeneratedFrom as Mock).mockResolvedValue([{
        id: 1,
        title: "change-1",
        summary: "Capability changed.",
        textContent: "+change",
        createdAt: new Date(),
        metadata: {
          generatedFrom: "documentation-change-register",
          documentKey: "capability:x",
          documentTitle: "Capability x",
          specType: "capability",
          kind: "change",
          explanation: "Capability changed.",
          occurredAt: new Date().toISOString(),
        },
      }]);

      await expect(documentationService.createReleaseNotes(mockOrgId, {
        title: "Invalid release",
        version: "July-final",
        changeIds: [1],
      })).rejects.toThrow(/semantic versioning/i);
    });
  });

  describe("searchSpecs", () => {
    it("returns SpecSearchResult matching query", async () => {
      const mockRow = {
        title: "Auth — Architecture Reference",
        summary: "Auth summary description",
        textContent: "Auth detail spec content text contains queries",
        metadata: { featureId: "auth" },
      };
      (knowledgeService.searchGeneratedSpecs as Mock).mockResolvedValue([mockRow]);

      const results = await documentationService.searchSpecs("queries", mockOrgId);

      expect(results).toHaveLength(1);
      expect(results[0].featureId).toBe("auth");
      expect(results[0].title).toBe(mockRow.title);
      expect(results[0].snippet).toContain("queries");
    });

    it("returns empty array when query is empty", async () => {
      const results = await documentationService.searchSpecs("", mockOrgId);
      expect(results).toEqual([]);
      expect(knowledgeService.searchGeneratedSpecs).not.toHaveBeenCalled();
    });
  });

  describe("getStatus", () => {
    it("returns correct count and age metrics derived from persisted documents", async () => {
      (documentationService as any).scanCache = [
        {
          id: "auth",
          name: "Auth",
          description: "Mock Auth",
          apis: [],
          dependencies: [],
          relatedResourceTypes: [],
          mcpTools: [],
          directory_path: "server/domain/auth",
          lastSourceModifiedMs: 100,
        },
        {
          id: "jobs",
          name: "Jobs",
          description: "Mock Jobs",
          apis: [],
          dependencies: [],
          relatedResourceTypes: [],
          mcpTools: [],
          directory_path: "server/domain/jobs",
          lastSourceModifiedMs: 100,
        },
      ];
      (documentationService as any).scanCachedAt = Date.now();

      // auth up-to-date, jobs missing
      const specMeta = new Map([
        [
          "Auth — Architecture Reference",
          {
            updatedAt: new Date(Date.now() - 5 * 86400000), // 5 days old
            fingerprint: "mock-fingerprint",
            summary: "Auth summary",
          },
        ],
      ]);
      (knowledgeService.getGeneratedSpecMeta as Mock).mockResolvedValue(specMeta);

      const status = await documentationService.getStatus(mockOrgId);

      expect(status.overall_status.total_documents).toBeGreaterThanOrEqual(2);
      expect(status.features.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("isRouteFile", () => {
  it("recognises singular and plural route files wherever they live", async () => {
    const { isRouteFile } = await import("../documentation.service.js");
    const { join } = await import("node:path");
    const p = (...parts: string[]) => join("server", "domain", ...parts);
    expect(isRouteFile(p("crew", "api", "crew.routes.ts"))).toBe(true);
    expect(isRouteFile(p("core", "notifications", "push.routes.ts"))).toBe(true);
    expect(isRouteFile(p("mission", "deliverables.route.ts"))).toBe(true);
    expect(isRouteFile(p("x", "routes", "anything.ts"))).toBe(true);
    expect(isRouteFile(p("core", "notifications", "push.service.ts"))).toBe(false);
    expect(isRouteFile(p("crew", "api", "crew.routes.test.ts"))).toBe(false);
  });
});


describe("public platform documentation boundary", () => {
  it("uses current platform facts without loading organization specs or knowledge", async () => {
    vi.clearAllMocks();
    const scan = vi.spyOn(documentationService, "getFeatures").mockResolvedValue([]);
    (fs.readFile as Mock).mockResolvedValue("# Pipelines\n\nCurrent guide from platform source.");
    (fs.stat as Mock).mockResolvedValue({mtimeMs: Date.parse("2026-10-22T00:00:00Z")});
    try {
      const doc = await documentationService.getPublicFeatureSpec("pipelines");
      expect(doc.markdown).toContain("Current guide from platform source");
      expect(scan).toHaveBeenCalledWith();
      expect(knowledgeService.getGeneratedSpecMeta).not.toHaveBeenCalled();
      expect(knowledgeService.getDocumentByTitle).not.toHaveBeenCalled();
      expect(knowledgeService.createDocument).not.toHaveBeenCalled();
      (fs.readFile as Mock).mockResolvedValue("# Pipelines\n\nChanged platform guide.");
      expect((await documentationService.getPublicFeatureSpec("pipelines")).markdown).toContain("Changed platform guide");
    } finally { scan.mockRestore(); }
  });
  it("rejects non-catalog identifiers before reading files or scanning", async () => {
    vi.clearAllMocks();
    await expect(documentationService.getPublicFeatureSpec("../../credentials")).rejects.toThrow("Unknown public feature guide");
    expect(fs.readFile).not.toHaveBeenCalled();
  });
});
