import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * launchMission must not launch another organization's mission.
 *
 * The mission is loaded by id alone and `orgId` was only used to scope the work
 * that followed, so nothing compared the two. A caller that could name a
 * mission id could start another tenant's mission, with this service's own org
 * argument deciding where the resulting agents, spend and artifacts landed.
 * The reachable path was the SaaS event workflow: POST /event-workflows
 * accepted any numeric workflow id and the orchestrator launched it as
 * `system`.
 *
 * The rule is deliberately narrow. missions.organization_id is nullable and
 * several of the ~22 callers pass null on purpose — a scheduled or
 * platform-level mission has no tenant to compare against — so requiring
 * equality outright would break those rather than secure them. Only a definite
 * mismatch is refused, and these tests pin both halves of that: the mismatch
 * refuses, and each null case still proceeds.
 */

const getMissionDetail = vi.fn();

vi.mock("@domain/mission/core/mission-query.service.js", () => ({
    missionQueryService: { getMissionDetail },
}));

// A query builder that answers to any method and resolves to no rows.
// Enumerating the builder's surface instead (innerJoin, leftJoin, groupBy,
// orderBy, ...) made the "proceeds past the guard" tests fail on a missing stub
// rather than on their assertion, which is a test asserting the mock's shape
// rather than the code's behaviour.
function emptyQuery(): any {
    const chain: any = new Proxy(() => chain, {
        get(_t, prop) {
            if (prop === "then") return (res: any) => Promise.resolve([]).then(res);
            if (prop === "catch") return () => chain;
            return () => chain;
        },
        apply: () => chain,
    });
    return chain;
}

const dbUpdate = vi.fn(() => emptyQuery());
vi.mock("@server/database_service.js", () => ({
    db: {
        update: dbUpdate,
        select: () => emptyQuery(),
        insert: () => emptyQuery(),
        delete: () => emptyQuery(),
        transaction: async (fn: any) => fn(emptyQuery()),
    },
    pool: { connect: vi.fn(async () => ({ query: async () => ({ rows: [] }), release: () => {} })) },
}));

const { missionExecutionService } = await import("@domain/mission/core/mission-execution.service.js");

/** A mission detail row, with only the fields the guard and its preamble read. */
function mission(organizationId: number | null) {
    return {
        id: 77,
        organizationId,
        objective: "Ship the thing",
        blackboard: {},
        executionStrategy: "pre_planned",
        externalTicketId: "SET",
    };
}

describe("launchMission tenancy", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("refuses a mission that belongs to another organization", async () => {
        getMissionDetail.mockResolvedValue(mission(1));

        const result = await missionExecutionService.launchMission(77, "attacker", 2);

        expect(result.success).toBe(false);
        // Deliberately the same message as a missing mission: whether mission 77
        // exists in some other tenant is not something to confirm to a caller
        // who may not see it.
        expect(result.error).toBe("Mission not found");
    });

    it("starts nothing when it refuses", async () => {
        getMissionDetail.mockResolvedValue(mission(1));

        const result = await missionExecutionService.launchMission(77, "attacker", 2);

        // The message, not just success:false — in a stubbed environment any
        // later failure also returns success:false, which would let this pass
        // with the guard removed.
        expect(result.error).toBe("Mission not found");
        expect(result.missionRunId).toBeUndefined();
        expect(result.executionId).toBeUndefined();
        // No database side effect may precede the tenant guard.
        expect(dbUpdate).not.toHaveBeenCalled();
    });

    it("refuses regardless of which organization is larger, so the rule is not an ordering accident", async () => {
        getMissionDetail.mockResolvedValue(mission(9));
        expect((await missionExecutionService.launchMission(77, "u", 3)).error).toBe("Mission not found");

        getMissionDetail.mockResolvedValue(mission(3));
        expect((await missionExecutionService.launchMission(77, "u", 9)).error).toBe("Mission not found");
    });

    it("does not refuse when the organizations match", async () => {
        getMissionDetail.mockResolvedValue(mission(5));

        const result = await missionExecutionService.launchMission(77, "member", 5);

        // It gets past the guard. Where it ends up afterwards depends on the
        // stubbed environment; what matters is that it is not the refusal.
        expect(result.error).not.toBe("Mission not found");
    });
    it("does not write a launch-specific Jira key into the shared mission template", async () => {
        getMissionDetail.mockResolvedValue({ ...mission(5), objective: "", externalTicketId: null });
        await missionExecutionService.launchMission(77, "member", 5, undefined, undefined, { context: { jiraKey: "REQ-42" } });
        expect(dbUpdate).not.toHaveBeenCalled();
    });

    it("does not refuse a mission with no organization", async () => {
        // Platform and scheduled missions. Requiring equality would break them.
        getMissionDetail.mockResolvedValue(mission(null));

        const result = await missionExecutionService.launchMission(77, "system", 5);

        expect(result.error).not.toBe("Mission not found");
    });

    it("does not refuse when the caller supplies no organization", async () => {
        // missions.route.ts passes `workgroup.organizationId ?? orgId ?? null`.
        getMissionDetail.mockResolvedValue(mission(5));

        const result = await missionExecutionService.launchMission(77, "system", null);

        expect(result.error).not.toBe("Mission not found");
    });

    it("still reports a genuinely missing mission the same way", async () => {
        getMissionDetail.mockResolvedValue(null);

        const result = await missionExecutionService.launchMission(77, "u", 5);

        expect(result).toEqual({ success: false, error: "Mission not found" });
    });
});
