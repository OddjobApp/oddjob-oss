
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import type { SteeringVector } from "../../../ai/core/steering-vector.types.js";

export interface OrchestrationContext {
    missionRunId: number;
    missionId: number;
    userId: string;
    orgId: number | null;
    blackboard: Record<string, any>;
    missionContext: Record<string, any>;
    objective: string;
    allowedTools: string[];
    cycleCount: number;
    maxCycles: number;
    dynamicTrace?: any[];
    traceContext?: TraceContext;
    effectiveUserEmail: string;
    studentModelConfig?: {
        baseModel: string;
        adapterPath: string;
    };
    // Step sequence from the mission template (injected by orchestrator)
    stepSequence?: Array<{
        stepCode: string;
        action: string;
        description?: string;
        agent?: string;
        tool?: string;
        inputs?: string[];
        outputs?: string[];
        requiresHuman?: boolean;
        estimatedDurationMinutes?: number;
    }>;
    // Current step index (0-based) — tracks position in the sequence
    currentStepIndex?: number;
    // Mission execution strategy from the DB
    executionStrategy?: string;
    // Estimated duration for stall detection
    estimatedDurationHours?: number;
    /** Resolved behavioral steering vector for this cycle (PSBS) */
    steeringVector?: SteeringVector;
}

export interface OrchestrationThought {
    action: string;
    reasoning: string;
    params?: any;
    protocol: 'hermes' | 'json';
    rawResponse: string;
}
