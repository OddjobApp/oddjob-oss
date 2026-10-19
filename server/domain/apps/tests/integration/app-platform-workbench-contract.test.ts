import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";

const { dbMock, datasetServiceMock, missionServiceMock, selectResults } = vi.hoisted(() => {
  const selectResults: unknown[][] = [];

  function makeSelectChain() {
    const consume = vi.fn(async () => selectResults.shift() ?? []);
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: consume,
      limit: consume,
    };
    return chain;
  }

  return {
    selectResults,
    dbMock: {
      select: vi.fn(() => makeSelectChain()),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
    },
    datasetServiceMock: {
      getItems: vi.fn(),
    },
    missionServiceMock: {
      launchMission: vi.fn(),
    },
  };
});

vi.mock("@server/database_service.js", () => ({ db: dbMock }));
vi.mock("@domain/knowledge/core/dataset-service.js", () => ({ datasetService: datasetServiceMock }));
vi.mock("@domain/mission/core/mission.service.js", () => ({ missionService: missionServiceMock }));
vi.mock("@server/utils/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("@domain/diagnostics/core/error-diagnosis.engine.js", () => ({
  errorDiagnosisEngine: { diagnose: vi.fn(async () => undefined) },
}));

vi.mock("../../infrastructure/app-token.service.js", () => ({
  requireAppToken: (capability?: string) => (req: any, res: any, next: any) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "App deployment token required" });
    }
    if (auth === "Bearer token-without-missions" && capability === "missions") {
      return res.status(403).json({ error: "Token does not grant 'missions' capability" });
    }
    req.appTokenContext = {
      deploymentId: 77,
      appId: 501,
      orgId: 291,
      capabilities: ["datasets", "missions"],
    };
    next();
  },
}));

import { appsPlatformRouter } from "../../platform/index.js";
import { errorHandler } from "../../../../middleware/error-handler.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/platform/app", appsPlatformRouter);
  app.use(errorHandler);
  return app;
}

describe("App platform workbench route contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectResults.length = 0;
  });

  it("serves collection records at the backend path generated workbench proxies target", async () => {
    selectResults.push([
      {
        recordId: "lead-1",
        data: { company: "Acme", stage: "qualified" },
        createdAt: "2026-07-03T12:00:00.000Z",
        updatedAt: "2026-07-03T12:30:00.000Z",
      },
    ]);

    const res = await request(makeApp())
      .get("/api/platform/app/datasets")
      .query({ collection: "leads" })
      .set("Authorization", "Bearer generated-workbench-token")
      .expect(200);

    expect(res.body).toEqual([
      {
        id: "lead-1",
        company: "Acme",
        stage: "qualified",
        // The controller writes `id` first and then spreads the record's own data over
        // it, so a record carrying its own `id` shadows the storage key. `_recordId`
        // is what always holds it, which is why an update can still find the row.
        _recordId: "lead-1",
        _createdAt: "2026-07-03T12:00:00.000Z",
        _updatedAt: "2026-07-03T12:30:00.000Z",
      },
    ]);
  });

  it("queries allowed platform datasets with the shape used by generated workbench apps", async () => {
    selectResults.push([{ allowedDatasetIds: [42] }]);
    datasetServiceMock.getItems.mockResolvedValueOnce({
      items: [{ id: "case-1", title: "Route regression" }],
      total: 1,
    });

    const res = await request(makeApp())
      .post("/api/platform/app/datasets/platform/42/query")
      .set("Authorization", "Bearer generated-workbench-token")
      .send({
        filter: { field: "status", value: "open" },
        sortBy: "createdAt",
        sortOrder: "asc",
        limit: 500,
        offset: 2,
      })
      .expect(200);

    expect(res.body).toEqual({
      items: [{ id: "case-1", title: "Route regression" }],
      total: 1,
    });
    expect(datasetServiceMock.getItems).toHaveBeenCalledWith(
      42,
      { organizationId: 291, userId: "system" },
      {
        filter: { field: "status", value: "open" },
        sortBy: "createdAt",
        sortOrder: "asc",
        limit: 200,
        offset: 2,
      },
    );
  });

  it("launches missions from the generated workbench trigger endpoint", async () => {
    selectResults.push([
      {
        id: 123,
        name: "Qualify Lead",
        workflowBlueprint: {},
        blackboard: {},
      },
    ]);
    missionServiceMock.launchMission.mockResolvedValueOnce({ success: true, missionRunId: 9001 });

    const res = await request(makeApp())
      .post("/api/platform/app/missions/trigger")
      .set("Authorization", "Bearer generated-workbench-token")
      .send({ name: "Qualify Lead", context: { source: "sales-opportunity-workbench" } })
      .expect(200);

    expect(res.body).toEqual({
      runId: 9001,
      status: "launched",
      missionId: 123,
      missionName: "Qualify Lead",
    });
    expect(missionServiceMock.launchMission).toHaveBeenCalledWith(
      123,
      "app-deployment:77",
      291,
      undefined,
      { name: "Qualify Lead", context: { source: "sales-opportunity-workbench" } },
    );
  });

  it("returns a client-readable failure when required dataset query parameters are missing", async () => {
    const res = await request(makeApp())
      .get("/api/platform/app/datasets")
      .set("Authorization", "Bearer generated-workbench-token")
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain("'collection' query parameter is required");
  });

  it("returns a client-readable failure when mission trigger payloads omit name", async () => {
    const res = await request(makeApp())
      .post("/api/platform/app/missions/trigger")
      .set("Authorization", "Bearer generated-workbench-token")
      .send({ context: { source: "workbench" } })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain("'name' is required");
    expect(missionServiceMock.launchMission).not.toHaveBeenCalled();
  });

  it("keeps generated workbench clients and proxies aligned with the registered platform routes", () => {
    const root = path.resolve("server/blueprints/apps");
    const clientFiles = [
      "sales-opportunity-workbench/lib/platform-client.ts",
      "pm-workbench/lib/platform-client.ts",
      "qa-workbench/lib/platform-client.ts",
    ];
    const proxyFiles = [
      "sales-opportunity-workbench/app/api/oddjob/[...path]/route.ts",
      "sdlc-workbench/app/api/oddjob/[...path]/route.ts",
      "pm-workbench/pages/api/oddjob/[...path].ts",
    ];

    clientFiles.forEach((file) => {
      const source = fs.readFileSync(path.join(root, file), "utf-8");
      expect(source, `${file} should call the same-origin workbench proxy`).toContain("/api/oddjob");
      expect(source, `${file} should call dataset collection routes`).toContain("/datasets");
      expect(source, `${file} should call mission trigger routes`).toContain("/missions/trigger");
    });

    const platformDatasetClients = clientFiles.filter((file) =>
      fs.readFileSync(path.join(root, file), "utf-8").includes("/datasets/platform/"),
    );
    expect(platformDatasetClients.length).toBeGreaterThan(0);

    proxyFiles.forEach((file) => {
      const source = fs.readFileSync(path.join(root, file), "utf-8");
      expect(source, `${file} should forward generated /api/oddjob calls to the app-token gateway`).toContain(
        "/api/platform/app",
      );
      expect(source, `${file} should attach the app deployment token`).toContain("ODDJOB_APP_TOKEN");
    });
  });
});
