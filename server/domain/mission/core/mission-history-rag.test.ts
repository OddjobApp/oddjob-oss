/**
 * Cross-run retrieval for mission history.
 *
 * Retrieval used to filter hard on `missionRunId`, so a mission could only ever
 * recall its own run — no mission could learn anything from a previous one,
 * which is most of the value of indexing them at all.
 *
 * Widening that filter is only safe because indexed points now carry an
 * organizationId. The tests that matter here are therefore about the boundary:
 * traces must be reachable across runs of the same org, and unreachable across
 * orgs. Legacy points, indexed before organizationId existed, must keep working.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { state } = vi.hoisted(() => ({
    state: {
        /** Points the fake Qdrant holds. */
        points: [] as any[],
        /** The filter the service last searched with. */
        lastFilter: undefined as any,
        /** organizationId returned for the run being asked about. */
        runOrgId: null as number | null,
    },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

vi.mock("../../knowledge/core/rag-langchain.service.js", () => ({
    getEmbeddings: () => ({ embedQuery: async () => [0.1, 0.2, 0.3] }),
}));

vi.mock("../../../integrations/qdrant-client.js", () => ({
    ensureQdrantCollection: vi.fn(async () => undefined),
    upsertQdrantPoints: vi.fn(async () => undefined),
    searchQdrant: vi.fn(async (_vector: number[], opts: any) => {
        state.lastFilter = opts.filter;

        // Model Qdrant's `should` as OR over the clauses, which is the semantic
        // the widened filter depends on.
        const clauses: any[] = opts.filter?.should ?? [];
        const matches = state.points.filter(p =>
            clauses.some(c => p.payload[c.key] === c.match.value),
        );

        return matches.slice(0, opts.limit).map(p => ({ payload: p.payload, score: p.score }));
    }),
}));

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: async () => [{ organizationId: state.runOrgId }],
                }),
            }),
        }),
    },
}));

vi.mock("@shared/schema/index.js", () => ({ missionRuns: { id: "id", organizationId: "org" } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

const { MissionHistoryRAGService } = await import("./mission-history-rag.service.js");

const THIS_RUN = 100;
const EARLIER_RUN = 42;
const ORG = 7;
const OTHER_ORG = 9;

const point = ({ score = 0.5, ...payload }: Partial<any> = {}) => ({
    score,
    payload: {
        missionRunId: THIS_RUN,
        organizationId: ORG,
        timestamp: "2026-01-01",
        event: "reflection",
        note: "a note",
        ...payload,
    },
});

beforeEach(() => {
    state.points = [];
    state.lastFilter = undefined;
    state.runOrgId = ORG;
});

describe("retrieval reaches beyond the current run", () => {
    it("returns traces from an earlier run of the same org", async () => {
        state.points = [
            point({ missionRunId: EARLIER_RUN, note: "lesson from before" }),
        ];

        const results = await MissionHistoryRAGService.retrieveRelevantHistory(THIS_RUN, "query");

        // The old hard filter on missionRunId made this impossible.
        expect(results).toHaveLength(1);
        expect(results[0]).toContain("lesson from before");
    });

    it("labels which run a trace came from", async () => {
        state.points = [
            point({ missionRunId: EARLIER_RUN, note: "older", score: 0.9 }),
            point({ missionRunId: THIS_RUN, note: "current", score: 0.8 }),
        ];

        const results = await MissionHistoryRAGService.retrieveRelevantHistory(THIS_RUN, "query");

        // Unlabelled, a planner cannot tell its own history from another run's.
        expect(results.find(r => r.includes("older"))).toContain(`run #${EARLIER_RUN}`);
        expect(results.find(r => r.includes("current"))).toContain("this run");
    });

    it("breaks ties toward the current run without burying a better match", async () => {
        state.points = [
            point({ missionRunId: THIS_RUN, note: "tie-current", score: 0.70 }),
            point({ missionRunId: EARLIER_RUN, note: "tie-earlier", score: 0.70 }),
        ];
        const tied = await MissionHistoryRAGService.retrieveRelevantHistory(THIS_RUN, "q", 2);
        expect(tied[0]).toContain("tie-current");

        state.points = [
            point({ missionRunId: THIS_RUN, note: "weak-current", score: 0.50 }),
            point({ missionRunId: EARLIER_RUN, note: "strong-earlier", score: 0.95 }),
        ];
        const clear = await MissionHistoryRAGService.retrieveRelevantHistory(THIS_RUN, "q", 2);
        expect(clear[0]).toContain("strong-earlier");
    });
});

describe("retrieval does not cross tenants", () => {
    it("never returns another organization's traces", async () => {
        state.points = [
            point({ missionRunId: 999, organizationId: OTHER_ORG, note: "other tenant secret" }),
        ];

        const results = await MissionHistoryRAGService.retrieveRelevantHistory(THIS_RUN, "query");

        expect(results).toHaveLength(0);
        expect(JSON.stringify(results)).not.toContain("other tenant secret");
    });

    it("scopes the query to the run's own organization", async () => {
        await MissionHistoryRAGService.retrieveRelevantHistory(THIS_RUN, "query");

        const keys = (state.lastFilter?.should ?? []).map((c: any) => c.key);
        expect(keys).toContain("organizationId");
        // An unscoped `must: []` or a missing filter would match everything.
        expect(state.lastFilter?.should?.length).toBeGreaterThan(0);
    });

    it("falls back to run-only scope when the run has no organization", async () => {
        state.runOrgId = null;
        state.points = [
            point({ missionRunId: THIS_RUN, note: "own trace" }),
            point({ missionRunId: EARLIER_RUN, organizationId: ORG, note: "sibling run" }),
        ];

        const results = await MissionHistoryRAGService.retrieveRelevantHistory(THIS_RUN, "query");

        // With no org to scope by, widening would be unsafe, so it must not.
        expect(results).toHaveLength(1);
        expect(results[0]).toContain("own trace");
    });
});

describe("traces indexed before organizationId existed", () => {
    it("still retrieves them for their own run", async () => {
        // Legacy points carry neither organizationId nor missionId.
        state.points = [{
            score: 0.6,
            payload: {
                missionRunId: THIS_RUN,
                timestamp: "2025-12-01",
                event: "reflection",
                note: "legacy trace",
            },
        }];

        const results = await MissionHistoryRAGService.retrieveRelevantHistory(THIS_RUN, "query");

        expect(results).toHaveLength(1);
        expect(results[0]).toContain("legacy trace");
    });
});
