import { randomUUID } from "crypto";
import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { BranchGenealogyInput, BranchGenealogyEvent, BranchGenealogyEventType, PruningDecisionType } from "../types.js";
import { makePruningManifest, successResult } from "./plugin-helpers.js";

const manifest = makePruningManifest({
    name: "branch-genealogy",
    subPod: "branch-genealogy",
    capability: "pruning.genealogy",
    description: "Updates branch ancestry and transformation history from pruning decisions (spec §19).",
    inputTypes: ["BranchGenealogyInput"],
    outputTypes: ["BranchGenealogyEvent[]"],
    timeoutMs: 10,
});

const DECISION_TO_EVENT: Record<PruningDecisionType, BranchGenealogyEventType> = {
    hard_prune: "pruned",
    soft_suppress: "suppressed",
    reserve: "reserved",
    merge: "merged",
    collapse: "collapsed",
    keep: "boosted",
};

export const branchGenealogyPlugin: PredictionPlugin<BranchGenealogyInput, BranchGenealogyEvent[]> = {
    manifest,

    async canHandle(input: BranchGenealogyInput): Promise<PluginDecision> {
        const ok = !!input?.predictionId && Array.isArray(input?.decisions);
        return {
            shouldRun: ok,
            reason: ok ? "valid genealogy input" : "missing predictionId or decisions",
            priority: 75,
            estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },

    async execute(input: BranchGenealogyInput, ctx: PluginContext): Promise<PluginResult<BranchGenealogyEvent[]>> {
        const startedAt = new Date().toISOString();
        const branchMap = new Map(input.branches.map(b => [b.id, b]));

        const events: BranchGenealogyEvent[] = input.decisions.map(decision => {
            const branch = branchMap.get(decision.branchId);
            return {
                id: randomUUID(),
                predictionId: input.predictionId,
                contextId: input.contextId,
                branchId: decision.branchId,
                parentBranchId: branch?.parentBranchId,
                eventType: DECISION_TO_EVENT[decision.decisionType],
                reason: decision.reason,
                evidenceIds: decision.evidenceIds,
                sourcePlugin: decision.pluginName,
                createdAt: ctx.now,
            };
        });

        return successResult(
            manifest,
            events,
            1,
            ctx,
            startedAt,
            "genealogy_update",
        );
    },

    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
