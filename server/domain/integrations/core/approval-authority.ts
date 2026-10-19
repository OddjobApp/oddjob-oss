/**
 * Who may decide an approval request: its designated approver (by user id or
 * email), a super admin, or an admin of the request's organization.
 *
 * There used to be a fourth: any caller whose id was 1, "the system user". No
 * caller passes 1 (system paths pass their own principal, or a super-admin role
 * for token-validated links), but users.id is text and a real row with id "1"
 * can exist, which then decided every tenant's approvals.
 *
 * Shared by approvalService.processDecision and by Form Studio stage requests,
 * which must check it before a stage's answers are locked, not after.
 *
 * NOTE: a "squad / quorum validation" block used to sit in processDecision,
 * reading `request.metadata.targetTeamId` and `request.metadata.quorumPolicy`.
 * `approval_requests` HAS NO metadata COLUMN (see shared/schema/hil.ts), so that
 * object was always undefined: the squad-lead gate never fired, and its only live
 * effect was to widen this check — any member of the named team could decide a
 * request that named someone else as approver.
 *
 * Removed rather than repaired. Reinstating it needs three things that do not
 * exist yet: somewhere to store the policy, a writer that sets it, and a decision
 * on whether "quorum" means a lead-only gate or an actual count.
 */
export function canDecideApproval(
    request: { approverId: string | null; approverEmail: string; organizationId: number | null },
    userId: string | number,
    userEmail: string,
    adminRole?: { isSuperAdmin?: boolean; isOrgAdmin?: boolean; organizationId?: number | null } | null,
): boolean {
    const isDesignatedApprover = request.approverId === userId.toString() || request.approverEmail === userEmail;
    const isSuperAdmin = Boolean(adminRole?.isSuperAdmin);
    const isOrgAdminForThisOrg = Boolean(adminRole?.isOrgAdmin && adminRole.organizationId === request.organizationId);
    return isDesignatedApprover || isSuperAdmin || isOrgAdminForThisOrg;
}
