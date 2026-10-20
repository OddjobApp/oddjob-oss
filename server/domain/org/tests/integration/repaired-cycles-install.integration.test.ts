/**
 * Eight cycles could not be installed by Org Forge: installCycleApp validates every
 * manifest and threw on each of them.
 *
 * - Four were written as phases[].tasks[] rather than missions[].sequence[].
 * - Two had missions with no name, agent or trigger, listed their steps under
 *   `steps` (which the installer does not read), and had form fields keyed by `id`.
 * - Two were missing an integration key every manifest must declare.
 *
 * This installs each into a throwaway org and checks that what the file declares —
 * every mission with its pipeline and steps, and every form — is what gets built.
 * cycle-manifests-installable.test.ts keeps the whole directory valid without a
 * database; this proves the install itself.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { eq } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

configureTestEnvironment();

// Loaded after configureTestEnvironment(), so they can only reach the test database.
const { db } = await import("@server/database_service.js");
const { orgs } = await import("@shared/schema/auth.js");
const { orgForgeService } = await import("../../core/org-forge.service.js");

const REPAIRED = [
    "chaos-drill.cycle.yaml",
    "competitive-intelligence-strategy.cycle.yaml",
    "revenue-recognition.cycle.yaml",
    "software-audit.cycle.yaml",
    "incident-response.cycle.yaml",
    "self-harness-orchestrator.cycle.yaml",
    "signal-intelligence-workflows.cycle.yaml",
    "wayfare.cycle.yaml",
];

let orgId: number;

beforeAll(async () => {
    const [org] = await db.insert(orgs)
        .values({ name: `Repaired Cycles Install ${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
        .returning();
    orgId = org.id;
});

afterAll(async () => {
    if (orgId) await db.delete(orgs).where(eq(orgs.id, orgId)).catch(() => {});
});

describe("repaired cycles install through Org Forge", () => {
    for (const file of REPAIRED) {
        it(`installs ${file} with every mission, step and form it declares`, async () => {
            const yamlContent = fs.readFileSync(path.resolve("server/cycles", file), "utf8");
            const manifest: any = yaml.load(yamlContent);
            const missions = manifest.missions.length;
            const steps = manifest.missions.reduce((n: number, m: any) => n + (m.sequence?.length ?? 0), 0);

            const result: any = await orgForgeService.installCycleApp(orgId, yamlContent, { skipAppLaunch: true });

            expect(result.success).toBe(true);
            expect(result.cycleId).toBeTruthy();
            expect(steps).toBeGreaterThan(0);
            expect(result.missionsProvisioned).toBe(missions);
            expect(result.pipelinesProvisioned).toBe(missions);
            expect(result.pipelineStepsProvisioned).toBe(steps);
            expect(result.formsProvisioned).toBe(manifest.forms?.length ?? 0);
            expect(result.agentsProvisioned).toBeGreaterThan(0);
            expect(result.warnings.filter((w: string) => /dependency error/i.test(w))).toEqual([]);
        }, 120_000);
    }
});
