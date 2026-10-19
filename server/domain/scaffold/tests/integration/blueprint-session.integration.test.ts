import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { AssemblyBlueprintSchema, type AssemblyBlueprintInput } from "@shared/schema/assembly-blueprint.js";
import { requireTestDatabaseUrl } from "../../../../../tests/configure-test-environment.js";

/**
 * Blueprint sessions are server-owned and persisted, so this exercises the real
 * table. The point of the suite is the two properties a client-held state machine
 * could not provide:
 *
 *   1. prerequisites are enforced where they cannot be bypassed, and
 *   2. a session is reachable only from inside its own organization.
 */
describe("BlueprintStateService (persisted, org-scoped)", () => {
    const connectionString = requireTestDatabaseUrl();
    let pool: Pool;
    let service: any;
    let orgA: number;
    let orgB: number;

    const blueprintInput: AssemblyBlueprintInput = {
        id: "incident-cycle-bp",
        name: "Incident Response Cycle Blueprint",
        category: "operational_cycle",
        description: "Automated triage cycle with HIL approval gate",
        stages: [
            {
                id: "stage-db",
                name: "1. Database Schema",
                type: "scaffold_pack",
                provides: ["database"],
                podComponent: "ScaffoldPackPod",
                completionCriteria: { type: "pack_selected" },
            },
            {
                id: "stage-pipeline",
                name: "2. Trigger Pipeline",
                type: "pipeline",
                requires: ["stage-db"],
                podComponent: "PipelineBuilderPod",
                completionCriteria: { type: "pipeline_valid" },
            },
        ],
    };
    const blueprint = AssemblyBlueprintSchema.parse(blueprintInput);

    beforeAll(async () => {
        pool = new Pool({ connectionString });

        // The migration must have been applied (npm run test:db:setup). Fail loudly
        // rather than letting every case error one at a time.
        const { rows } = await pool.query(
            `SELECT to_regclass('public.blueprint_sessions') AS t`
        );
        if (!rows[0]?.t) {
            throw new Error(
                "blueprint_sessions table is missing from the test database — run `npm run test:db:setup`."
            );
        }

        const mk = async (name: string) => {
            const r = await pool.query(
                `INSERT INTO orgs (name) VALUES ($1)
                 ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
                 RETURNING org_id`,
                [name]
            );
            return r.rows[0].org_id as number;
        };
        orgA = await mk("bp-session-test-org-a");
        orgB = await mk("bp-session-test-org-b");

        ({ blueprintStateService: service } = await import("../../blueprint-state.service.js"));
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM blueprint_sessions WHERE org_id = ANY($1::int[])`, [[orgA, orgB]]);
        await pool.end();
    });

    it("persists a new session with the first stage active and zero progress", async () => {
        const id = `sess-${Date.now()}-init`;
        const summary = await service.createSession(id, blueprint, orgA);

        expect(summary.id).toBe(id);
        expect(summary.progressPercent).toBe(0);
        expect(summary.totalStages).toBe(2);
        expect(summary.activeStage?.id).toBe("stage-db");
        expect(summary.isAssemblyReady).toBe(false);

        // It is actually in the table, not just in a Map.
        const { rows } = await pool.query(`SELECT org_id FROM blueprint_sessions WHERE id = $1`, [id]);
        expect(rows).toHaveLength(1);
        expect(rows[0].org_id).toBe(orgA);
    });

    it("refuses a stage whose prerequisites are unmet", async () => {
        const id = `sess-${Date.now()}-prereq`;
        await service.createSession(id, blueprint, orgA);

        await expect(
            service.submitStageCompletion(id, "stage-pipeline", { trigger: "webhook" }, orgA)
        ).rejects.toThrow(/Missing prerequisites: stage-db/);
    });

    it("advances to completion and survives being re-read from the database", async () => {
        const id = `sess-${Date.now()}-advance`;
        await service.createSession(id, blueprint, orgA);

        const afterDb = await service.submitStageCompletion(id, "stage-db", { engine: "postgres" }, orgA);
        expect(afterDb.verifiedCount).toBe(1);
        expect(afterDb.activeStage?.id).toBe("stage-pipeline");
        expect(afterDb.isAssemblyReady).toBe(false);

        const done = await service.submitStageCompletion(id, "stage-pipeline", { trigger: "webhook" }, orgA);
        expect(done.progressPercent).toBe(100);
        expect(done.isAssemblyReady).toBe(true);

        // Re-read: recorded outputs are durable, which is the whole point of moving
        // ownership to the server.
        const reread = await service.getSessionSummary(id, orgA);
        expect(reread.verifiedStageIds.sort()).toEqual(["stage-db", "stage-pipeline"]);
        expect(reread.stageConfigs).toMatchObject({
            "stage-db": { engine: "postgres" },
            "stage-pipeline": { trigger: "webhook" },
        });
    });

    it("does not expose a session to another organization", async () => {
        const id = `sess-${Date.now()}-tenant`;
        await service.createSession(id, blueprint, orgA);

        // Reads as absent, not forbidden — the endpoint must not confirm it exists.
        expect(await service.getSession(id, orgB)).toBeUndefined();
        await expect(service.getSessionSummary(id, orgB)).rejects.toThrow(/not found/i);

        // And it cannot be advanced from outside its org either.
        await expect(
            service.submitStageCompletion(id, "stage-db", { engine: "postgres" }, orgB)
        ).rejects.toThrow(/not found/i);

        // The real owner is unaffected.
        const owner = await service.getSessionSummary(id, orgA);
        expect(owner.verifiedCount).toBe(0);
    });
});
