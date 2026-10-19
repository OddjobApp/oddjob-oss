import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { approvalRequests, syntheticFinanceCommunications } from "@shared/schema/index.js";
import { knowledgePackService } from "./knowledge-pack.service.js";

export type SyntheticFinanceRole = "drafter" | "reviewer" | "publisher" | "auditor";

export function hashFinanceCommunication(title: string, content: string): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({ title, content })).digest("hex")}`;
}

export class SyntheticFinanceWorkflowService {
  async list(organizationId: number) {
    return db.select().from(syntheticFinanceCommunications).where(eq(syntheticFinanceCommunications.organizationId, organizationId)).orderBy(desc(syntheticFinanceCommunications.createdAt));
  }

  async draft(organizationId: number, actor: { id: string; role: SyntheticFinanceRole }, input: { title: string; content: string; customerClassification: string; archiveTarget: string }) {
    if (actor.role !== "drafter") throw new Error("Only the Finance Content Drafter role may create drafts");
    const [row] = await db.insert(syntheticFinanceCommunications).values({
      organizationId, ...input, contentHash: hashFinanceCommunication(input.title, input.content), draftedBy: actor.id,
    }).returning();
    return row;
  }

  async submit(organizationId: number, communicationId: number, actor: { id: string; role: SyntheticFinanceRole; email: string }) {
    if (actor.role !== "drafter") throw new Error("Only the Finance Content Drafter role may submit drafts");
    const [item] = await db.select().from(syntheticFinanceCommunications).where(and(eq(syntheticFinanceCommunications.id, communicationId), eq(syntheticFinanceCommunications.organizationId, organizationId))).limit(1);
    if (!item || item.status !== "draft") throw new Error("Draft is not available for submission");
    if (item.draftedBy !== actor.id) throw new Error("A drafter may submit only their own draft");
    const token = randomBytes(32).toString("hex");
    const [approval] = await db.insert(approvalRequests).values({
      executionId: `synthetic-finance:${item.id}`, toolName: "publish_financial_content",
      toolArgs: { communicationId: item.id, contentHash: item.contentHash }, approverType: "internal", approverEmail: actor.email,
      organizationId, token, status: "pending",
    }).returning();
    const [updated] = await db.update(syntheticFinanceCommunications).set({ status: "pending_review", approvalRequestId: approval.id, submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(syntheticFinanceCommunications.id, item.id)).returning();
    return updated;
  }

  async approve(organizationId: number, communicationId: number, actor: { id: string; role: SyntheticFinanceRole }) {
    if (actor.role !== "reviewer") throw new Error("Only the Compliance Reviewer role may approve");
    const [item] = await db.select().from(syntheticFinanceCommunications).where(and(eq(syntheticFinanceCommunications.id, communicationId), eq(syntheticFinanceCommunications.organizationId, organizationId))).limit(1);
    if (!item || item.status !== "pending_review" || !item.approvalRequestId) throw new Error("Communication is not awaiting review");
    if (item.draftedBy === actor.id) throw new Error("The drafter cannot approve their own communication");
    await db.update(approvalRequests).set({ status: "approved", decisionAt: new Date(), comments: `Approved immutable content hash ${item.contentHash}` }).where(eq(approvalRequests.id, item.approvalRequestId));
    const [updated] = await db.update(syntheticFinanceCommunications).set({ status: "approved", approvedContentHash: item.contentHash, approvedBy: actor.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(syntheticFinanceCommunications.id, item.id)).returning();
    return updated;
  }

  async publish(organizationId: number, communicationId: number, actor: { id: string; role: SyntheticFinanceRole }) {
    if (actor.role !== "publisher") throw new Error("Only the Publisher role may publish");
    const [item] = await db.select().from(syntheticFinanceCommunications).where(and(eq(syntheticFinanceCommunications.id, communicationId), eq(syntheticFinanceCommunications.organizationId, organizationId))).limit(1);
    if (!item || item.status !== "approved") throw new Error("Communication is not approved for publication");
    if (item.approvedBy === actor.id || item.draftedBy === actor.id) throw new Error("Drafting, approval, and publication must be performed by separate actors");
    const currentHash = hashFinanceCommunication(item.title, item.content);
    const governance = await knowledgePackService.evaluateAction(organizationId, "publish_financial_content", {
      customerClassification: item.customerClassification,
      approvalStatus: "APPROVED",
      contentHash: currentHash,
      approvalContentHash: item.approvedContentHash,
      agentMayPublish: true,
      archiveTarget: item.archiveTarget,
    }, actor.id);
    if (governance.decision !== "ALLOW") throw new Error(`Publication blocked by governance: ${governance.decision} — ${governance.reasons.join(" ")}`);
    const [updated] = await db.update(syntheticFinanceCommunications).set({ status: "published", publishedBy: actor.id, publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(syntheticFinanceCommunications.id, item.id)).returning();
    return { communication: updated, governance };
  }
}

export const syntheticFinanceWorkflowService = new SyntheticFinanceWorkflowService();

