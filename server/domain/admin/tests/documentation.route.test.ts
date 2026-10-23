/**
 * Documentation API — route tests.
 * Mounting the real router with supertest; services and auth are mocked to exercise the HTTP contract.
 *
 * @vitest-environment node
 */
import express from "express";
import request from "supertest";
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  getStatus: vi.fn(),
  getFeatures: vi.fn(),
  getUiSpec: vi.fn(),
  getApiSpec: vi.fn(),
  generateUiSpec: vi.fn(),
  generateApiSpec: vi.fn(),
  searchSpecs: vi.fn(),
  getFeatureSpec: vi.fn(),
  generateForFeature: vi.fn(),
  generateAll: vi.fn(),
  getChangeRegister: vi.fn(),
  getReleaseNotes: vi.fn(),
  createReleaseNotes: vi.fn(),
  updateReleaseNotes: vi.fn(),
  publishReleaseNotes: vi.fn(),
  org: { organizationId: 1, userId: "u1" } as { organizationId: number | null; userId: string },
}));

vi.mock("../documentation.service.js", () => ({
  documentationService: {
    getStatus: h.getStatus,
    getFeatures: h.getFeatures,
    getUiSpec: h.getUiSpec,
    getApiSpec: h.getApiSpec,
    generateUiSpec: h.generateUiSpec,
    generateApiSpec: h.generateApiSpec,
    searchSpecs: h.searchSpecs,
    getFeatureSpec: h.getFeatureSpec,
    generateForFeature: h.generateForFeature,
    generateAll: h.generateAll,
    getChangeRegister: h.getChangeRegister,
    getReleaseNotes: h.getReleaseNotes,
    createReleaseNotes: h.createReleaseNotes,
    updateReleaseNotes: h.updateReleaseNotes,
    publishReleaseNotes: h.publishReleaseNotes,
  },
}));

vi.mock("@domain/auth/core/security.service.js", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../auth/core/security.service.js", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@server/utils/auth-context.js", () => ({
  getUserOrgContext: vi.fn(async () => h.org),
  assertOrgId: vi.fn((id) => id ?? 1),
}));

vi.mock("../../../utils/auth-context.js", () => ({
  getUserOrgContext: vi.fn(async () => h.org),
  assertOrgId: vi.fn((id) => id ?? 1),
}));

vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import router from "../documentation.route.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/documentation", router);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode ?? err.status ?? 500).json({ error: err.message });
  });
  return app;
}

const app = makeApp();

describe("Documentation Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.org = { organizationId: 1, userId: "u1" };
  });

  describe("GET /status", () => {
    it("returns status payload (200)", async () => {
      const mockStatus = { overall_status: { total_documents: 10 } };
      h.getStatus.mockResolvedValue(mockStatus);

      const res = await request(app).get("/api/documentation/status");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockStatus);
      expect(h.getStatus).toHaveBeenCalledWith(1);
    });
  });

  describe("GET /features", () => {
    it("returns features list (200)", async () => {
      const mockFeatures = [{ id: "auth", name: "Auth" }];
      h.getFeatures.mockResolvedValue(mockFeatures);

      const res = await request(app).get("/api/documentation/features");

      expect(res.status).toBe(200);
      expect(res.body.features).toEqual(mockFeatures);
      expect(h.getFeatures).toHaveBeenCalledWith(1);
    });
  });

  describe("GET /specs/:specType", () => {
    it("returns ui spec when specType is ui", async () => {
      const mockSpec = { title: "UI Spec" };
      h.getUiSpec.mockResolvedValue(mockSpec);

      const res = await request(app).get("/api/documentation/specs/ui");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockSpec);
      expect(h.getUiSpec).toHaveBeenCalledWith(1);
    });

    it("returns api spec when specType is api", async () => {
      const mockSpec = { title: "API Spec" };
      h.getApiSpec.mockResolvedValue(mockSpec);

      const res = await request(app).get("/api/documentation/specs/api");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockSpec);
      expect(h.getApiSpec).toHaveBeenCalledWith(1);
    });

    it("returns 400 for unknown specType", async () => {
      const res = await request(app).get("/api/documentation/specs/invalid");
      expect(res.status).toBe(400);
    });
  });

  describe("GET /search", () => {
    it("returns search results (200)", async () => {
      const mockResults = [{ featureId: "auth", snippet: "found" }];
      h.searchSpecs.mockResolvedValue(mockResults);

      const res = await request(app).get("/api/documentation/search?q=query");

      expect(res.status).toBe(200);
      expect(res.body.results).toEqual(mockResults);
      expect(h.searchSpecs).toHaveBeenCalledWith("query", 1);
    });
  });

  describe("GET /features/:featureId/spec", () => {
    it("returns spec for a valid feature id (200)", async () => {
      const mockSpec = { featureId: "auth", markdown: "# Auth" };
      h.getFeatureSpec.mockResolvedValue(mockSpec);

      const res = await request(app).get("/api/documentation/features/auth/spec");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockSpec);
      expect(h.getFeatureSpec).toHaveBeenCalledWith("auth", 1);
    });

    it("returns 400 for invalid feature id", async () => {
      const res = await request(app).get("/api/documentation/features/invalid@id/spec");
      expect(res.status).toBe(400);
    });
  });

  describe("POST /generate/:featureId", () => {
    it("calls generateForFeature and returns success (200)", async () => {
      h.generateForFeature.mockResolvedValue(true);

      const res = await request(app).post("/api/documentation/generate/auth");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(h.generateForFeature).toHaveBeenCalledWith("auth", 1);
    });
  });

  describe("change register and release notes", () => {
    it("returns the dated change register", async () => {
      h.getChangeRegister.mockResolvedValue([{ id: 7, kind: "change" }]);
      const res = await request(app).get("/api/documentation/changes");
      expect(res.status).toBe(200);
      expect(res.body.changes).toEqual([{ id: 7, kind: "change" }]);
      expect(h.getChangeRegister).toHaveBeenCalledWith(1);
    });

    it("creates release notes from selected changes", async () => {
      h.createReleaseNotes.mockResolvedValue({ id: 9, title: "July release", status: "draft" });
      const res = await request(app).post("/api/documentation/releases").send({
        title: "July release",
        version: "1.2.0",
        changeIds: [7, 8],
        hideAddedFromRegister: false,
      });
      expect(res.status).toBe(201);
      expect(h.createReleaseNotes).toHaveBeenCalledWith(1, {
        title: "July release",
        version: "1.2.0",
        changeIds: [7, 8],
        hideAddedFromRegister: false,
      });
    });

    it("blocks public summaries from non-platform administrators", async () => {
      const res = await request(app).post('/api/documentation/releases/9/publish').send({publicSummary:'Visible to everyone'});
      expect(res.status).toBe(403);expect(h.publishReleaseNotes).not.toHaveBeenCalled();
    });
    it("publishes a release", async () => {
      h.publishReleaseNotes.mockResolvedValue({ id: 9, status: "published" });
      const res = await request(app).post("/api/documentation/releases/9/publish");
      expect(res.status).toBe(200);
      expect(h.publishReleaseNotes).toHaveBeenCalledWith(9, 1, undefined);
    });

    it("updates a draft from selected register changes", async () => {
      h.updateReleaseNotes.mockResolvedValue({ id: 9, title: "Updated July release", status: "draft", changeIds: [7] });
      const res = await request(app).patch("/api/documentation/releases/9").send({
        title: "Updated July release",
        version: "1.2.1",
        changeIds: [7],
        hideAddedFromRegister: false,
      });
      expect(res.status).toBe(200);
      expect(h.updateReleaseNotes).toHaveBeenCalledWith(9, 1, {
        title: "Updated July release",
        version: "1.2.1",
        changeIds: [7],
        hideAddedFromRegister: false,
      });
    });
  });
});
