import type { PredictionPlugin, PluginContext, PluginDecision, PluginResult, PluginHealth } from "../../plugin-runtime/types.js";
import type { PredictionModePlan, PredictionModePlanInput } from "../types.js";
import { normalizePredictionMode } from "../types.js";
import { clamp, makePredictionManifest, successResult } from "./plugin-helpers.js";

const manifest = makePredictionManifest({
    name: "prediction-mode-planner",
    subPod: "mode-planner",
    capability: "prediction.plan_mode",
    description: "Determines branch depth, chamber execution, alternatives, and timeout by mode.",
    inputTypes: ["PredictionModePlanInput"],
    outputTypes: ["PredictionModePlan"],
    timeoutMs: 5,
    producesPrediction: false,
});

const MODE_DEFAULTS: Record<PredictionModePlan["mode"], Omit<PredictionModePlan, "mode">> = {
    realtime: {
        maxBranches: 8,
        maxDepth: 1,
        runForwardChamber: true,
        runReverseChamber: false,
        runBicameral: false,
        includeAlternatives: true,
        includePatternMemory: false,
        timeoutMs: 100,
    },
    interactive: {
        maxBranches: 20,
        maxDepth: 2,
        runForwardChamber: true,
        runReverseChamber: true,
        runBicameral: true,
        includeAlternatives: true,
        includePatternMemory: true,
        timeoutMs: 500,
    },
    analysis: {
        maxBranches: 80,
        maxDepth: 4,
        runForwardChamber: true,
        runReverseChamber: true,
        runBicameral: true,
        includeAlternatives: true,
        includePatternMemory: true,
        timeoutMs: 3000,
    },
    batch: {
        maxBranches: 100,
        maxDepth: 5,
        runForwardChamber: true,
        runReverseChamber: true,
        runBicameral: true,
        includeAlternatives: true,
        includePatternMemory: true,
        timeoutMs: 10000,
    },
};

export const predictionModePlannerPlugin: PredictionPlugin<PredictionModePlanInput, PredictionModePlan> = {
    manifest,
    async canHandle(input: PredictionModePlanInput): Promise<PluginDecision> {
        const ok = !!input?.context?.id && !!input?.mode;
        return {
            shouldRun: ok,
            reason: ok ? "valid prediction mode input" : "missing context or mode",
            priority: 100,
            estimatedCost: { latencyMs: 1, dbReads: 0, vectorQueries: 0, agentCalls: 0 },
        };
    },
    async execute(input: PredictionModePlanInput, ctx: PluginContext): Promise<PluginResult<PredictionModePlan>> {
        const startedAt = new Date().toISOString();
        const mode = normalizePredictionMode(input.mode);
        const defaults = MODE_DEFAULTS[mode];
        const highUncertainty = input.quantField.fieldEntropy > 0.6 || input.quantField.fieldDivergence > 0.55;
        const highRisk = input.riskLevel === "high" || input.riskLevel === "critical";
        const timeoutMs = Math.min(input.latencyBudgetMs ?? defaults.timeoutMs, defaults.timeoutMs);

        const plan: PredictionModePlan = {
            mode,
            ...defaults,
            maxBranches: highUncertainty || highRisk ? defaults.maxBranches : Math.max(3, Math.ceil(defaults.maxBranches * 0.7)),
            includeAlternatives: defaults.includeAlternatives || highRisk,
            timeoutMs: Math.max(25, Math.round(clamp(timeoutMs, 25, defaults.timeoutMs))),
        };

        return successResult(manifest, plan, 1, ctx, startedAt, "mode_plan_lookup");
    },
    async health(): Promise<PluginHealth> {
        return { pluginName: manifest.name, pluginVersion: manifest.version, status: "healthy", lastCheckedAt: new Date().toISOString(), dependencyStatus: {} };
    },
};
