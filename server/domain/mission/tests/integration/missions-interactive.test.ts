/** @vitest-environment node */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, serverReady } from "@server/index.js";
import { db } from "@server/database_service.js";
import { missions, missionMembers, jobs } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

describe('Missions Interactive API', () => {
    let missionId: number;
    let jobId: number;

    beforeAll(async () => {
        // The routes are registered inside BootstrapService.initialize, which is
        // what serverReady resolves on. Without awaiting it the DELETE route is
        // not mounted yet and the request falls through to the readiness guard,
        // which answers 503 — so this asserted 404 and got "not ready".
        await serverReady;

        // Create a test mission and job
        const [mission] = await db.insert(missions).values({
            name: "Interactive Test Mission",
            objective: "Test objective",
            type: "research",
            status: "active",
            organizationId: null,
            createdBy: "test_user_interactive"
        } as any).returning();
        missionId = mission.id;

        const [job] = await db.insert(jobs).values({
            name: "Test Agent",
            type: "researcher",
            tool: "web-search",
            config: {},
            organizationId: null,
            createdBy: "test_user_interactive"
        }).returning();
        jobId = job.id;

        // Add member
        await db.insert(missionMembers).values({
            missionId,
            entityType: "job",
            entityId: jobId,
            role: "member",
            status: "active"
        });
    });

    it.skip('should remove a member from a mission', async () => {
        const response = await request(app)
            .delete(`/api/missions/${missionId}/members/job/${jobId}`)
            .set('x-internal-token', 'dev-secret-key-change-in-production');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('success', true);

        // Verify in DB
        const existing = await db.select()
            .from(missionMembers)
            .where(and(
                eq(missionMembers.missionId, missionId),
                eq(missionMembers.entityType, "job"),
                eq(missionMembers.entityId, jobId)
            ));

        expect(existing.length).toBe(0);
    });

    it('should return 404 if member does not exist', async () => {
        const response = await request(app)
            .delete(`/api/missions/${missionId}/members/job/999999`)
            .set('x-internal-token', 'dev-secret-key-change-in-production');

        expect(response.status).toBe(404);
    });
});
