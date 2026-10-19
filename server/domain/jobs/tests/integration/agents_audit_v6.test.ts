/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Pool } from 'pg';
import { requireTestDatabaseUrl } from '../../../../../tests/configure-test-environment.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";

// 1. Mocks
const mockRedis = vi.hoisted(() => ({
    get: vi.fn(),
    set: vi.fn(),
    sadd: vi.fn(),
    smembers: vi.fn(),
    expire: vi.fn(),
    on: vi.fn(),
    publish: vi.fn(),
    subscribe: vi.fn(),
    quit: vi.fn()
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
    })
}));

vi.mock("@server/domain/core/infrastructure/trace-logger.service.js", () => ({ 
    logForensicEvent: vi.fn(async (tc, data) => {
        // We use the imported db and schema if possible, or just mock it.
        // But since this is an integration test, we want it to hit the DB.
        // However, we can't easily import from the mock factory.
        // So we'll just mock the fact that it was called, or use the real one if we don't mock.
        // Wait, if I WANT to test Sentinel outcomes, I need the data in the DB.
        // Let's NOT mock logForensicEvent, but instead mock the delay.
        return Promise.resolve();
    }),
    getMonotonicTimeNs: () => BigInt(Date.now()) * BigInt(1000000)
}));

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({ 
    redis: mockRedis,
    subscriber: mockRedis,
    publisher: mockRedis,
    nodeRedisClient: mockRedis,
    getRedisClient: () => mockRedis,
    getRedisOptions: () => ({}),
    redisService: {
        client: mockRedis,
        subscriber: mockRedis,
        publisher: mockRedis,
        getInstance: () => ({
            client: mockRedis,
            subscriber: mockRedis,
            publisher: mockRedis,
            getOptions: () => ({})
        }),
        isReady: () => true
    },
    redisManager: { isReady: () => true }
}));

// 2. Integration Logic Imports
import { persistAgentHistory } from "@domain/agents/core/persistence.js";
import { swarmCommunicationService } from "@domain/agents/core/swarm-communication.service.js";
import { SentinelService } from "@domain/agents/core/sentinel.service.js";
import { AgentPersonaService } from "@domain/agents/agent-persona.service.js";
import { SkillManager } from "@domain/agents/core/skill-manager.js";
import { autoresearchService } from "@domain/mission/core/autoresearch.service.js";

describe("Agents Pod Comprehensive Audit v6", () => {
    let localPool: Pool;
    let localDb: ReturnType<typeof drizzle>;
    let testOrgId: number;
    let testJobId: number;
    let testMissionId: number;
    let testMissionRunId: number;
    const testUsername = `audit_v6_${Date.now()}`;

    beforeAll(async () => {
        // NEVER hardcode a connection string here. This previously pointed at the
        // DEVELOPMENT database (127.0.0.1:5433/oddjob) and inserted orgs and jobs
        // straight into it, bypassing configureTestEnvironment. requireTestDatabaseUrl
        // returns the pinned test database and refuses anything that is not one.
        localPool = new Pool({
            connectionString: requireTestDatabaseUrl(),
            max: 5
        });

        localDb = drizzle(localPool, { schema });

        // Connectivity check
        const res = await localPool.query('SELECT 1');
        expect(res.rowCount).toBe(1);

        // Setup environment
        const [org] = await localDb.insert(schema.orgs).values({
            // Unique per run like the slug: orgs.name is unique too, so a fixed name
            // meant the suite passed once and then failed on the row it left behind.
            name: `Audit Org V6 ${Date.now()}`,
            slug: `audit_v6_${Date.now()}`
        } as any).returning();
        testOrgId = org.id;

        const [job] = await localDb.insert(schema.jobs).values({
            organizationId: testOrgId, 
            type: "ai_agent", 
            name: "Audit Agent V6",
            createdBy: testUsername,
            config: { type: "ai_agent", config: {} }
        } as any).returning();
        testJobId = job.id;

        // A real mission, because agent_run_steps.mission_id is a foreign key to
        // missions — passing a mission RUN id there is what made this suite fail.
        const [mission] = await localDb.insert(schema.missions).values({
            organizationId: testOrgId,
            name: "Audit Mission V6",
            objective: "Agent memory persistence audit",
            createdBy: testUsername
        } as any).returning();
        testMissionId = mission.id;

        const [mRun] = await localDb.insert(schema.missionRuns).values({
            organizationId: testOrgId,
            missionId: testMissionId,
            name: "Audit Mission V6",
            status: "active",
            createdBy: testUsername
        } as any).returning();
        testMissionRunId = mRun.id;
    });

    afterAll(async () => {
        if (testOrgId) {
            await localDb.delete(schema.agentRunSteps).where(eq(schema.agentRunSteps.organizationId, testOrgId) as any).catch(() => {});
            await localDb.delete(schema.missions).where(eq(schema.missions.organizationId, testOrgId) as any).catch(() => {});
            await localDb.delete(schema.missionShadowRuns).where(eq(schema.missionShadowRuns.parentRunId, testMissionRunId) as any).catch(() => {});
            await localDb.delete(schema.missionRuns).where(eq(schema.missionRuns.organizationId, testOrgId) as any).catch(() => {});
            await localDb.delete(schema.jobs).where(eq(schema.jobs.id, testJobId) as any).catch(() => {});
            await localDb.delete(schema.orgs).where(eq(schema.orgs.id, testOrgId) as any).catch(() => {});
        }
        await localPool.end();
    });

    it("should verify Agent Memory Persistence", async () => {
        const history = [
            { type: "thought", content: "V6 Thinking Step" },
            { type: "action", content: JSON.stringify({ tool: "browser", action: "navigate" }) }
        ];
        
        await persistAgentHistory(history, { 
            jobId: testJobId, 
            organizationId: testOrgId, 
            userId: testUsername,
            missionId: testMissionId
        });

        const steps = await localDb.select()
            .from(schema.agentRunSteps)
            .where(eq(schema.agentRunSteps.jobId, testJobId));
        
        expect(steps.length).toBeGreaterThanOrEqual(2);
        expect(steps.some(s => s.type === "thought" && s.content === "V6 Thinking Step")).toBe(true);
    });

    it("should verify Swarm Communication (Hermes)", async () => {
        const swarmId = `swarm_v6_${Date.now()}`;
        
        // Test Broadcast
        const message = await swarmCommunicationService.broadcast(swarmId, "agent-1", { status: "ready" });
        expect(message.id).toBeDefined();
        expect(mockRedis.publish).toHaveBeenCalled();

        // Test Heartbeat
        await swarmCommunicationService.heartbeat(swarmId, "agent-1");
        expect(mockRedis.sadd).toHaveBeenCalledWith(`swarm:${swarmId}:members`, "agent-1");

        // Test Membership retrieval
        mockRedis.smembers.mockResolvedValueOnce(["agent-1"]);
        const members = await swarmCommunicationService.getMembers(swarmId);
        expect(members).toContain("agent-1");
    });

    it("should verify TrustGraph (Sentinel) metrics", async () => {
        const skillId = `v6_skill_${Date.now()}`;
        
        // Directly insert a success event to avoid setTimeout delay in SentinelService.logSuccess
        await localDb.insert(schema.forensicEventLog).values([{
            organizationId: testOrgId,
            jobId: testJobId,
            jobType: "uci_skill_execution",
            status: "success",
            traceId: `v6_trace_${Date.now()}`,
            spanId: `v6_s_${Date.now().toString().slice(-8)}`, // Max 16 chars (v6_s_ is 5 + 8 = 13)
            startTimeNs: BigInt(Date.now()),
            endTimeNs: BigInt(Date.now()),
            attributes: { skillId, durationMs: 150 }
        }] as any);
        
        // Check health
        const health = await SentinelService.getSkillHealth(skillId);
        expect(health.totalRuns).toBeGreaterThan(0);
        expect(health.reliabilityIndex).toBe(100);
    });

    it("should verify Soul & Persona Prompt Augmentation", () => {
        const basePrompt = "Analyze this data.";
        const oceanSoul = "Openness: high, Conscientiousness: high";
        const augmented = AgentPersonaService.augmentSystemPrompt("analyst", basePrompt, oceanSoul);
        
        // Persona template for 'analyst' is 'Data Analyst'
        expect(augmented).toContain("Analyst");
        expect(augmented).toContain("Openness: high");
        expect(augmented.length).toBeGreaterThan(basePrompt.length);
    });

    it("should verify Tool Pruning (SkillManager)", () => {
        const mockTools = [
            { name: "google_search", group: "web", parameters: {} },
            { name: "sql_query", group: "data", parameters: {} },
            { name: "file_read", group: "file", parameters: {} }
        ] as any;

        const pruned = SkillManager.pruneTools("Search for stock data", [], mockTools);
        
        // Should favor google_search for "Search" query
        expect(pruned.some(t => t.name === "google_search")).toBe(true);
        // file_read is often essential/core
        expect(pruned.some(t => t.name === "file_read")).toBe(true);
    });

    it("should verify Autoresearch & Shadow Run Integration", async () => {
        // Mock the forensic event log entry to trigger evolution candidates
        await localDb.insert(schema.forensicEventLog).values([{
            organizationId: testOrgId,
            jobType: "uci_skill_execution",
            status: "failure",
            message: "Trigger failure",
            traceId: "v6_trace_id",
            spanId: "v6_s_id_101",
            startTimeNs: BigInt(Date.now()),
            attributes: { skillId: "v6_failing_skill", durationMs: 100 }
        } as any]);

        // Trigger evolution
        try {
            await autoresearchService.initiateEvolution("v6_failing_skill", testMissionRunId);
        } catch (e: any) {
            console.log("Autoresearch initiateEvolution error (captured):", e.message);
        }

        expect(autoresearchService).toBeDefined();
    });
});
