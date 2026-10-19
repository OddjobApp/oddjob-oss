
import { describe, it, expect, beforeEach, vi } from "vitest";
import { CycleManagerService } from "./cycle-manager.service.js";
import { db } from "@server/database_service.js";
import { operationalCycles, missionRuns, aiUsageLogs, orgs, missions, pipelineExecutions, pipelines, cycleBlueprints } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

let testOrgId: number;
let testMissionId1: number;
let testMissionId2: number;
let testPipelineId: number;

describe("CycleManagerService - Integration Tests", () => {
    
    beforeEach(async () => {
        // Setup mock prerequisites for foreign keys
        const [org] = await db.insert(orgs).values({ name: `Cycle Test Org ${Date.now()}-${Math.random()}` }).returning();
        testOrgId = org.id;

        const [m1, m2] = await db.insert(missions).values([
            { name: "Cycle Mission 1", organizationId: testOrgId, createdBy: "test", objective: "test", status: "active" },
            { name: "Cycle Mission 2", organizationId: testOrgId, createdBy: "test", objective: "test", status: "active" }
        ]).returning();
        testMissionId1 = m1.id;
        testMissionId2 = m2.id;
        
        const [pipeline] = await db.insert(pipelines).values({ name: "Cycle Pipeline", organizationId: testOrgId, triggerType: "manual", createdBy: "test" }).returning();
        testPipelineId = pipeline.id;
    });

    it("should launch a cycle and respect the initial state", async () => {
        const data = {
            name: "Test Cycle",
            objective: "Testing launch logic",
            requiresApproval: 0
        };
        const cycle = await CycleManagerService.launchCycle(data, "test-user", 1);
        
        expect(cycle.status).toBe("active");
        expect(cycle.name).toBe("Test Cycle");
    });

    it("should correctly calculate aggregate cycle spend", async () => {
        // Create cycle
        const [cycle] = await db.insert(operationalCycles).values({
            name: "Spend Test",
            objective: "Test spend aggregation",
            organizationId: testOrgId,
            createdBy: "test"
        }).returning();

        // Seed pipeline_executions FIRST and let the sequence assign the ids.
        //
        // These were hardcoded as 101 and 102 and inserted after the rows that
        // point at them. Against a shared test database that is a duplicate-key
        // failure the moment anything leaves those ids behind, and the ordering
        // meant the runs referenced executions that did not exist yet.
        const executions = await db.insert(pipelineExecutions).values([
            { pipelineId: testPipelineId, organizationId: testOrgId, status: "completed", createdBy: "test" },
            { pipelineId: testPipelineId, organizationId: testOrgId, status: "completed", createdBy: "test" }
        ]).returning();
        const [exec1, exec2] = executions;

        // Create mission runs
        const [run1] = await db.insert(missionRuns).values({
            name: "Run 1", 
            missionId: testMissionId1, 
            cycleId: cycle.id, 
            pipelineExecutionId: exec1.id,
            organizationId: testOrgId, 
            createdBy: "test" 
        }).returning();

        const [run2] = await db.insert(missionRuns).values({
            name: "Run 2", 
            missionId: testMissionId2, 
            cycleId: cycle.id, 
            pipelineExecutionId: exec2.id,
            organizationId: testOrgId, 
            createdBy: "test" 
        }).returning();

        // Seed ai_usage_logs to simulate forensic spend
        await db.insert(aiUsageLogs).values([
            { executionId: exec1.id, costUsd: "10.50", provider: "openai", model: "gpt-4", organizationId: testOrgId },
            { executionId: exec2.id, costUsd: "25.00", provider: "openai", model: "gpt-4", organizationId: testOrgId }
        ]);

        const totalSpend = await CycleManagerService.calculateCycleSpend(cycle.id);
        expect(totalSpend).toBe(35.50);
    });

    it("should terminate the program when success criteria are met", async () => {
        // Create cycle with success criteria
        const [cycle] = await db.insert(operationalCycles).values({
            name: "Success Test",
            objective: "Test termination",
            successCriteria: { stop_on: "finding_confirmed" },
            organizationId: testOrgId,
            createdBy: "test",
            status: "active"
        }).returning();

        // Create active mission runs
        const [run] = await db.insert(missionRuns).values({
            name: "Active Run",
            missionId: testMissionId1,
            cycleId: cycle.id,
            status: "active",
            organizationId: testOrgId,
            createdBy: "test"
        }).returning();

        // Evaluate signal
        await CycleManagerService.evaluateSuccessCriteria(cycle.id, {
            type: "finding_confirmed",
            confidence: 0.95,
            data: {}
        });

        // Check if cycle is closed (reviewing state after synthesis)
        const [updatedCycle] = await db.select().from(operationalCycles).where(eq(operationalCycles.id, cycle.id));
        expect(updatedCycle.status).toBe("reviewing");

        // Check if run is cancelled (fleet is terminated)
        const [updatedRun] = await db.select().from(missionRuns).where(eq(missionRuns.id, run.id));
        expect(updatedRun.status).toBe("cancelled");
    });

    it("should respect approval gates", async () => {
        const data = {
            name: "Secure Cycle",
            objective: "Testing approval gate",
            requiresApproval: 1
        };
        const cycle = await CycleManagerService.launchCycle(data, "test-user", testOrgId);

        expect(cycle.status).toBe("pending_approval");
    });
});


describe("CycleManagerService - Pipeline Mode YAML Parsing", () => {
    let testOrgId2: number;

    beforeEach(async () => {
        const [org] = await db.insert(orgs).values({ name: `Pipeline Test Org ${Date.now()}-${Math.random()}` }).returning();
        testOrgId2 = org.id;
    });

    it("should store pipeline_mode in cycle metadata when present in data", async () => {
        const data = {
            name: "Pipeline Cycle",
            objective: "Test pipeline mode passthrough",
            pipeline_mode: "code_generation",
            requiresApproval: 1, // pending_approval to avoid spawning missions
            blueprints: [
                { name: "requirements", objective: "Gather requirements" },
                { name: "design", objective: "Create design" },
            ],
        };

        const cycle = await CycleManagerService.launchCycle(data, "test-user", testOrgId2);

        expect(cycle.status).toBe("pending_approval");
        expect((cycle.metadata as any).pipeline_mode).toBe("code_generation");
    });

    it("should store artifact contracts from phase_artifacts into cycle_blueprints", async () => {
        const data = {
            name: "Artifact Contracts Cycle",
            objective: "Test phase_artifacts parsing",
            pipeline_mode: "code_generation",
            requiresApproval: 1, // pending_approval so we don't try to spawn
            phase_artifacts: {
                requirements: {
                    output_contract: {
                        schema_version: "1.0.0",
                        json_schema: {
                            type: "object",
                            required: ["prd"],
                            properties: { prd: { type: "object" } },
                        },
                    },
                },
                design: {
                    input_contract: { requires: ["requirements.prd"] },
                    output_contract: {
                        schema_version: "1.0.0",
                        json_schema: {
                            type: "object",
                            required: ["architecture"],
                            properties: { architecture: { type: "object" } },
                        },
                    },
                },
            },
            blueprints: [
                { name: "requirements", objective: "Gather requirements" },
                { name: "design", objective: "Create design" },
            ],
        };

        const cycle = await CycleManagerService.launchCycle(data, "test-user", testOrgId2);

        // Query the persisted blueprints
        const blueprints = await db
            .select()
            .from(cycleBlueprints)
            .where(eq(cycleBlueprints.cycleId, cycle.id));

        expect(blueprints).toHaveLength(2);

        const reqBp = blueprints.find((bp) => bp.name === "requirements");
        const designBp = blueprints.find((bp) => bp.name === "design");

        // Requirements blueprint should have its output_contract stored
        expect(reqBp?.artifactContracts).toBeTruthy();
        expect((reqBp?.artifactContracts as any).output_contract.schema_version).toBe("1.0.0");
        expect((reqBp?.artifactContracts as any).output_contract.json_schema.type).toBe("object");

        // Design blueprint should have both input_contract and output_contract
        expect(designBp?.artifactContracts).toBeTruthy();
        expect((designBp?.artifactContracts as any).input_contract.requires).toEqual(["requirements.prd"]);
        expect((designBp?.artifactContracts as any).output_contract.schema_version).toBe("1.0.0");
    });

    it("should set artifactContracts to null for blueprints not in phase_artifacts", async () => {
        const data = {
            name: "Partial Artifacts Cycle",
            objective: "Test missing phase mapping",
            pipeline_mode: "code_generation",
            requiresApproval: 1,
            phase_artifacts: {
                requirements: {
                    output_contract: {
                        schema_version: "1.0.0",
                        json_schema: { type: "object", properties: { prd: { type: "object" } } },
                    },
                },
            },
            blueprints: [
                { name: "requirements", objective: "Gather requirements" },
                { name: "implementation", objective: "Write code" },
            ],
        };

        const cycle = await CycleManagerService.launchCycle(data, "test-user", testOrgId2);

        const blueprints = await db
            .select()
            .from(cycleBlueprints)
            .where(eq(cycleBlueprints.cycleId, cycle.id));

        const implBp = blueprints.find((bp) => bp.name === "implementation");
        expect(implBp?.artifactContracts).toBeNull();
    });

    it("should reject invalid phase_artifacts with non-object json_schema", async () => {
        const data = {
            name: "Invalid Schema Cycle",
            objective: "Test validation",
            pipeline_mode: "code_generation",
            requiresApproval: 1,
            phase_artifacts: {
                requirements: {
                    output_contract: {
                        schema_version: "1.0.0",
                        json_schema: "not-an-object",
                    },
                },
            },
            blueprints: [{ name: "requirements", objective: "Gather requirements" }],
        };

        await expect(
            CycleManagerService.launchCycle(data, "test-user", testOrgId2)
        ).rejects.toThrow("json_schema must be a valid JSON Schema object");
    });

    it("should reject json_schema missing required schema keys", async () => {
        const data = {
            name: "Empty Schema Cycle",
            objective: "Test validation",
            pipeline_mode: "code_generation",
            requiresApproval: 1,
            phase_artifacts: {
                requirements: {
                    output_contract: {
                        schema_version: "1.0.0",
                        json_schema: { description: "just a description, no type/properties" },
                    },
                },
            },
            blueprints: [{ name: "requirements", objective: "Gather requirements" }],
        };

        await expect(
            CycleManagerService.launchCycle(data, "test-user", testOrgId2)
        ).rejects.toThrow("must contain at least one of: type, properties, $ref, anyOf, oneOf, allOf, enum");
    });

    it("should not modify metadata when pipeline_mode is absent", async () => {
        const data = {
            name: "Normal Cycle",
            objective: "No pipeline mode",
            requiresApproval: 1,
            metadata: { custom: "value" },
            blueprints: [{ name: "task1", objective: "Do something" }],
        };

        const cycle = await CycleManagerService.launchCycle(data, "test-user", testOrgId2);

        expect((cycle.metadata as any).pipeline_mode).toBeUndefined();
        expect((cycle.metadata as any).custom).toBe("value");
    });
});


describe("CycleManagerService.prepareExecutionPlan - denorm persistence", () => {
    let orgId: number;

    beforeEach(async () => {
        const [org] = await db.insert(orgs).values({ name: `Plan Test Org ${Date.now()}-${Math.random()}` }).returning();
        orgId = org.id;
    });

    // Regression: the batched raw-SQL CASE update rendered its SET targets as
    // "cycle_blueprints"."wave_index" (table-qualified), which Postgres rejects —
    // so the step silently threw and wave/critical-path denorm was never written.
    it("persists wave_index and on_critical_path for the whole chain without throwing", async () => {
        const [cycle] = await db.insert(operationalCycles).values({
            name: "Plan Chain Cycle",
            objective: "A -> B -> C",
            organizationId: orgId,
            createdBy: "test",
            status: "active",
        }).returning();

        // Persist the blueprint rows the denorm UPDATE matches by name.
        await db.insert(cycleBlueprints).values([
            { cycleId: cycle.id, name: "A", objective: "step A" },
            { cycleId: cycle.id, name: "B", objective: "step B" },
            { cycleId: cycle.id, name: "C", objective: "step C" },
        ]);

        // A -> B -> C finish-to-start chain: waves 0,1,2, all on the critical path.
        const blueprints = [
            { name: "A", dependsOn: [] as string[] },
            { name: "B", dependsOn: ["A"] },
            { name: "C", dependsOn: ["B"] },
        ];

        await CycleManagerService.prepareExecutionPlan(cycle.id, blueprints, cycle, orgId);

        const bps = await db.select().from(cycleBlueprints).where(eq(cycleBlueprints.cycleId, cycle.id));
        const byName = Object.fromEntries(bps.map((b) => [b.name, b]));

        // Denorm persisted (this is exactly what the SET-qualified-column bug lost).
        expect(byName["A"].waveIndex).toBe(0);
        expect(byName["B"].waveIndex).toBe(1);
        expect(byName["C"].waveIndex).toBe(2);
        expect(byName["A"].onCriticalPath).toBe(true);
        expect(byName["B"].onCriticalPath).toBe(true);
        expect(byName["C"].onCriticalPath).toBe(true);

        // executionPlan is written on the cycle too.
        const [updated] = await db.select().from(operationalCycles).where(eq(operationalCycles.id, cycle.id));
        const plan = updated.executionPlan as any;
        expect(plan?.criticalPath).toEqual(expect.arrayContaining(["A", "B", "C"]));
    });
});
