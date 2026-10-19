import type { AutonomyPolicyEvaluation, AutonomyRiskLevel } from "./governance/autonomy-policy.js";

export type MissionReadinessCheckStatus = "pass" | "warning" | "block";
export type MissionReadinessCategory =
    | "identity"
    | "team"
    | "dependencies"
    | "knowledge"
    | "budget"
    | "governance"
    | "evaluation";

export interface MissionReadinessMemberInput {
    entityType: "job" | "pipeline";
    entityId?: number;
    role: string;
}

export interface MissionReadinessRequest {
    name: string;
    objective: string;
    budgetLimitUsd?: number;
    executionStrategy?: string;
    hilStrictness?: "lenient" | "moderate" | "strict";
    members: MissionReadinessMemberInput[];
    knowledgeAssetCount?: number;
    documentTemplateCount?: number;
    sampleInput?: string;
    expectedCriteria?: string;
    targetMetric?: Record<string, unknown>;
}

export interface MissionReadinessCheck {
    id: string;
    category: MissionReadinessCategory;
    status: MissionReadinessCheckStatus;
    label: string;
    detail: string;
    remediation?: string;
}

export interface MissionPermissionPreview {
    capability: string;
    scope: "internal" | "external" | "filesystem" | "database" | "code";
    access: "read" | "write" | "execute";
    reason: string;
    requiresApproval: boolean;
}

export interface MissionDryRunStep {
    sequence: number;
    label: string;
    mode: "inspect" | "simulate" | "review";
    touchesLiveSystems: false;
}

export interface MissionReadinessResponse {
    generatedAt: string;
    ready: boolean;
    score: number;
    riskLevel: AutonomyRiskLevel;
    promotionState: "draft" | "ready_for_test" | "tested";
    estimatedMinutes: number;
    estimatedCostUsd: number;
    checks: MissionReadinessCheck[];
    permissions: MissionPermissionPreview[];
    approvalGates: string[];
    dryRunPlan: MissionDryRunStep[];
    policy: AutonomyPolicyEvaluation;
}

