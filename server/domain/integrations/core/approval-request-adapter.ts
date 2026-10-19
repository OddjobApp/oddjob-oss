/**
 * Shape of an approval request as PlatformHILApprovalBlock renders it.
 *
 * The block (and the copies of it inside already-built apps) calls
 * /api/approval-requests, which never existed. The compatibility routes serve
 * that path from approvalService, and this mapping turns its rows into the
 * block's shape. Pure, so it can be tested without a database.
 */
export interface BlockApprovalRequest {
    id: number;
    type: "task" | "pipeline_step" | "agent_action" | "deployment";
    title: string;
    description?: string;
    requester: { id: number; name: string };
    context?: {
        pipelineName?: string;
        stepName?: string;
        action?: string;
        parameters?: Record<string, unknown>;
    };
    createdAt: string;
    status: "pending" | "approved" | "rejected" | "expired";
    priority: "low" | "medium" | "high" | "critical";
}

const PRIORITIES = new Set(["low", "medium", "high", "critical"]);
const STATUSES = new Set(["pending", "approved", "rejected", "expired"]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asText(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
}

export function toBlockApprovalRequest(row: Record<string, any>): BlockApprovalRequest {
    const modified = asRecord(row.modifiedOutput);
    const risk = asText(modified?.risk)?.toLowerCase();
    const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? "");

    return {
        id: Number(row.id),
        type: row.toolName ? "agent_action" : row.jobId ? "pipeline_step" : "task",
        title: asText(row.stepName) ?? asText(row.toolName) ?? "Approval required",
        description: asText(row.comments) ?? asText(modified?.description),
        requester: { id: 0, name: asText(row.pipelineName) ?? asText(row.approverEmail) ?? "Oddjob" },
        context: {
            pipelineName: asText(row.pipelineName),
            stepName: asText(row.stepName),
            action: asText(row.toolName),
            parameters: asRecord(row.toolArgs) ?? asRecord(modified?.params),
        },
        createdAt,
        status: STATUSES.has(row.status) ? row.status : "pending",
        priority: risk && PRIORITIES.has(risk) ? (risk as BlockApprovalRequest["priority"]) : "medium",
    };
}
