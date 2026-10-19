import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

vi.mock("@server/database_service.js", () => ({ db: {} }));
vi.mock("@domain/knowledge/core/dataset-service.js", () => ({ datasetService: {} }));
vi.mock("../apps-platform.helpers.js", () => ({ resolveOrgAppIdBySlug: vi.fn() }));

import { surfaceAdapters } from "@shared/crew-surface-connections";
import { IMMUTABLE_DECISION_COLLECTIONS } from "./datasets.controller";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const BLUEPRINTS_DIR = path.join(REPO_ROOT, "server", "blueprints", "apps");
const CYCLES_DIR = path.join(REPO_ROOT, "server", "cycles");

describe("Blueprint <-> CREW production contract gate", () => {
  it("enforces requireLaunchedMission in every blueprint platform-client that triggers missions", () => {
    const entries = fs.readdirSync(BLUEPRINTS_DIR, { withFileTypes: true });
    const checked: string[] = [];
    const violations: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const clientPath = path.join(BLUEPRINTS_DIR, entry.name, "lib", "platform-client.ts");
      if (!fs.existsSync(clientPath)) continue;

      const source = fs.readFileSync(clientPath, "utf-8");
      if (source.includes("/missions/trigger")) {
        checked.push(entry.name);
        if (!source.includes("requireLaunchedMission")) {
          violations.push(`${entry.name}: calls /missions/trigger without requireLaunchedMission`);
        }
      }
    }

    expect(checked.length).toBeGreaterThanOrEqual(12);
    expect(violations).toEqual([]);
  });

  it("ensures every blueprint with a platform-client has a matching /api/oddjob proxy route", () => {
    const entries = fs.readdirSync(BLUEPRINTS_DIR, { withFileTypes: true });
    const missingProxy: string[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const clientPath = path.join(BLUEPRINTS_DIR, entry.name, "lib", "platform-client.ts");
      if (!fs.existsSync(clientPath)) continue;

      const pagesProxy = path.join(BLUEPRINTS_DIR, entry.name, "pages", "api", "oddjob", "[...path].ts");
      const appProxy = path.join(BLUEPRINTS_DIR, entry.name, "app", "api", "oddjob", "[...path]", "route.ts");
      if (!fs.existsSync(pagesProxy) && !fs.existsSync(appProxy)) {
        missingProxy.push(entry.name);
      }
    }

    expect(missingProxy).toEqual([]);
  });

  it("verifies cycle YAML app references resolve CREW surface adapter contracts", () => {
    const yamlFiles = fs.readdirSync(CYCLES_DIR).filter((f) => f.endsWith(".cycle.yaml"));
    expect(yamlFiles.length).toBeGreaterThan(5);

    for (const file of yamlFiles) {
      const doc = yaml.load(fs.readFileSync(path.join(CYCLES_DIR, file), "utf-8")) as any;
      for (const app of doc?.apps ?? []) {
        const bp = app.blueprint || app.id;
        if (!bp) continue;
        const adapters = surfaceAdapters(
          { title: app.name || bp, blueprint: bp, path: `/app/${app.slug || bp}` },
          app
        );
        expect(adapters, `surfaceAdapters returned null for ${bp} in ${file}`).not.toBeNull();
      }
    }
  });

  it("protects governed decision and signoff collections from in-place mutation", () => {
    expect(IMMUTABLE_DECISION_COLLECTIONS).toEqual(
      expect.arrayContaining([
        "qa_workbench_quality_gates",
        "stakeholder_workbench_uat_signoffs",
        "stakeholder_workbench_cab_approvals",
        "training_signoffs",
        "deployment_log",
      ])
    );
  });
});
