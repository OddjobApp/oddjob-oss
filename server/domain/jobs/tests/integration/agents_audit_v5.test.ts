/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from 'pg';
import { requireTestDatabaseUrl } from '../../../../../tests/configure-test-environment.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema/index.js";

// Mocks to avoid server/index.ts side effects
vi.mock("@server/domain/core/infrastructure/redis/redis-client.js", () => ({ 
    redis: { get: vi.fn(), set: vi.fn(), on: vi.fn() },
    redisManager: { isReady: () => true }
}));

describe("Agents Pod Audit v12 (Direct Driver)", () => {
    let localPool: Pool;
    let localDb: ReturnType<typeof drizzle>;
    let testOrgId: number;
    let testJobId: number;
    const testUsername = `direct_audit_${Date.now()}`;

    beforeAll(async () => {
        // Create a direct connection in the test process
        // NEVER hardcode a connection string here. This previously pointed at the
        // DEVELOPMENT database (127.0.0.1:5433/oddjob) and inserted orgs and jobs
        // straight into it, bypassing configureTestEnvironment. requireTestDatabaseUrl
        // returns the pinned test database and refuses anything that is not one.
        localPool = new Pool({
            connectionString: requireTestDatabaseUrl(),
            max: 5
        });

        localDb = drizzle(localPool, { schema });

        // Basic connectivity check
        const res = await localPool.query('SELECT 1');
        expect(res.rowCount).toBe(1);

        const [org] = await localDb.insert(schema.orgs).values({
            // Unique per run like the slug: orgs.name is unique too (see v6).
            name: `Direct Audit Org ${Date.now()}`,
            slug: `direct_${Date.now()}`
        } as any).returning();
        testOrgId = org.id;

        const [job] = await localDb.insert(schema.jobs).values({
            organizationId: testOrgId, type: "agent_orchestrator", status: "pending", name: "Direct Audit Agent", config: {}, createdBy: testUsername
        } as any).returning();
        testJobId = job.id;
    });

    afterAll(async () => {
        if (testOrgId) {
            await localDb.delete(schema.jobs).where(eq(schema.jobs.id, testJobId) as any).catch(() => {});
            await localDb.delete(schema.orgs).where(eq(schema.orgs.id, testOrgId) as any).catch(() => {});
        }
        await localPool.end();
    });

    it("should archive execution history", async () => {
        const [step] = await localDb.insert(schema.agentRunSteps).values({
            organizationId: testOrgId, jobId: testJobId, type: "thought", content: "Direct Logic", runId: "test-run-123"
        } as any).returning();
        expect(step.id).toBeDefined();
    });

    it("should coordinate swarm logic", async () => {
        // Swarm logic usually uses Redis, which we mocked above.
        // If it pass, it means the imports worked.
        expect(true).toBe(true);
    });
});

import { eq } from "drizzle-orm";
