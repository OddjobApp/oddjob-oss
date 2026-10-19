
import { describe, it, expect } from "vitest";
import { db } from "@server/database_service.js";
import { missionRuns, jobs, hilForms, pipelines, missions, orgs } from "@shared/schema/index.js";
import { missionRunService } from "@domain/mission/core/mission-run.service.js";

describe("Mission Timeline Integration (Live DB)", () => {
    const timestamp = Date.now();

    it("should fetch timeline without 500 error even with non-numeric formId", async () => {
        // 0. Setup Org and Mission
        let org = await db.query.orgs.findFirst();
        if (!org) {
            const [newOrg] = await db.insert(orgs).values({
                name: `Test Org ${timestamp}`,
                subscriptionStatus: "active"
            }).returning();
            org = newOrg;
        }

        const [mission] = await db.insert(missions).values({
            name: `Test Mission ${timestamp}`,
            organizationId: org.id,
            createdBy: "test-user",
            objective: "Test Objective",
            status: "active"
        }).returning();

        // 1. Create a job with a non-numeric formId (the trigger for the 500 error)
        const [job] = await db.insert(jobs).values({
            name: `Broken Form Job ${timestamp}`,
            type: "human_approval",
            config: { formId: "NOT_AN_INT" },
            createdBy: "test-user",
            tool: "None",
            lifecycleStatus: "active",
            organizationId: org.id
        }).returning();

        const [pipeline] = await db.insert(pipelines).values({
            name: `Test Pipeline ${timestamp}`,
            organizationId: org.id,
            triggerType: "manual",
            createdBy: "test-user",
            lifecycleStatus: "active"
        }).returning();

        const [run] = await db.insert(missionRuns).values({
            missionId: mission.id,
            organizationId: org.id,
            name: `Test Run ${timestamp}`,
            status: "active",
            createdBy: "test-user",
            currentPipelineId: pipeline.id
        }).returning();

        // 2. Attempt to fetch timeline.
        const timeline = await missionRunService.getTimeline(run.id);
        expect(timeline).toBeDefined();
        console.log("✅ Timeline fetched successfully with non-numeric formId");
    });

    it("should fetch timeline correctly with numeric formId", async () => {
        const ts2 = Date.now() + 1;
        let org = await db.query.orgs.findFirst();
        if (!org) {
            const [newOrg] = await db.insert(orgs).values({
                name: `Valid Org ${ts2}`,
                subscriptionStatus: "active"
            }).returning();
            org = newOrg;
        }

        const [mission] = await db.insert(missions).values({
            name: `Valid Mission ${ts2}`,
            organizationId: org.id,
            createdBy: "test-user",
            objective: "Valid Objective",
            status: "active"
        }).returning();

        const [job] = await db.insert(jobs).values({
            name: `Valid Form Job ${ts2}`,
            type: "human_approval",
            config: { formId: "123" },
            createdBy: "test-user",
            tool: "None",
            lifecycleStatus: "active",
            organizationId: org.id
        }).returning();

        const [pipeline] = await db.insert(pipelines).values({
            name: `Valid Pipeline ${ts2}`,
            organizationId: org.id,
            triggerType: "manual",
            createdBy: "test-user",
            lifecycleStatus: "active"
        }).returning();

        const [run] = await db.insert(missionRuns).values({
            missionId: mission.id,
            organizationId: org.id,
            name: `Valid Run ${ts2}`,
            status: "active",
            createdBy: "test-user",
            currentPipelineId: pipeline.id
        }).returning();

        const timeline = await missionRunService.getTimeline(run.id);
        expect(timeline).toBeDefined();
        console.log("✅ Timeline fetched successfully with numeric formId");
    });
});
