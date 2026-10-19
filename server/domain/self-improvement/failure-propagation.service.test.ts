import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { failurePropagationService, type FailureObservation } from "./failure-propagation.service.js";
import { SystemGraphService } from "./system-graph.service.js";

/**
 * Runs the real service against a synthetic source tree plus an injected
 * failure history, so the blending model is exercised without a database.
 */

let repoRoot: string;

async function write(relPath: string, content: string) {
  const full = path.join(repoRoot, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf-8");
}

const SOURCE = "server/domain/core/hub.service.ts";
const DIRECT = "server/domain/feature/direct.service.ts";
const SECOND = "server/domain/feature/second.service.ts";
const UNRELATED = "server/domain/other/unrelated.service.ts";

beforeAll(async () => {
  repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "failprop-"));

  await write(SOURCE, "export const hub = {};\n");
  // direct imports hub; second imports direct → 2 hops from hub.
  await write(DIRECT, 'import { hub } from "@domain/core/hub.service.js";\nexport const d = hub;\n');
  await write(SECOND, 'import { d } from "./direct.service.js";\nexport const s = d;\n');
  // Shares no dependency path with hub at all.
  await write(UNRELATED, "export const u = 1;\n");

  SystemGraphService.invalidateCache();
});

afterAll(async () => {
  await fs.rm(repoRoot, { recursive: true, force: true });
  SystemGraphService.invalidateCache();
});

const at = (minutes: number): Date => new Date(Date.UTC(2026, 0, 1, 0, minutes));

const noFailures = async (): Promise<FailureObservation[]> => [];

describe("failurePropagationService.predictPropagation", () => {
  describe("with no failure history", () => {
    it("falls back to a purely structural forecast", async () => {
      const forecast = await failurePropagationService.predictPropagation(SOURCE, {
        repoRoot,
        loadFailures: noFailures,
      });

      expect(forecast.basis.structuralOnly).toBe(true);
      expect(forecast.basis.empiricalWeight).toBe(0);
      expect(forecast.predictions.length).toBeGreaterThan(0);
      // With zero evidence, probability must equal the structural score.
      for (const p of forecast.predictions) {
        expect(p.probability).toBeCloseTo(p.structuralScore, 5);
      }
    });

    it("ranks a direct dependent above a transitive one", async () => {
      const forecast = await failurePropagationService.predictPropagation(SOURCE, {
        repoRoot,
        loadFailures: noFailures,
      });

      const direct = forecast.predictions.find(p => p.filePath === DIRECT);
      const second = forecast.predictions.find(p => p.filePath === SECOND);

      expect(direct).toBeDefined();
      expect(second).toBeDefined();
      expect(direct!.distance).toBe(1);
      expect(second!.distance).toBe(2);
      expect(direct!.probability).toBeGreaterThan(second!.probability);
    });

    it("excludes files with no dependency path and no co-failures", async () => {
      const forecast = await failurePropagationService.predictPropagation(SOURCE, {
        repoRoot,
        loadFailures: noFailures,
      });

      expect(forecast.predictions.some(p => p.filePath === UNRELATED)).toBe(false);
    });
  });

  describe("evidence weighting", () => {
    it("barely shifts the forecast on a single coincidental co-failure", async () => {
      const forecast = await failurePropagationService.predictPropagation(SOURCE, {
        repoRoot,
        loadFailures: async () => [
          { filePath: SOURCE, occurredAt: at(0) },
          { filePath: UNRELATED, occurredAt: at(1) },
        ],
      });

      const direct = forecast.predictions.find(p => p.filePath === DIRECT)!;
      const unrelated = forecast.predictions.find(p => p.filePath === UNRELATED)!;

      // One observation must not let a coincidence outrank a real edge.
      expect(direct.probability).toBeGreaterThan(unrelated.probability);
      expect(forecast.basis.empiricalWeight).toBeLessThan(0.2);
    });

    it("lets sustained co-failure outrank structure once evidence accumulates", async () => {
      const failures: FailureObservation[] = [];
      // 20 source failures, each accompanied by UNRELATED and never by DIRECT.
      for (let i = 0; i < 20; i++) {
        failures.push({ filePath: SOURCE, occurredAt: at(i * 120) });
        failures.push({ filePath: UNRELATED, occurredAt: at(i * 120 + 1) });
      }

      const forecast = await failurePropagationService.predictPropagation(SOURCE, {
        repoRoot,
        loadFailures: async () => failures,
      });

      const direct = forecast.predictions.find(p => p.filePath === DIRECT)!;
      const unrelated = forecast.predictions.find(p => p.filePath === UNRELATED)!;

      expect(forecast.basis.empiricalWeight).toBeGreaterThan(0.75);
      expect(unrelated.probability).toBeGreaterThan(direct.probability);
      expect(unrelated.historicalScore).toBeCloseTo(1, 2);
    });
  });

  describe("hidden coupling", () => {
    it("surfaces a co-failing file that has no dependency path", async () => {
      const failures: FailureObservation[] = [];
      for (let i = 0; i < 10; i++) {
        failures.push({ filePath: SOURCE, occurredAt: at(i * 120) });
        failures.push({ filePath: UNRELATED, occurredAt: at(i * 120 + 2) });
      }

      const forecast = await failurePropagationService.predictPropagation(SOURCE, {
        repoRoot,
        loadFailures: async () => failures,
      });

      const unrelated = forecast.predictions.find(p => p.filePath === UNRELATED)!;
      expect(unrelated).toBeDefined();
      expect(unrelated.distance).toBeNull();
      expect(unrelated.structuralScore).toBe(0);
      expect(unrelated.rationale).toContain("no dependency path");
    });
  });

  describe("co-failure windowing", () => {
    it("ignores failures outside the correlation window", async () => {
      const forecast = await failurePropagationService.predictPropagation(SOURCE, {
        repoRoot,
        coFailureWindowMinutes: 5,
        loadFailures: async () => [
          { filePath: SOURCE, occurredAt: at(0) },
          // 60 minutes later — well outside a 5 minute window.
          { filePath: UNRELATED, occurredAt: at(60) },
        ],
      });

      expect(forecast.predictions.some(p => p.filePath === UNRELATED)).toBe(false);
    });

    it("counts a repeatedly-retrying file only once per source failure", async () => {
      const forecast = await failurePropagationService.predictPropagation(SOURCE, {
        repoRoot,
        loadFailures: async () => [
          { filePath: SOURCE, occurredAt: at(0) },
          // A retry storm in one file must not look like sustained coupling.
          { filePath: UNRELATED, occurredAt: at(1) },
          { filePath: UNRELATED, occurredAt: at(2) },
          { filePath: UNRELATED, occurredAt: at(3) },
          { filePath: UNRELATED, occurredAt: at(4) },
        ],
      });

      const unrelated = forecast.predictions.find(p => p.filePath === UNRELATED)!;
      expect(unrelated.coFailureCount).toBe(1);
      expect(unrelated.historicalScore).toBeLessThanOrEqual(1);
    });
  });

  describe("robustness", () => {
    it("degrades to structural when the failure source throws", async () => {
      const forecast = await failurePropagationService.predictPropagation(SOURCE, {
        repoRoot,
        loadFailures: async () => {
          throw new Error("database unavailable");
        },
      });

      // An unavailable history must not fail the forecast.
      expect(forecast.basis.structuralOnly).toBe(true);
      expect(forecast.predictions.some(p => p.filePath === DIRECT)).toBe(true);
    });

    it("returns an empty forecast for an unknown file rather than throwing", async () => {
      const forecast = await failurePropagationService.predictPropagation(
        "server/does/not/exist.ts",
        { repoRoot, loadFailures: noFailures },
      );

      expect(forecast.predictions).toEqual([]);
    });

    it("normalizes windows-separated source paths", async () => {
      const forecast = await failurePropagationService.predictPropagation(
        SOURCE.replace(/\//g, "\\"),
        { repoRoot, loadFailures: noFailures },
      );

      expect(forecast.sourceFile).toBe(SOURCE);
      expect(forecast.predictions.some(p => p.filePath === DIRECT)).toBe(true);
    });
  });
});
