/** @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Phase 7, canvas workflow nodes, against a real database: a node placed on the
 * knowledge-graph canvas is saved in its organization, Run asks for approval
 * instead of running, and approving runs the tool (or signs off a review gate)
 * with the outcome recorded on the node. The tool runner is passed in for the tool
 * cases; the review gate goes through the real Decision Inbox decision.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { approvalRequests, knowledgeNodes, users } = await import("@shared/schema/index.js");
const { orgs } = await import("@shared/schema/auth.js");
const { approvalService } = await import("@domain/integrations/core/approval.service.js");
const { createWorkflowNodes, workflowNodes, WORKFLOW_NODE_LABEL } = await import("../../core/calculations/workflow-nodes.service.js");

let reachable = false;
try {
    await db.execute("SELECT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(
        `[workflow-nodes] SKIPPED — no test database reachable (${e?.message ?? e}). `
        + `Set TEST_DATABASE_URL and run npm run test:db:setup.`,
    );
}

const stamp = Date.now();

describe.skipIf(!reachable)("Canvas workflow nodes", () => {
    let orgId: number;
    let otherOrgId: number;
    const user = { id: `workflow-node-user-${stamp}`, email: `workflow-${stamp}@example.com` };
    const ran: Array<{ tool: string; params: Record<string, unknown>; context: any }> = [];
    let toolOutput = "Posted to #launch";
    const requester = () => ({ organizationId: orgId, userId: user.id, email: user.email });

    // Real approvals and storage; a recorded tool runner and a registry with one tool.
    const nodes = createWorkflowNodes({
        toolNamed: async (name) => (name === "slack_post_message" ? "slack_post_message" : null),
        runTool: async (tool, params, context) => { ran.push({ tool, params, context }); return toolOutput; },
        requestApproval: async ({ organizationId, executionId, approverId, approverEmail, context }) => {
            const request = await approvalService.createApprovalRequest({ executionId, approverType: "internal", approverId, approverEmail, status: "pending", organizationId, context });
            return { id: request.id };
        },
        now: () => new Date(),
    });
    const nodeRow = async (id: number) => (await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, id)))[0];

    beforeAll(async () => {
        const [org] = await db.insert(orgs).values({ name: `Workflow nodes ${stamp}`, slug: `workflow-nodes-${stamp}` } as any).returning();
        const [other] = await db.insert(orgs).values({ name: `Workflow nodes other ${stamp}`, slug: `workflow-nodes-other-${stamp}` } as any).returning();
        orgId = org.id;
        otherOrgId = other.id;
        await db.insert(users).values({ id: user.id, username: user.id, password: "not-used", email: user.email } as any);
    });

    afterAll(async () => {
        if (!orgId) return;
        await db.delete(approvalRequests).where(inArray(approvalRequests.organizationId, [orgId, otherOrgId]));
        await db.delete(knowledgeNodes).where(inArray(knowledgeNodes.organizationId, [orgId, otherOrgId]));
        // Recording a decision writes memories for the person and topics for the organization.
        await db.execute(sql`delete from agent_long_term_memories where user_id = ${user.id}`).catch(() => undefined);
        await db.execute(sql`delete from knowledge_topics where organization_id in (${orgId}, ${otherOrgId})`).catch(() => undefined);
        await db.delete(users).where(eq(users.id, user.id));
        await db.delete(orgs).where(inArray(orgs.id, [orgId, otherOrgId])).catch((error: any) => {
            console.warn(`[workflow-nodes] could not remove the test organizations: ${error?.message ?? error}`);
        });
    });

    it("saves a node placed on the canvas in its organization", async () => {
        const node = await nodes.create({ name: "Slack Channel Alert", kind: "saas", category: "messaging", target: "slack_post_message" }, { organizationId: orgId, userId: user.id });
        expect(node).toMatchObject({ label: WORKFLOW_NODE_LABEL, name: "Slack Channel Alert", organizationId: orgId, createdBy: user.id });
        expect(node.data).toEqual({ kind: "saas", category: "messaging", target: "slack_post_message", config: {}, status: "idle" });
        await expect(nodes.create({ name: "Bad", kind: "rocket", target: "x" }, { organizationId: orgId, userId: user.id })).rejects.toThrow(/Invalid workflow node: kind/);
    });

    it("asks for approval instead of running, and runs the tool with the approver's authority once approved", async () => {
        const node = await nodes.create({ name: "Launch alert", kind: "saas", target: "slack_post_message", config: { channel: "#launch", message: "Ready" } }, { organizationId: orgId, userId: user.id });
        const asked = await nodes.requestRun(node.id, requester());
        expect(asked).toMatchObject({ status: "pending_approval", alreadyPending: false });
        expect(ran).toEqual([]);

        const [approval] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, asked.approvalId));
        expect(approval).toMatchObject({ status: "pending", organizationId: orgId, approverEmail: user.email });
        expect(approval.executionId).toMatch(/^workflow_node_run:\d+:t\d+$/);
        expect(approval.modifiedOutput).toMatchObject({ kind: "workflow_node_run", nodeId: node.id, tool: "slack_post_message", params: { channel: "#launch", message: "Ready" } });
        expect((await nodeRow(node.id)).data).toMatchObject({ status: "pending_approval", lastRun: { approvalId: asked.approvalId, requestedBy: user.email } });
        expect(await nodes.requestRun(node.id, requester())).toEqual({ status: "pending_approval", approvalId: asked.approvalId, alreadyPending: true });

        const outcome = await nodes.onRunDecision(approval, "approved", { userId: user.id, email: user.email, adminRole: { isOrgAdmin: true, organizationId: orgId } });
        expect(outcome).toEqual({ handled: true, success: true, status: "success", output: "Posted to #launch" });
        expect(ran).toEqual([{ tool: "slack_post_message", params: { channel: "#launch", message: "Ready" }, context: { organizationId: orgId, userId: user.id, isAdmin: true, isOrgAdmin: true, isSuperAdmin: false } }]);
        expect((await nodeRow(node.id)).data).toMatchObject({ status: "success", lastRun: { approvalId: asked.approvalId, decidedBy: user.email, output: "Posted to #launch" } });
    });

    it("records a tool's refusal as a failed run", async () => {
        toolOutput = "Error: Agent governance denied for tool 'slack_post_message'.";
        const node = await nodes.create({ name: "Alert", kind: "saas", target: "slack_post_message" }, { organizationId: orgId, userId: user.id });
        const { approvalId } = await nodes.requestRun(node.id, requester());
        const [approval] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, approvalId));
        expect(await nodes.onRunDecision(approval, "approved", { userId: user.id, email: user.email })).toMatchObject({ success: false, status: "failed" });
        expect((await nodeRow(node.id)).data).toMatchObject({ status: "failed", lastRun: { error: toolOutput } });
        toolOutput = "Posted to #launch";
    });

    it("says before asking anyone when a node cannot run, and keeps nodes to their organization", async () => {
        const jira = await nodes.create({ name: "Jira Issue Dispatch", kind: "saas", target: "jira_create_issue" }, { organizationId: orgId, userId: user.id });
        await expect(nodes.requestRun(jira.id, requester()))
            .rejects.toThrow(`"Jira Issue Dispatch" runs jira_create_issue, and this platform has no tool by that name, so there is nothing to approve.`);
        const pack = await nodes.create({ name: "Node Express Core", kind: "scaffold_pack", target: "core-node-express" }, { organizationId: orgId, userId: user.id });
        await expect(nodes.requestRun(pack.id, requester())).rejects.toThrow(/is a scaffold pack/);
        await expect(nodes.requestRun(jira.id, { ...requester(), organizationId: otherOrgId })).rejects.toThrow("Workflow node not found.");
        const none = await db.select().from(approvalRequests).where(and(eq(approvalRequests.organizationId, orgId), sql`${approvalRequests.modifiedOutput}->>'nodeId' in (${String(jira.id)}, ${String(pack.id)})`));
        expect(none).toEqual([]);
    });

    it("signs off a review gate, or records its rejection, through the Decision Inbox decision", async () => {
        const gate = await workflowNodes.create({ name: "HIL Human Review Gate", kind: "hil_gate", target: "hil_approval_request" }, { organizationId: orgId, userId: user.id });
        const { approvalId } = await workflowNodes.requestRun(gate.id, requester());
        const approved = await approvalService.processDecision(approvalId, { decision: "approved" }, user.id, user.email);
        expect(approved.workflowNodeRun).toMatchObject({ handled: true, success: true, status: "success", output: `Signed off by ${user.email}.` });
        expect((await nodeRow(gate.id)).data).toMatchObject({ status: "success" });

        const second = await workflowNodes.create({ name: "Second gate", kind: "hil_gate", target: "hil_approval_request" }, { organizationId: orgId, userId: user.id });
        const run = await workflowNodes.requestRun(second.id, requester());
        const rejected = await approvalService.processDecision(run.approvalId, { decision: "rejected", comments: "Not this week" }, user.id, user.email);
        expect(rejected.workflowNodeRun).toMatchObject({ status: "rejected" });
        expect((await nodeRow(second.id)).data).toMatchObject({ status: "rejected", lastRun: { decidedBy: user.email } });
    });
});
