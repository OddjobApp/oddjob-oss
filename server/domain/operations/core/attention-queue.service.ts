import { db } from "@server/database_service.js";
import {
    approvalRequests,
    missionRuns,
    operationalCycles,
    saasConnectors,
} from "@shared/schema/index.js";
import {
    deriveFailureDiagnosis,
    type AttentionKind,
    type AttentionQueueItem,
    type AttentionQueueResponse,
    type AttentionSeverity,
} from "@shared/operations-attention.js";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

type ApprovalRow = Pick<typeof approvalRequests.$inferSelect,
    "id" | "organizationId" | "missionId" | "modifiedOutput" | "toolName" | "createdAt"
>;
type MissionRow = Pick<typeof missionRuns.$inferSelect,
    "id" | "organizationId" | "missionId" | "name" | "status" | "failureReason" | "resumeCondition" | "updatedAt" | "missionContext"
>;
type CycleRow = Pick<typeof operationalCycles.$inferSelect,
    "id" | "organizationId" | "name" | "status" | "budgetLimitUsd" | "currentSpendUsd" | "updatedAt"
>;
type ConnectionRow = Pick<typeof saasConnectors.$inferSelect,
    "id" | "orgId" | "platform" | "status" | "lastSync" | "updatedAt"
>;

export interface AttentionQueueRows {
    approvals: ApprovalRow[];
    missions: MissionRow[];
    cycles: CycleRow[];
    connections: ConnectionRow[];
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
};

export class AttentionQueueService {
    async list(organizationId: number, limit = 20): Promise<AttentionQueueResponse> {
        const [approvals, missions, cycles, connections] = await Promise.all([
            db.select({
                id: approvalRequests.id,
                organizationId: approvalRequests.organizationId,
                missionId: approvalRequests.missionId,
                modifiedOutput: approvalRequests.modifiedOutput,
                toolName: approvalRequests.toolName,
                createdAt: approvalRequests.createdAt,
            })
                .from(approvalRequests)
                .where(and(
                    eq(approvalRequests.organizationId, organizationId),
                    eq(approvalRequests.status, "pending"),
                ))
                .orderBy(asc(approvalRequests.createdAt))
                .limit(50)
                .catch(() => []),
            db.select({
                id: missionRuns.id,
                organizationId: missionRuns.organizationId,
                missionId: missionRuns.missionId,
                name: missionRuns.name,
                status: missionRuns.status,
                failureReason: missionRuns.failureReason,
                resumeCondition: missionRuns.resumeCondition,
                updatedAt: missionRuns.updatedAt,
                missionContext: missionRuns.missionContext,
            })
                .from(missionRuns)
                .where(and(
                    eq(missionRuns.organizationId, organizationId),
                    inArray(missionRuns.status, ["failed", "waiting_on_human", "waiting_on_file"]),
                    isNull(missionRuns.deletedAt),
                ))
                .limit(50)
                .catch(() => []),
            db.select({
                id: operationalCycles.id,
                organizationId: operationalCycles.organizationId,
                name: operationalCycles.name,
                status: operationalCycles.status,
                budgetLimitUsd: operationalCycles.budgetLimitUsd,
                currentSpendUsd: operationalCycles.currentSpendUsd,
                updatedAt: operationalCycles.updatedAt,
            })
                .from(operationalCycles)
                .where(and(
                    eq(operationalCycles.organizationId, organizationId),
                    inArray(operationalCycles.status, ["pending_approval", "active", "paused"]),
                    isNull(operationalCycles.deletedAt),
                ))
                .limit(50)
                .catch(() => []),
            db.select({
                id: saasConnectors.id,
                orgId: saasConnectors.orgId,
                platform: saasConnectors.platform,
                status: saasConnectors.status,
                lastSync: saasConnectors.lastSync,
                updatedAt: saasConnectors.updatedAt,
            })
                .from(saasConnectors)
                .where(eq(saasConnectors.orgId, organizationId))
                .limit(50)
                .catch(() => []),
        ]);

        return buildAttentionQueue({ approvals, missions, cycles, connections }, new Date(), limit);
    }
}

export function buildAttentionQueue(
    rows: AttentionQueueRows,
    now = new Date(),
    limit = 20,
): AttentionQueueResponse {
    const items = [
        ...rows.approvals.map((row) => approvalItem(row, now)),
        ...rows.missions.map((row) => missionItem(row, now)),
        ...rows.cycles.flatMap((row) => cycleItems(row, now)),
        ...rows.connections.flatMap((row) => connectionItems(row, now)),
    ].sort(compareAttentionItems);
    const visibleItems = items.slice(0, Math.max(1, Math.min(limit, 100)));

    return {
        generatedAt: now.toISOString(),
        items: visibleItems,
        summary: {
            total: items.length,
            critical: countSeverity(items, "critical"),
            high: countSeverity(items, "high"),
            medium: countSeverity(items, "medium"),
            low: countSeverity(items, "low"),
            byKind: {
                approval: countKind(items, "approval"),
                mission: countKind(items, "mission"),
                cycle: countKind(items, "cycle"),
                connection: countKind(items, "connection"),
            },
        },
    };
}

function approvalItem(row: ApprovalRow, now: Date): AttentionQueueItem {
    const output = asRecord(row.modifiedOutput);
    const rawRisk = String(output.risk ?? "medium").toLowerCase();
    const ageMinutes = minutesSince(row.createdAt, now);
    const severity = normalizeRisk(rawRisk, ageMinutes >= 5 && rawRisk === "high");
    const tool = String(output.tool ?? row.toolName ?? "Governed action");
    const description = String(output.description ?? output.goal ?? "Approval is blocking autonomous work.");

    return {
        id: `approval:${row.id}`,
        kind: "approval",
        severity,
        title: `${tool} needs approval`,
        summary: description,
        status: "pending approval",
        occurredAt: row.createdAt.toISOString(),
        ageMinutes,
        href: "/control/decisions",
        actionLabel: "Review decision",
        organizationId: row.organizationId!,
        metadata: { approvalId: row.id, missionId: row.missionId ?? null },
    };
}

function missionItem(row: MissionRow, now: Date): AttentionQueueItem {
    const ageMinutes = minutesSince(row.updatedAt, now);
    const isFailed = row.status === "failed";
    const waitingForHuman = row.status === "waiting_on_human";
    const waitingForFile = row.status === "waiting_on_file";
    const severity: AttentionSeverity = isFailed
        ? "critical"
        : waitingForHuman || ageMinutes >= 60 ? "high" : "medium";

    // Failed runs: surface the real diagnosis (from failureReason / missionContext) plus a fix
    // recommendation and the recovery strategy the action button should apply.
    const diagnosis = isFailed
        ? deriveFailureDiagnosis(row.missionContext as Record<string, any> | null, row.failureReason)
        : null;

    const summary = diagnosis
        ? diagnosis.problem
        : waitingForHuman
            ? "The run is paused until a person reviews or supplies a decision."
            : waitingForFile
                ? "The run is waiting for a required file or external input."
                : "The run is blocked.";

    return {
        id: `mission:${row.id}`,
        kind: "mission",
        severity,
        title: row.name,
        summary,
        status: row.status.replace(/_/g, " "),
        occurredAt: row.updatedAt.toISOString(),
        ageMinutes,
        href: row.missionId
            ? `/operations/missions/${row.missionId}/runs/${row.id}`
            : `/mission-runs/${row.id}`,
        actionLabel: isFailed ? "Diagnose run" : "Open run",
        organizationId: row.organizationId!,
        ...(diagnosis
            ? {
                recommendation: diagnosis.recommendation,
                recovery: { strategy: diagnosis.suggestedStrategy, missionRunId: row.id },
            }
            : {}),
        metadata: {
            missionRunId: row.id,
            resumeType: row.resumeCondition?.type ?? null,
        },
    };
}

function cycleItems(row: CycleRow, now: Date): AttentionQueueItem[] {
    const ageMinutes = minutesSince(row.updatedAt, now);
    const spend = Number(row.currentSpendUsd ?? 0);
    const budget = Number(row.budgetLimitUsd ?? 0);
    const items: AttentionQueueItem[] = [];

    if (budget > 0 && spend > budget) {
        items.push({
            id: `cycle-budget:${row.id}`,
            kind: "cycle",
            severity: "critical",
            title: `${row.name} exceeded budget`,
            summary: `Current spend is $${spend.toFixed(2)} against a $${budget.toFixed(2)} limit.`,
            status: "budget exceeded",
            occurredAt: row.updatedAt.toISOString(),
            ageMinutes,
            href: `/operations/cycles/${row.id}`,
            actionLabel: "Review cycle",
            organizationId: row.organizationId!,
            metadata: { cycleId: row.id, spend, budget },
        });
    }

    if (row.status === "pending_approval") {
        items.push({
            id: `cycle-approval:${row.id}`,
            kind: "cycle",
            severity: ageMinutes >= 60 ? "high" : "medium",
            title: `${row.name} is awaiting approval`,
            summary: "The cycle cannot proceed until its launch or plan is reviewed.",
            status: "pending approval",
            occurredAt: row.updatedAt.toISOString(),
            ageMinutes,
            href: `/operations/cycles/${row.id}`,
            actionLabel: "Review cycle",
            organizationId: row.organizationId!,
            metadata: { cycleId: row.id },
        });
    }

    return items;
}

function connectionItems(row: ConnectionRow, now: Date): AttentionQueueItem[] {
    const status = row.status.toLowerCase();
    const unhealthy = ["error", "failed", "degraded", "disconnected", "inactive"].includes(status);
    const referenceTime = row.lastSync ?? row.updatedAt;
    const ageMinutes = minutesSince(referenceTime, now);
    const stale = !unhealthy && ageMinutes >= 24 * 60;
    if (!unhealthy && !stale) return [];

    const severity: AttentionSeverity = ["error", "failed"].includes(status)
        ? "critical"
        : status === "degraded" || stale ? "high" : "medium";

    return [{
        id: `connection:${row.id}`,
        kind: "connection",
        severity,
        title: `${titleCase(row.platform)} connection ${stale ? "is stale" : "needs attention"}`,
        summary: stale
            ? `No successful sync has been recorded for ${formatAge(ageMinutes)}.`
            : `Connector status is ${status}. Verify credentials and connectivity.`,
        status: stale ? "stale" : status,
        occurredAt: referenceTime.toISOString(),
        ageMinutes,
        href: "/connections",
        actionLabel: "Check connection",
        organizationId: row.orgId,
        metadata: { connectorId: row.id, platform: row.platform },
    }];
}

function compareAttentionItems(left: AttentionQueueItem, right: AttentionQueueItem) {
    const severityDifference = SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity];
    if (severityDifference !== 0) return severityDifference;
    return right.ageMinutes - left.ageMinutes;
}

function normalizeRisk(risk: string, agedHighRisk: boolean): AttentionSeverity {
    if (agedHighRisk || risk === "critical") return "critical";
    if (risk === "high") return "high";
    if (risk === "low") return "low";
    return "medium";
}

function minutesSince(value: Date, now: Date) {
    return Math.max(0, Math.floor((now.getTime() - value.getTime()) / 60_000));
}

function formatAge(minutes: number) {
    if (minutes < 60) return `${minutes} minutes`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)} hours`;
    return `${Math.floor(minutes / 1440)} days`;
}

function titleCase(value: string) {
    return value.replace(/[_-]/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function countSeverity(items: AttentionQueueItem[], severity: AttentionSeverity) {
    return items.filter((item) => item.severity === severity).length;
}

function countKind(items: AttentionQueueItem[], kind: AttentionKind) {
    return items.filter((item) => item.kind === kind).length;
}

export const attentionQueueService = new AttentionQueueService();
