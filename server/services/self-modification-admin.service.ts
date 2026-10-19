import { desc, eq, ilike } from "drizzle-orm";
import { db } from "../database_service.js";
import { auditLogs, harnessProposals } from "@shared/schema/index.js";
import { BadRequestError } from "../utils/errors.js";

export function isCriticalPath(filePath: string): boolean {
    if (!filePath) return false;
    const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
    return normalized.startsWith("server/") || normalized.startsWith("shared/");
}

export function isProposalDualApproved(proposal: {
    proposedChange?: any;
    humanApprovedAt?: any;
    humanApprovedBy?: any;
    validationResults?: any;
}): boolean {
    if (!proposal || !proposal.humanApprovedAt) return false;
    const filePath = proposal.proposedChange?.filePath || "";
    if (!isCriticalPath(filePath)) {
        return true;
    }
    const dualApproval = proposal.validationResults?.dualApproval;
    if (!dualApproval) return false;
    const primary = dualApproval.primaryApprovedBy || proposal.humanApprovedBy;
    const secondary = dualApproval.secondaryApprovedBy;
    return Boolean(dualApproval.isFullyApproved && primary && secondary && primary !== secondary);
}

export const selfModificationAdminService = {
    isCriticalPath,
    isProposalDualApproved,

    async listAuditEntries(filter?: string) {
        const baseQuery = db.select().from(auditLogs);
        if (filter) {
            return baseQuery.where(ilike(auditLogs.action, `%${filter}%`))
                .orderBy(desc(auditLogs.createdAt)).limit(100);
        }
        return baseQuery.orderBy(desc(auditLogs.createdAt)).limit(100);
    },

    async approveProposal(proposalId: number, approvedBy: string) {
        const [existing] = await db.select().from(harnessProposals).where(eq(harnessProposals.id, proposalId)).limit(1);
        if (!existing) return null;

        const filePath = (existing.proposedChange as any)?.filePath || "";
        const critical = isCriticalPath(filePath);
        const currentValidation = (existing.validationResults as Record<string, any>) || {};
        const existingDual = currentValidation.dualApproval || {};

        const dualApproval = {
            ...existingDual,
            primaryApprovedBy: approvedBy,
            primaryApprovedAt: new Date().toISOString(),
            isFullyApproved: !critical || Boolean(existingDual.secondaryApprovedBy && existingDual.secondaryApprovedBy !== approvedBy),
        };

        const newValidationResults = {
            ...currentValidation,
            dualApproval,
        };

        const [updated] = await db.update(harnessProposals).set({
            humanApprovedAt: new Date(),
            humanApprovedBy: approvedBy,
            validationResults: newValidationResults,
        }).where(eq(harnessProposals.id, proposalId)).returning();
        return updated;
    },

    async secondApproveProposal(proposalId: number, secondaryApproverId: string) {
        const [existing] = await db.select().from(harnessProposals).where(eq(harnessProposals.id, proposalId)).limit(1);
        if (!existing) return null;

        const currentValidation = (existing.validationResults as Record<string, any>) || {};
        const existingDual = currentValidation.dualApproval || {};
        const primaryApprover = existingDual.primaryApprovedBy || existing.humanApprovedBy;

        if (!primaryApprover || !existing.humanApprovedAt) {
            throw new BadRequestError("Proposal must receive primary approval before second-stage review");
        }

        if (primaryApprover === secondaryApproverId) {
            throw new BadRequestError("Secondary approver must be distinct from primary approver (Four-Eyes Principle)");
        }

        const dualApproval = {
            ...existingDual,
            primaryApprovedBy: primaryApprover,
            primaryApprovedAt: existingDual.primaryApprovedAt || existing.humanApprovedAt?.toISOString() || new Date().toISOString(),
            secondaryApprovedBy: secondaryApproverId,
            secondaryApprovedAt: new Date().toISOString(),
            isFullyApproved: true,
        };

        const newValidationResults = {
            ...currentValidation,
            dualApproval,
        };

        const [updated] = await db.update(harnessProposals).set({
            validationResults: newValidationResults,
        }).where(eq(harnessProposals.id, proposalId)).returning();

        return updated;
    },

    async validateProposedChange(filePath: string, content: string) {
        const { validateSafety } = await import("@server/domain/tools/v1/capabilities/self-modification.js");
        return validateSafety(filePath, content);
    },
};

