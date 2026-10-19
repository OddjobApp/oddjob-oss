import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { knowledgeNodes } from "@shared/schema/index.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";

/**
 * Operational workflow nodes on the knowledge-graph canvas: a tool or SaaS action,
 * a human review gate, or a scaffold pack, placed beside calculations.
 *
 * They used to exist only on the canvas, gone after a reload, and their Run button
 * posted to /api/tools/execute, which no route served. A node is now a knowledge
 * node (label OperationalWorkflow) in its organization, and Run asks for approval
 * in the Decision Inbox instead of running anything. Approving runs the node's
 * tool through the governed tool executor with the approver's authority; a review
 * gate's approval is itself the outcome; a rejection is recorded on the node. A
 * node whose tool this platform does not have, and a scaffold pack, cannot be run,
 * and the person is told so before anyone is asked to approve.
 */

export const WORKFLOW_NODE_LABEL = "OperationalWorkflow";

const createInput = z.object({
    name: z.string().trim().min(1).max(200),
    kind: z.enum(["tool", "saas", "scaffold_pack", "hil_gate"]),
    category: z.string().max(100).optional(),
    target: z.string().trim().min(1).max(200),
    config: z.record(z.unknown()).default({}),
});

export type WorkflowNodeStatus = "idle" | "pending_approval" | "success" | "failed" | "rejected";

export interface WorkflowNodeRun {
    approvalId: number;
    requestedBy: string;
    requestedAt: string;
    decidedBy?: string | null;
    decidedAt?: string;
    output?: string;
    error?: string;
}

export interface WorkflowNodeData {
    kind: z.infer<typeof createInput>["kind"];
    category?: string;
    target: string;
    config: Record<string, unknown>;
    status: WorkflowNodeStatus;
    lastRun?: WorkflowNodeRun;
}

/** What a Run approval request carries. Decisions read this stored copy, never an approver's edit of it. */
export interface WorkflowNodeRunRequest {
    kind: "workflow_node_run";
    nodeId: number;
    nodeName: string;
    nodeKind: WorkflowNodeData["kind"];
    /** The registered tool that runs on approval; null for a review gate. */
    tool: string | null;
    params: Record<string, unknown>;
    description: string;
    stepName: string;
    riskLevel: "medium";
}

export interface ToolRunContext {
    organizationId: number;
    userId: string;
    isAdmin: boolean;
    isOrgAdmin: boolean;
    isSuperAdmin: boolean;
}

export interface WorkflowNodeDeps {
    /** The registered tool's canonical name, or null when the platform has no tool by that name. */
    toolNamed(name: string): Promise<string | null>;
    /** Runs a tool through the governed tool executor and returns its output. */
    runTool(tool: string, params: Record<string, unknown>, context: ToolRunContext): Promise<string>;
    requestApproval(input: { organizationId: number; executionId: string; approverId: string; approverEmail: string; context: WorkflowNodeRunRequest }): Promise<{ id: number }>;
    now(): Date;
}

export type RunDecisionOutcome =
    | { handled: false }
    | { handled: true; success: boolean; status: WorkflowNodeStatus; output?: string; error?: string };

const OUTPUT_LIMIT = 4000;

export function createWorkflowNodes(deps: WorkflowNodeDeps) {
    const scope = (id: number, organizationId: number) =>
        and(eq(knowledgeNodes.id, id), eq(knowledgeNodes.label, WORKFLOW_NODE_LABEL), eq(knowledgeNodes.organizationId, organizationId));

    async function load(id: number, organizationId: number) {
        const [node] = await db.select().from(knowledgeNodes).where(scope(id, organizationId)).limit(1);
        if (!node) throw new NotFoundError("Workflow node not found.");
        return { node, data: (node.data ?? {}) as WorkflowNodeData };
    }

    async function save(id: number, organizationId: number, data: WorkflowNodeData) {
        await db.update(knowledgeNodes).set({ data, updatedAt: deps.now() }).where(scope(id, organizationId));
    }

    return {
        async create(input: unknown, owner: { organizationId: number; userId: string }) {
            const parsed = createInput.safeParse(input);
            if (!parsed.success) {
                throw new BadRequestError(`Invalid workflow node: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")}`);
            }
            const { name, ...rest } = parsed.data;
            const data: WorkflowNodeData = { ...rest, status: "idle" };
            const [node] = await db.insert(knowledgeNodes).values({
                label: WORKFLOW_NODE_LABEL, name, data, organizationId: owner.organizationId,
                sourceType: "manual", fidelityClass: "operational", scope: "org", createdBy: owner.userId,
            }).returning();
            return node;
        },

        /** Ask for approval to run a node. A node already waiting keeps its request rather than getting a second. */
        async requestRun(id: number, requester: { organizationId: number; userId: string; email: string }) {
            const { node, data } = await load(id, requester.organizationId);
            if (data.status === "pending_approval" && data.lastRun?.approvalId) {
                return { status: "pending_approval" as const, approvalId: data.lastRun.approvalId, alreadyPending: true };
            }
            if (data.kind === "scaffold_pack") {
                throw new BadRequestError(`"${node.name}" is a scaffold pack. Scaffold packs are added to an app in App Studio; they are not run from the canvas.`);
            }
            let tool: string | null = null;
            if (data.kind !== "hil_gate") {
                tool = await deps.toolNamed(data.target);
                if (!tool) throw new BadRequestError(`"${node.name}" runs ${data.target}, and this platform has no tool by that name, so there is nothing to approve.`);
            }

            const at = deps.now();
            const request: WorkflowNodeRunRequest = {
                kind: "workflow_node_run", nodeId: node.id, nodeName: node.name, nodeKind: data.kind, tool, params: data.config ?? {},
                description: tool ? `Run ${tool} for the canvas node "${node.name}".` : `Sign off the review gate "${node.name}".`,
                stepName: node.name, riskLevel: "medium",
            };
            // The id ends in a letter and a timestamp: the Decision Inbox reads an id ending
            // ":<digits>" as a mission run, and approval resumption reads trailing digits
            // that fit an integer as a pipeline step.
            const approval = await deps.requestApproval({
                organizationId: requester.organizationId, executionId: `workflow_node_run:${node.id}:t${at.getTime()}`,
                approverId: requester.userId, approverEmail: requester.email, context: request,
            });
            await save(node.id, requester.organizationId, {
                ...data, status: "pending_approval",
                lastRun: { approvalId: approval.id, requestedBy: requester.email, requestedAt: at.toISOString() },
            });
            return { status: "pending_approval" as const, approvalId: approval.id, alreadyPending: false };
        },

        /** Called by approvalService.processDecision with the stored request. */
        async onRunDecision(
            request: { id: number; organizationId: number | null; modifiedOutput: unknown },
            decision: "approved" | "rejected",
            decider: { userId: string; email: string | null; adminRole?: { isOrgAdmin?: boolean; organizationId?: number | null } | null },
        ): Promise<RunDecisionOutcome> {
            const run = request.modifiedOutput as WorkflowNodeRunRequest | null;
            if (run?.kind !== "workflow_node_run" || request.organizationId == null) return { handled: false };
            const organizationId = request.organizationId;
            const { data } = await load(run.nodeId, organizationId);
            const decidedAt = deps.now().toISOString();
            const lastRun: WorkflowNodeRun = {
                ...(data.lastRun ?? { requestedBy: "", requestedAt: decidedAt }),
                approvalId: request.id, decidedBy: decider.email, decidedAt,
            };

            if (decision === "rejected") {
                await save(run.nodeId, organizationId, { ...data, status: "rejected", lastRun });
                return { handled: true, success: true, status: "rejected" };
            }
            if (!run.tool) {
                const output = `Signed off by ${decider.email ?? "an approver"}.`;
                await save(run.nodeId, organizationId, { ...data, status: "success", lastRun: { ...lastRun, output } });
                return { handled: true, success: true, status: "success", output };
            }

            const isOrgAdmin = Boolean(decider.adminRole?.isOrgAdmin && decider.adminRole.organizationId === organizationId);
            let output: string;
            try {
                output = String(await deps.runTool(run.tool, run.params ?? {}, { organizationId, userId: decider.userId, isAdmin: isOrgAdmin, isOrgAdmin, isSuperAdmin: false }));
            } catch (error) {
                output = `Error: ${(error as Error)?.message ?? error}`;
            }
            const text = output.slice(0, OUTPUT_LIMIT);
            // The tool executor reports refusals and failures as text starting "Error".
            if (/^\s*error\b/i.test(text)) {
                await save(run.nodeId, organizationId, { ...data, status: "failed", lastRun: { ...lastRun, error: text } });
                return { handled: true, success: false, status: "failed", error: text };
            }
            await save(run.nodeId, organizationId, { ...data, status: "success", lastRun: { ...lastRun, output: text } });
            return { handled: true, success: true, status: "success", output: text };
        },
    };
}

export const workflowNodes = createWorkflowNodes({
    async toolNamed(name) {
        const { getAgentTools, normalizeToolName } = await import("@domain/tools/v1/tool-registry.service.js");
        const canonical = normalizeToolName(name);
        return getAgentTools()[canonical] ? canonical : null;
    },
    async runTool(tool, params, context) {
        const { getAgentTools } = await import("@domain/tools/v1/tool-registry.service.js");
        const { ToolExecutor } = await import("@domain/tools/v1/tool-executor.service.js");
        const definition = getAgentTools()[tool];
        return ToolExecutor.execute(tool, params, context, definition ? [definition] : [], false, "none");
    },
    async requestApproval({ organizationId, executionId, approverId, approverEmail, context }) {
        const { approvalService } = await import("@domain/integrations/core/approval.service.js");
        const request = await approvalService.createApprovalRequest({
            executionId, approverType: "internal", approverId, approverEmail, status: "pending", organizationId, context,
        });
        return { id: request.id };
    },
    now: () => new Date(),
});
