import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@server/core/pipeline-step-runner.js", () => ({
    executePipelineStep: vi.fn().mockImplementation(async (step: any) => {
        console.log(`[Test Mock] Executing Step: ${step.order} (${step.outputName})`);
        return {
            success: true,
            output: JSON.stringify({ 
                mission_summary: "Automated test research summary",
                final_product: "Automated test report content" 
            }),
            status: "success"
        };
    })
}));

vi.mock("@domain/mission/core/mission.service.js", async (importOriginal: any) => {
    const actual = await importOriginal();
    return {
        ...actual,
        missionService: {
            ...actual.missionService,
            planMission: vi.fn().mockResolvedValue({
                blueprint: {
                    name: "Automated Evaluation Mission",
                    description: "Test mission for deliverable extraction",
                    workflow: {
                        nodes: [
                            { id: "researcher", type: "agent", role: "Researcher", suggestedConfig: {} }
                        ],
                        edges: []
                    }
                },
                explanation: "Mocked explanation for test."
            })
        }
    };
});
import { missionService } from "@domain/mission/core/mission.service.js";
import { missionRunService } from "@domain/mission/core/mission-run.service.js";
import { db } from "@server/database_service.js";
import { jobs, pipelines, pipelineSteps, missionRuns } from "@shared/schema/index.js";
import { eq, sql, ilike, and } from "drizzle-orm";
import { jobSynthesisService } from "@server/domain/jobs/job-synthesis.service.js";
import { MissionCheckpointHook } from "@server/domain/pipeline/hooks/mission-checkpoint-hook.js";

describe("AI Evaluation: Mission Reports Deliverables", () => {
    const testOrgId = 1;
    const testUserId = "test-user";

    beforeEach(async () => {
        console.log("[Test] Mocking jobSynthesisService...");
        jobSynthesisService.synthesizeJob = async (role: string, organizationId: number, userId: string) => {
            const [job] = await db.insert(jobs).values({
                name: role,
                description: "Mocked",
                type: "ai_agent",
                tool: "Mock",
                config: {},
                organizationId,
                createdBy: userId,
                lifecycleStatus: "active"
            }).returning();
            return job;
        };

        console.log("[Test] Cleaning up old data...");
        // Cleanup with direct SQL to be faster and more thorough
        await db.execute(sql`DELETE FROM mission_runs WHERE name LIKE 'Weather Report Mission TEST_%'`);
        await db.execute(sql`DELETE FROM pipelines WHERE name LIKE 'Workstream: TEST_%'`);
        await db.execute(sql`DELETE FROM jobs WHERE name LIKE 'Researcher_TEST_%' OR name LIKE 'Writer_TEST_%'`);
    });

    it.skip("should produce a mission deliverable for a pre-planned mission", async () => {
        console.log("[Test] Starting test case...");
        const uniqueId = Math.random().toString(36).substring(2, 10);
        const plan = {
            name: `Weather Report Mission TEST_${uniqueId}`,
            objective: "Research the current weather in Tokyo and write a report [Target Product: weather_report]",
            executionStrategy: "pre_planned",
            members: [],
            workflow: {
                nodes: [
                    { id: "n1", type: "agent", role: `Researcher_TEST_${uniqueId}`, suggestedConfig: { goal: "Find weather in Tokyo" } },
                    { id: "n2", type: "agent", role: `Writer_TEST_${uniqueId}`, suggestedConfig: { goal: "Write the report" } }
                ],
                edges: [
                    { from: "n1", to: "n2" }
                ]
            }
        };

        console.log("[Test] Creating mission context...");
        const mission = await missionService.createMission(
            {
                name: plan.name,
                objective: plan.objective,
                organizationId: testOrgId,
                createdBy: testUserId,
                executionStrategy: "pre_planned"
            },
            testUserId,
            [],
            false,
            plan.workflow
        );

        console.log(`[Test] Mission created: ${mission.id}`);
        // Let's find the pipeline linked to this mission
        const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.name, `Workstream: ${mission.id}`)).limit(1);
        expect(pipeline).toBeDefined();
        console.log(`[Test] Pipeline found: ${pipeline.id}`);

        const steps = await db.select().from(pipelineSteps).where(eq(pipelineSteps.pipelineId, pipeline.id)).orderBy(pipelineSteps.order);
        expect(steps.length).toBe(2);
        console.log(`[Test] Steps found: ${steps.length}`);
        
        // The last node "n2" should have been auto-tagged as "final_product"
        expect(steps[1].outputName).toBe("final_product");
        console.log("[Test] Verified leaf node tag.");

        // 2. Execute the pipeline and verify deliverable sync
        const run = await db.query.missionRuns.findFirst({
            where: eq(missionRuns.missionId, mission.id)
        });
        expect(run).toBeDefined();
        console.log(`[Test] Mission run found: ${run?.id}`);

        const hook = new MissionCheckpointHook();

        console.log("[Test] Simulating step completion for deliverable...");
        const output = "The weather is sunny in Tokyo today.";
        await hook.onStepComplete({
            result: { success: true, output },
            pipelineExecution: { id: 9999, missionId: mission.id, pipelineId: pipeline.id } as any,
            pipeline: pipeline as any,
            context: { named: { final_product: output }, positional: {} } as any,
            userId: testUserId,
            currentStep: steps[1] as any,
            stepExecution: {} as any,
            orgId: 1,
            goldenRecordWritten: false
        });

        console.log("[Test] Verifying deliverable in mission context...");
        const updatedRun = await missionRunService.getById(run!.id);
        expect((updatedRun?.missionContext as any)?.result).toBe(output);
        console.log("[Test] SUCCESS: Deliverable correctly synced!");
    }, 120000);
});
