/**
 * MCP handler argument validation.
 *
 * These handlers previously took `args: any` and destructured straight off it,
 * so a malformed tool call reached the service layer (or the database) before
 * anything noticed. Validation now runs before any service import, which is what
 * these tests pin: a bad call is rejected AND the underlying service is never
 * touched.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock factories are hoisted above the file, so every spy they close over
// must be created inside vi.hoisted().
const h = vi.hoisted(() => ({
    dbSelect: vi.fn(),
    findSymbols: vi.fn().mockResolvedValue([]),
    collectFiles: vi.fn().mockResolvedValue([]),
    traceImpact: vi.fn().mockResolvedValue([]),
    getPodSync: vi.fn(),
    estimate: vi.fn().mockResolvedValue({}),
    generatePredictions: vi.fn().mockResolvedValue({}),
    explainPrediction: vi.fn().mockResolvedValue({}),
}));

vi.mock("@server/database_service.js", () => ({
    db: {
        select: (...a: unknown[]) => {
            h.dbSelect(...a);
            return { from: () => ({ where: () => ({ orderBy: () => ({ limit: () => [] }), limit: () => [] }) }) };
        },
        update: () => ({ set: () => ({ where: () => undefined }) }),
        insert: () => ({ values: () => ({ returning: () => [{ id: 1 }] }) }),
    },
}));

vi.mock("../../domain/xray/core/xray-intelligence.service.js", () => ({
    xrayIntelligenceService: {
        findSymbols: h.findSymbols,
        collectFiles: h.collectFiles,
        traceImpact: h.traceImpact,
    },
}));

vi.mock("@domain/core/infrastructure/pod-registry.service.js", () => ({
    podRegistry: { getPodSync: h.getPodSync },
}));

vi.mock("../../domain/prediction-intelligence/hidden-state/hidden-state-pod.service.js", () => ({
    hiddenStatePod: { estimate: h.estimate },
}));
vi.mock("../../domain/prediction-intelligence/prediction/prediction-pod.service.js", () => ({
    predictionPod: { generatePredictions: h.generatePredictions },
}));
vi.mock("../../domain/prediction-intelligence/explanation/explanation-pod.service.js", () => ({
    explanationPod: { explainPrediction: h.explainPrediction },
}));

import {
    handleListAntigravityIncidents,
    handleGetIncidentContext,
    handleResolveAntigravityIncident,
} from "../handlers/antigravity.js";
import {
    handleGMSScoreBlueprint,
    handleGMSSynthesizeMissions,
    handleGMSShadowValidate,
    handleGMSFindSkills,
    handleGMSEvolveSkill,
    handleGMSComposeMission,
} from "../handlers/gms.js";
import {
    handleGetHiddenStateEstimate,
    handlePredictOutcomes,
    handleExplainPrediction,
} from "../handlers/prediction.js";
import {
    handleXRayFind,
    handleXRayImpact,
    handleXRayExplore,
    handleQueryCodeGraph,
    handleGetCodeMetrics,
    handleIndexWorkspace,
} from "../handlers/xray.js";

beforeEach(() => {
    vi.clearAllMocks();
    h.getPodSync.mockReturnValue({
        queryGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
        getMetrics: vi.fn().mockResolvedValue({}),
        indexWorkspace: vi.fn().mockResolvedValue(undefined),
    });
});

/** Every handler here must reject these without reaching a service. */
const rejects: Array<[string, (a: unknown) => Promise<any>, unknown]> = [
    ["get_incident_context / missing incidentId", handleGetIncidentContext, {}],
    ["get_incident_context / incidentId as string", handleGetIncidentContext, { incidentId: "12" }],
    ["resolve_incident / missing resolution+strategy", handleResolveAntigravityIncident, { incidentId: 1 }],
    ["resolve_incident / strategy not in enum", handleResolveAntigravityIncident, { incidentId: 1, resolution: "fixed", strategy: "teleport" }],
    ["list_incidents / status wrong type", handleListAntigravityIncidents, { status: 42 }],
    ["list_incidents / limit above declared max", handleListAntigravityIncidents, { limit: 5000 }],
    ["gms_score_blueprint / missing blueprint", handleGMSScoreBlueprint, {}],
    ["gms_synthesize / missing request", handleGMSSynthesizeMissions, {}],
    ["gms_synthesize / request wrong type", handleGMSSynthesizeMissions, { request: 7 }],
    ["gms_shadow_validate / candidates not an array", handleGMSShadowValidate, { candidates: "nope" }],
    ["gms_shadow_validate / isolationLevel not in enum", handleGMSShadowValidate, { candidates: [], isolationLevel: "quantum" }],
    ["gms_find_skills / missing query", handleGMSFindSkills, {}],
    ["gms_evolve_skill / missing skillId", handleGMSEvolveSkill, {}],
    ["gms_compose_mission / missing goal", handleGMSComposeMission, {}],
    ["get_hidden_state / missing contextId", handleGetHiddenStateEstimate, {}],
    ["predict_outcomes / predicates not an array", handlePredictOutcomes, { contextId: "c1", predicates: "a,b" }],
    ["predict_outcomes / predicates not strings", handlePredictOutcomes, { contextId: "c1", predicates: [1, 2] }],
    ["explain_prediction / missing predictionId", handleExplainPrediction, { contextId: "c1" }],
    ["xray_find / missing q", handleXRayFind, {}],
    ["xray_impact / missing symbolName", handleXRayImpact, {}],
    ["xray_explore / depth wrong type", handleXRayExplore, { depth: "deep" }],
    ["query_code_graph / missing slug", handleQueryCodeGraph, {}],
    ["get_code_metrics / slug wrong type", handleGetCodeMetrics, { slug: 99 }],
    ["index_workspace / missing slug", handleIndexWorkspace, {}],
    ["null args", handleGetCodeMetrics, null],
    ["non-object args", handleQueryCodeGraph, "slug-as-a-bare-string"],
];

describe("MCP handler argument validation", () => {
    it.each(rejects)("rejects %s", async (_label, handler, args) => {
        const result = await handler(args);
        expect(result).toMatchObject({ isError: true });

        // Assert it failed *validation*, not something downstream. Without this the
        // test passes vacuously: the old unvalidated handlers also returned an error
        // envelope, just from a later failure (e.g. "Incident 1 not found" after the
        // bad args had already reached the database).
        const text = String(result.content?.[0]?.text ?? "");
        expect(text).toMatch(/Invalid arguments|Missing required field|must be a|args must be an object/);
    });

    it("rejects bad args without touching the database", async () => {
        await handleGetIncidentContext({});
        await handleResolveAntigravityIncident({ incidentId: 1 });
        expect(h.dbSelect).not.toHaveBeenCalled();
    });

    it("rejects bad args without touching the xray service", async () => {
        await handleXRayFind({});
        await handleXRayImpact({});
        expect(h.findSymbols).not.toHaveBeenCalled();
    });

    it("rejects bad args without touching the prediction pods", async () => {
        await handleGetHiddenStateEstimate({});
        await handlePredictOutcomes({ contextId: "c1", predicates: "not-an-array" });
        expect(h.estimate).not.toHaveBeenCalled();
    });

    it("lets well-formed args through to the service layer", async () => {
        await handleXRayFind({ q: "searchTerm" });
        expect(h.findSymbols).toHaveBeenCalled();

        await handleGetCodeMetrics({ slug: "my-app" });
        expect(h.getPodSync).toHaveBeenCalled();
    });

    it("applies the schema's declared defaults", async () => {
        // limit defaults to 10 and depth to 3; neither is supplied here.
        await handleXRayExplore({});
        expect(h.collectFiles).toHaveBeenCalledWith(expect.any(String), 3);
    });
});
