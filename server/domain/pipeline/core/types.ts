import type { Pipeline, PipelineStep, PipelineExecution } from "@shared/schema/index.js";

export type { OrgContext } from "../../../utils/auth-context.js";

export interface VectorKnowledgeConfig {
    enabled?: boolean;
    collectionName?: string;
    vectorStoreId?: string;
    embeddingModel?: string;
    searchConfig?: {
        topK?: number;
        threshold?: number;
    };
}

export interface DecisionNodeRoute {
    destinationStepId: number;
    condition?: string;
}

export interface DecisionNodeConfig {
    type: "if" | "switch" | "gatekeeper";
    expression?: string;
    routes: {
        onMatch: DecisionNodeRoute;
        onNoMatch?: DecisionNodeRoute;
    };
    defaultDestinationStepId?: number;
}

export interface RetryConfig {
    maxRetries: number;
    backoffMultiplier?: number;
    initialDelayMs?: number;
    retryOn?: ("failure" | "timeout" | "error")[];
}

export interface ForgeConfig {
    targetAppId?: number;
    blueprintSlug?: string;
    slotValues?: Record<string, unknown>;
    deploymentConfig?: {
        autoDeploy?: boolean;
        subdomain?: string;
    };
}

export interface EventConfig {
    eventType: string;
    filterCondition?: string;
}

export interface CreatePipelineInput {
    name: string;
    description?: string;
    isActive?: boolean;
    triggerType: string;
    triggerCredentialId?: number;
    eventConfig?: EventConfig;
    labels?: string[];
    monthlyBudgetUsd?: number | null;
    enableKnowledgeGraph?: boolean;
    knowledgeGraphConfig?: VectorKnowledgeConfig;
    steps: CreatePipelineStepInput[];
}

export interface CreatePipelineStepInput {
    jobId?: number;
    name?: string;
    order: number;
    inputMapping?: Record<string, unknown>;
    outputMapping?: Record<string, unknown>;
    condition?: string;
    onError?: "stop" | "continue" | "retry";
    maxRetries?: number;
    outputName?: string;
    runOnCondition?: string;
    waitDurationSeconds?: number;
    onFailureAction?: string;
    fallbackJobId?: number | null;
    parallelGroup?: string;
    conditionExpression?: string;
    moduleType?: string;
    destinationStepId?: number;
    decisionNodeConfig?: DecisionNodeConfig;
    knowledgeGraphConfig?: any;
    retryConfig?: RetryConfig;
    forgeConfig?: ForgeConfig;
    toolName?: string;
    toolArguments?: Record<string, unknown>;
    tempId?: string;
}

export interface UpdatePipelineInput extends Partial<Omit<CreatePipelineInput, "steps">> {
    steps?: CreatePipelineStepInput[];
}

export interface RunPipelineInput {
    input?: Record<string, unknown>;
    startStepId?: number;
    dryRun?: boolean;
    /** For mission-driven runs: link execution to workgroup/mission */
    missionId?: number;
    missionRunId?: number;
}

export interface PipelineListOptions {
    includeInactive?: boolean;
    limit?: number;
    offset?: number;
    pipelineIds?: number[];
}


