import { describe, it, expect, beforeAll, vi } from "vitest";
import { CrewCycleBridgeService } from "../core/crew-cycle-bridge.service.js";
import { db } from "../../../database_service.js";
import { crewSessions, crewMembers, crewTurns, crewDecisions, appDeployments, apps } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";

describe("CrewCycleBridgeService", () => {
    const orgId = 291;
    const testCycleSlug = "hybrid-sdlc";

    beforeAll(async () => {
        await db.execute(sql`
            ALTER TABLE crew_sessions 
            ADD COLUMN IF NOT EXISTS cycle_slug text,
            ADD COLUMN IF NOT EXISTS cycle_stage_id text,
            ADD COLUMN IF NOT EXISTS cycle_context jsonb,
            ADD COLUMN IF NOT EXISTS parent_session_id integer REFERENCES crew_sessions(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS active_topic text,
            ADD COLUMN IF NOT EXISTS next_steps text,
            ADD COLUMN IF NOT EXISTS consensus_level integer,
            ADD COLUMN IF NOT EXISTS interrupting boolean DEFAULT false NOT NULL,
            ADD COLUMN IF NOT EXISTS last_round_completed_at timestamp;
        `).catch(() => {});
    });

    it("convenes a new stage ceremony room with agenda turn and cycle context", async () => {
        const result = await CrewCycleBridgeService.createCycleStageRoom(orgId, {
            cycleSlug: testCycleSlug,
            cycleName: "Enterprise Hybrid AI SDLC",
            stageId: "architecture_review",
            stageName: "Architecture Review",
            title: "Sprint 14 Architecture RFC Review",
            topic: "Review API contracts and threat models",
            requiredDecisions: ["API authentication protocol", "Database migration safety"],
        });

        expect(result).toBeDefined();
        expect(result.sessionKey).toContain("crew-cycle-hybrid-sdlc-architecture-review");
        expect(result.session.title).toBe("Sprint 14 Architecture RFC Review");
        expect(result.session.cycleSlug).toBe("hybrid-sdlc");
        expect(result.session.cycleStageId).toBe("architecture_review");
        expect(result.session.cycleContext?.requiredDecisions).toHaveLength(2);

        // Verify opening turn was inserted
        const turns = await db.select()
            .from(crewTurns)
            .where(eq(crewTurns.sessionId, result.session.id));

        expect(turns.length).toBeGreaterThanOrEqual(1);
        expect(turns[0].content).toContain("Operational Cycle Ceremony Initiated");
    });

    it("resolves cycle fleet apps for a room", async () => {
        // Provision a room
        const { sessionKey } = await CrewCycleBridgeService.createCycleStageRoom(orgId, {
            cycleSlug: testCycleSlug,
            cycleName: "Enterprise Hybrid AI SDLC",
            stageId: "sprint_planning",
        });

        const fleetResult = await CrewCycleBridgeService.getCycleFleetForRoom(orgId, sessionKey);
        expect(fleetResult).toBeDefined();
        expect(fleetResult.cycleSlug).toBe("hybrid-sdlc");
        expect(Array.isArray(fleetResult.apps)).toBe(true);
    });

    it("evaluates consensus gate satisfaction against required decisions", async () => {
        const { session, sessionKey } = await CrewCycleBridgeService.createCycleStageRoom(orgId, {
            cycleSlug: testCycleSlug,
            stageId: "qa_release",
            requiredDecisions: ["Test suite pass rate >= 95%"],
        });

        // Initially not satisfied
        const initialStatus = await CrewCycleBridgeService.advanceCycleGateOnConsensus(orgId, sessionKey);
        expect(initialStatus.satisfied).toBe(false);
        expect(initialStatus.pendingDecisions).toContain("Test suite pass rate >= 95%");

        // Insert accepted decision
        await db.insert(crewDecisions).values({
            sessionId: session.id,
            organizationId: orgId,
            statement: "Confirmed: Test suite pass rate >= 95% achieved on build #420",
            status: "accepted",
            createdBy: "QA Specialist",
        });

        const updatedStatus = await CrewCycleBridgeService.advanceCycleGateOnConsensus(orgId, sessionKey);
        expect(updatedStatus.satisfied).toBe(true);
        expect(updatedStatus.approvedDecisions).toContain("Test suite pass rate >= 95%");
    });
});
