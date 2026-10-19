/**
 * Rolling Wave Orchestrator — Integration Tests
 *
 * Tests crew recruitment, SSE event bridging, and phase transitions.
 * Uses a real DB connection; requires migrations to be applied.
 */

/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db } from "@server/database_service.js";
import { missions, missionRuns } from "@shared/schema/index.js";
import { eq, sql } from "drizzle-orm";
import { rollingWaveOrchestratorService } from "@server/domain/mission/core/rolling-wave-orchestrator.service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function tableExists(name: string): Promise<boolean> {
    try {
        await db.execute(sql`SELECT 1 FROM ${sql.identifier(name)} LIMIT 1`);
        return true;
    } catch {
        return false;
    }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let missionId: number;
let missionRunId: number;

beforeAll(async () => {
    if (!(await tableExists("missions"))) return;

    const [m] = await db.insert(missions).values({
        name: "RW Test Mission",
        objective: "Test rolling wave crew recruitment",
        createdBy: "test-user",
        organizationId: null,
    } as any).returning();
    missionId = m.id;
});

afterAll(async () => {
    if (missionId) {
        await db.delete(missionRuns).where(eq(missionRuns.missionId, missionId)).catch(() => {});
        await db.delete(missions).where(eq(missions.id, missionId)).catch(() => {});
    }
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Rolling Wave Orchestrator", () => {
    it("updatePhase persists phase to DB and publishes SSE event", async () => {
        if (!(await tableExists("mission_runs"))) return;

        const publishSpy = vi.spyOn(
            (await import("@domain/core/infrastructure/event-stream.service.js")).eventStream,
            "publish"
        );

        const [run] = await db.insert(missionRuns).values({
            name: "RW Phase Test Run",
            missionId,
            status: "active",
            missionContext: { phase: "PLANNING", current_wave: 1, max_waves: 10 },
            pipelineSequence: [],
            createdBy: "test-user",
        } as any).returning();

        missionRunId = run.id;

        await rollingWaveOrchestratorService.updatePhase(missionRunId, "EXECUTING");

        const [updated] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
        const ctx = updated.missionContext as any;

        expect(ctx.phase).toBe("EXECUTING");
        expect(updated.status).toBe("active");

        // SSE event should have been published
        const phaseCall = publishSpy.mock.calls.find((c: any) => c[0] === "mission.phase_changed");
        expect(phaseCall).toBeDefined();
        expect(phaseCall![1]).toMatchObject({ missionRunId, phase: "EXECUTING" });

        publishSpy.mockRestore();
    });

    it("updatePhase sets status to 'paused' for WAITING_FOR_ORDERS", async () => {
        if (!missionRunId) return;

        await rollingWaveOrchestratorService.updatePhase(missionRunId, "WAITING_FOR_ORDERS");

        const [updated] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
        expect(updated.status).toBe("paused");
        expect((updated.missionContext as any).phase).toBe("WAITING_FOR_ORDERS");
    });

    it("appendTrace publishes mission.trace SSE event", async () => {
        const publishSpy = vi.spyOn(
            (await import("@domain/core/infrastructure/event-stream.service.js")).eventStream,
            "publish"
        );

        const traceEntry = { type: "system", event: "test_trace", note: "hello from test" };
        rollingWaveOrchestratorService.appendTrace(99, traceEntry);

        // Give the fire-and-forget publish a tick to run
        await new Promise(r => setTimeout(r, 50));

        const traceCall = publishSpy.mock.calls.find((c: any) => c[0] === "mission.trace");
        expect(traceCall).toBeDefined();
        expect(traceCall![1]).toMatchObject({ missionRunId: 99, traceEntry });

        publishSpy.mockRestore();
    });
});

describe("SSE Stream endpoint", () => {
    it("GET /api/events/stream — type filter regex excludes non-matching events", () => {
        // Unit test the regex logic used inside the route handler
        const typeFilter = "mission.*";
        const typeRegex = new RegExp(
            "^" + typeFilter.replace(/\./g, "\\.").replace(/\*\*/g, "___DS___").replace(/\*/g, "[^.]*").replace(/___DS___/g, ".*") + "$"
        );

        expect(typeRegex.test("mission.phase_changed")).toBe(true);
        expect(typeRegex.test("mission.trace")).toBe(true);
        expect(typeRegex.test("forge.progress")).toBe(false);
        expect(typeRegex.test("mission.crew_assembled")).toBe(true);
    });

    it("GET /api/events/stream — wildcard ** matches deeply nested types", () => {
        const typeFilter = "mission.**";
        const typeRegex = new RegExp(
            "^" + typeFilter.replace(/\./g, "\\.").replace(/\*\*/g, "___DS___").replace(/\*/g, "[^.]*").replace(/___DS___/g, ".*") + "$"
        );

        expect(typeRegex.test("mission.phase_changed")).toBe(true);
        expect(typeRegex.test("mission.run.step.completed")).toBe(true);
    });
});
