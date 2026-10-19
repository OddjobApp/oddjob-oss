import { db } from "@server/database_service.js";
import { jobs } from "@shared/schema/index.js";
import type {
    MissionPermissionPreview,
    MissionReadinessCheck,
    MissionReadinessRequest,
    MissionReadinessResponse,
} from "@shared/mission-readiness.js";
import { evaluateAutonomyPolicy, type AutonomyRiskLevel } from "@shared/governance/autonomy-policy.js";
import { and, eq, inArray } from "drizzle-orm";
import {
    missionDependencyResolver,
    type ValidateResult,
} from "./mission-dependency-resolver.service.js";

export interface MissionReadinessJobProfile {
    id: number;
    name: string;
    type: string;
    tool: string;
    dataClassification: string;
    isActive: boolean | null;
    lifecycleStatus: string;
    lastTestStatus: string | null;
}

const EXTERNAL_WRITE_TYPES = new Set(["slack_post", "email_send", "jira_sync", "confluence_sync", "google_drive_sync", "git_op"]);
const DATABASE_TYPES = new Set(["sql_query"]);
const FILESYSTEM_TYPES = new Set(["file_writer", "file_export", "file_ops", "folder_import"]);
const CODE_TYPES = new Set(["shell", "python", "node_script", "selenium", "computer_use"]);

export class MissionReadinessService {
    async assess(
        request: MissionReadinessRequest,
        organizationId: number,
    ): Promise<MissionReadinessResponse> {
        const dependencies = await missionDependencyResolver.validateAndResolve(request.members, organizationId);
        const jobIds = request.members
            .filter((member) => member.entityType === "job" && member.entityId)
            .map((member) => member.entityId!);
        const profiles = jobIds.length === 0 ? [] : await db.select({
            id: jobs.id,
            name: jobs.name,
            type: jobs.type,
            tool: jobs.tool,
            dataClassification: jobs.dataClassification,
            isActive: jobs.isActive,
            lifecycleStatus: jobs.lifecycleStatus,
            lastTestStatus: jobs.lastTestStatus,
        })
            .from(jobs)
            .where(and(
                eq(jobs.organizationId, organizationId),
                inArray(jobs.id, jobIds),
            ));

        return buildMissionReadiness(request, dependencies, profiles, new Date());
    }
}

export function buildMissionReadiness(
    request: MissionReadinessRequest,
    dependencies: ValidateResult,
    profiles: MissionReadinessJobProfile[],
    now = new Date(),
): MissionReadinessResponse {
    const checks: MissionReadinessCheck[] = [];
    const objectiveLength = request.objective.trim().length;
    const budget = Number(request.budgetLimitUsd ?? 0);
    const strategy = request.executionStrategy || "pre_planned";
    const strictness = request.hilStrictness || "moderate";
    const memberCount = request.members.length;
    const cloudTouchpoints = profiles.filter((profile) => EXTERNAL_WRITE_TYPES.has(profile.type) || profile.type.includes("api")).length;
    const codeTouchpoints = profiles.filter((profile) => CODE_TYPES.has(profile.type)).length;
    const strategyMultiplier = strategy === "parallel_fan_out" ? 0.75
        : strategy === "dynamic_autonomous" ? 1.45
            : strategy === "reactive" ? 1.2
                : strategy === "human_driven" ? 1.1 : 1;
    const estimatedMinutes = Math.max(3, Math.round((memberCount * 4 + cloudTouchpoints * 2 + codeTouchpoints) * strategyMultiplier));
    const estimatedCostUsd = Math.max(0.08, Number((memberCount * 0.18 + cloudTouchpoints * 0.2 + objectiveLength / 2500).toFixed(2)));

    checks.push(check(
        "identity",
        "identity",
        request.name.trim().length >= 3 && objectiveLength >= 20 ? "pass" : "block",
        "Mission purpose",
        objectiveLength >= 20 ? "Name and objective are defined." : "The objective is too short to evaluate safely.",
        "Provide a clear objective with the intended outcome and constraints.",
    ));
    checks.push(check(
        "team",
        "team",
        memberCount > 0 ? "pass" : "block",
        "Execution team",
        memberCount > 0 ? `${memberCount} execution member${memberCount === 1 ? "" : "s"} selected.` : "No agent or pipeline is assigned.",
        "Add at least one tested agent or pipeline.",
    ));
    checks.push(check(
        "dependencies",
        "dependencies",
        dependencies.valid ? "pass" : "block",
        "Dependencies and credentials",
        dependencies.valid
            ? "Referenced jobs, pipelines, credentials, forms, and API specifications resolve."
            : dependencies.blockers.slice(0, 3).join(" "),
        "Resolve every dependency blocker before launch.",
    ));

    const knowledgeCount = Number(request.knowledgeAssetCount ?? 0);
    checks.push(check(
        "knowledge",
        "knowledge",
        knowledgeCount > 0 ? "pass" : "warning",
        "Trusted knowledge",
        knowledgeCount > 0 ? `${knowledgeCount} source${knowledgeCount === 1 ? "" : "s"} will ground execution.` : "No trusted knowledge source is attached.",
        "Attach a policy, runbook, or reference document when the mission depends on organizational facts.",
    ));

    const budgetStatus = budget <= 0 ? "warning" : estimatedCostUsd > budget ? "block" : "pass";
    checks.push(check(
        "budget",
        "budget",
        budgetStatus,
        "Budget guard",
        budget <= 0
            ? `Estimated cost is $${estimatedCostUsd.toFixed(2)}, but no positive budget guard is configured.`
            : `Estimated cost is $${estimatedCostUsd.toFixed(2)} against a $${budget.toFixed(2)} limit.`,
        "Set a positive budget at or above the estimated dry-run cost.",
    ));

    const actionIntent = profiles.map((profile) => policyActionForType(profile.type)).filter(Boolean).join("; ");
    const policy = evaluateAutonomyPolicy({
        domain: "mission",
        goal: request.objective,
        action: actionIntent,
    });
    checks.push(check(
        "governance",
        "governance",
        policy.decision === "block" ? "block" : policy.decision === "review" ? "warning" : "pass",
        "Governance policy",
        policy.rationale,
        policy.decision === "block" ? "Remove sensitive intent or explicitly configure approved sensitive-data handling." : undefined,
    ));

    const hasSample = Boolean(request.sampleInput?.trim());
    const hasCriteria = Boolean(request.expectedCriteria?.trim()) || Boolean(request.targetMetric && Object.keys(request.targetMetric).length > 0);
    const untestedProfiles = profiles.filter((profile) => profile.lastTestStatus !== "success");
    const evaluationStatus = hasSample && hasCriteria && untestedProfiles.length === 0 ? "pass" : "warning";
    checks.push(check(
        "evaluation",
        "evaluation",
        evaluationStatus,
        "Evaluation evidence",
        evaluationStatus === "pass"
            ? "A sample input, expected criteria, and successful component tests are available."
            : `${hasSample ? "Sample input provided." : "Sample input missing."} ${hasCriteria ? "Expected criteria provided." : "Expected criteria missing."} ${untestedProfiles.length} component(s) lack a successful latest test.`,
        "Provide a representative sample and expected criteria, then test every selected agent.",
    ));

    const permissions = buildPermissionPreview(profiles);
    const blockingChecks = checks.filter((item) => item.status === "block");
    const score = readinessScore(checks);
    const riskLevel = maxRisk(policy.maxRiskLevel, permissions, strategy, strictness);
    const evaluationPassed = evaluationStatus === "pass";

    return {
        generatedAt: now.toISOString(),
        ready: blockingChecks.length === 0,
        score,
        riskLevel,
        promotionState: blockingChecks.length > 0 ? "draft" : evaluationPassed ? "tested" : "ready_for_test",
        estimatedMinutes,
        estimatedCostUsd,
        checks,
        permissions,
        approvalGates: [
            strictness === "strict" ? "Review every agent action" : strictness === "lenient" ? "Review high-risk actions" : "Review external or irreversible actions",
            budget > 0 ? `Stop when spend reaches $${budget.toFixed(2)}` : "Configure a positive budget before live execution",
            strategy === "dynamic_autonomous" ? "Review autonomous plan changes" : "Review mission launch",
            ...policy.flags.map((flag) => flag.message),
        ],
        dryRunPlan: [
            { sequence: 1, label: "Validate mission identity and expected outcome", mode: "inspect", touchesLiveSystems: false },
            { sequence: 2, label: "Resolve agents, credentials, tools, and knowledge", mode: "inspect", touchesLiveSystems: false },
            { sequence: 3, label: "Simulate execution order, cost, and permission use", mode: "simulate", touchesLiveSystems: false },
            { sequence: 4, label: "Compare sample output requirements and approval gates", mode: "review", touchesLiveSystems: false },
        ],
        policy,
    };
}

function buildPermissionPreview(profiles: MissionReadinessJobProfile[]): MissionPermissionPreview[] {
    const permissions = profiles.flatMap<MissionPermissionPreview>((profile) => {
        if (EXTERNAL_WRITE_TYPES.has(profile.type)) return [{ capability: profile.name, scope: "external", access: "write", reason: `${profile.type} can modify an external system.`, requiresApproval: true }];
        if (DATABASE_TYPES.has(profile.type)) return [{ capability: profile.name, scope: "database", access: "execute", reason: "SQL execution may read or mutate organizational data.", requiresApproval: true }];
        if (FILESYSTEM_TYPES.has(profile.type)) return [{ capability: profile.name, scope: "filesystem", access: "write", reason: "The job can create or modify files.", requiresApproval: true }];
        if (CODE_TYPES.has(profile.type)) return [{ capability: profile.name, scope: "code", access: "execute", reason: "The job can execute code or operate a browser/computer.", requiresApproval: true }];
        return [{ capability: profile.name, scope: "internal", access: "read", reason: "The job operates within the mission context.", requiresApproval: false }];
    });
    return permissions.filter((permission, index) => permissions.findIndex((candidate) => candidate.capability === permission.capability && candidate.scope === permission.scope) === index);
}

function policyActionForType(type: string) {
    if (type === "email_send") return "send email";
    if (type === "slack_post") return "send message";
    if (type === "git_op") return "merge to production";
    if (type === "file_ops") return "remove or modify files";
    if (type === "sql_query") return "execute database query";
    return type.replace(/_/g, " ");
}

function readinessScore(checks: MissionReadinessCheck[]) {
    const points = checks.reduce((sum, item) => sum + (item.status === "pass" ? 1 : item.status === "warning" ? 0.5 : 0), 0);
    return Math.round((points / checks.length) * 100);
}

function maxRisk(
    policyRisk: AutonomyRiskLevel,
    permissions: MissionPermissionPreview[],
    strategy: string,
    strictness: string,
): AutonomyRiskLevel {
    if (policyRisk === "critical") return "critical";
    if (policyRisk === "high" || permissions.some((permission) => permission.scope !== "internal")) return "high";
    if (policyRisk === "medium" || strategy === "dynamic_autonomous" || strictness === "lenient") return "medium";
    return "low";
}

function check(
    id: string,
    category: MissionReadinessCheck["category"],
    status: MissionReadinessCheck["status"],
    label: string,
    detail: string,
    remediation?: string,
): MissionReadinessCheck {
    return { id, category, status, label, detail, ...(remediation ? { remediation } : {}) };
}

export const missionReadinessService = new MissionReadinessService();

