import { OrchestrationContext } from "../orchestration/types.js";

export interface ActionContext extends OrchestrationContext {
    mlPredictedStrategy: string;
    mlCycleStartMs: number;
    currentCycle: number;
    appendTrace: (missionRunId: number, traceEntry: Record<string, unknown>) => Promise<void>;
    trackAsset: (missionRunId: number, asset: Record<string, unknown>) => Promise<void>;
}

/** Returned by a handler that needs to pause the mission cycle (e.g. debug breakpoint). */
export interface PausedResult {
    status: "paused";
    reason: string;
    debug: boolean;
}

/** Every AI decision shares these base fields. */
export interface BaseDecision {
    action: string;
    thought_process?: string;
    params?: Record<string, unknown>;
    action_details?: Record<string, unknown>;
}

// ── Per-action typed decisions ────────────────────────────────────────────────

export interface CallToolDecision extends BaseDecision {
    action: "CALL_TOOL";
    action_details?: {
        tool_name: string;
        arguments?: Record<string, unknown>;
    };
}

export interface ConcludeDecision extends BaseDecision {
    action: "CONCLUDE" | "CONCLUDE_MISSION";
    action_details?: {
        final_product?: string;
    };
}

export interface FailDecision extends BaseDecision {
    action: "FAIL";
}

export interface HilRequestDecision extends BaseDecision {
    action: "HIL_REQUEST";
    action_details?: {
        question?: string;
    };
}

export interface DelegateDecision extends BaseDecision {
    action: "DELEGATE";
    action_details?: {
        task_description?: string;
        allowed_tools?: string[];
        agent_name?: string;
    };
}

export interface LaunchSubmissionDecision extends BaseDecision {
    action: "LAUNCH_SUBMISSION";
    action_details?: {
        mission_name?: string;
        objective?: string;
    };
}

export interface ExtractBlueprintDecision extends BaseDecision {
    action: "EXTRACT_BLUEPRINT";
    action_details?: {
        app_slug?: string;
        blueprint_name?: string;
    };
}

export interface ArchiveAssetDecision extends BaseDecision {
    action: "ARCHIVE_ASSET";
    action_details?: {
        app_slug?: string;
        asset_type?: string;
    };
}

export interface SynthesizedToolDraft {
    name: string;
    code: string;
    language?: string;
    description?: string;
}

export interface SynthesizeToolDecision extends BaseDecision {
    action: "SYNTHESIZE_TOOL";
    action_details?: {
        new_tool?: SynthesizedToolDraft;
    };
}

export interface ThinkStepDecision extends BaseDecision {
    action: "THINK_STEP";
}

export type AnyDecision =
    | CallToolDecision
    | ConcludeDecision
    | FailDecision
    | HilRequestDecision
    | DelegateDecision
    | LaunchSubmissionDecision
    | ExtractBlueprintDecision
    | ArchiveAssetDecision
    | SynthesizeToolDecision
    | ThinkStepDecision
    | BaseDecision; // fallback for unknown actions

export interface ActionHandler {
    execute(ctx: ActionContext, decision: BaseDecision): Promise<PausedResult | void>;
}
