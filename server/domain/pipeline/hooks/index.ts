import { hookRegistry } from "./execution-hooks.js";
import { KnowledgeGraphHook } from "./kg-hooks.js";
import { DatasetHook } from "./dataset-hooks.js";
import { AIAnalyticsHook } from "./analytics-hooks.js";
import { KnowledgeStoreHook } from "./store-hooks.js";
import { ReportingHook } from "./reporting-hooks.js";
import { SupervisorResumeHook } from "./supervisor-resume-hook.js";
import { MissionCheckpointHook } from "./mission-checkpoint-hook.js";
import { SelfAssessmentHook } from "./self-assessment-hook.js";
import { GoldenPathHook } from "./golden-path-hook.js";
import { FailedTraceHook } from "./failed-trace-hook.js";

export function initializeHooks() {
    console.log("[Hooks] Initializing hooks...");
    hookRegistry.register(new KnowledgeGraphHook());
    hookRegistry.register(new DatasetHook());
    hookRegistry.register(new AIAnalyticsHook());
    hookRegistry.register(new KnowledgeStoreHook());
    hookRegistry.register(new ReportingHook());
    hookRegistry.register(new SupervisorResumeHook());
    hookRegistry.register(new MissionCheckpointHook());
    hookRegistry.register(new SelfAssessmentHook());
    hookRegistry.register(new GoldenPathHook());
    hookRegistry.register(new FailedTraceHook());
}


