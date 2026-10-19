import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { projectFinanceRoles, projectMembers, projects } from '@shared/schema/projects.js';
import {
    FINANCE_ROLES, FINANCE_ROLE_LABELS, financeAccess, isFinanceRole, requiresExecutiveApproval, roleGrants,
    QUICKBOOKS_REPORT_ACCESS, type FinanceAccess, type FinanceOp, type FinanceRole,
} from '@shared/finance-roles.js';
import { BadRequestError, ForbiddenError } from '@server/utils/errors.js';
import { orgs, users } from '@shared/schema/index.js';
import type { PermissionRequiredPayload, PermissionStep } from '@shared/crew-permission.js';
import { projectService, type ProjectCtx } from './project.service.js';

/**
 * Finance roles: per-project, per-member QuickBooks access (the matrix lives in
 * shared/finance-roles.ts). A role only counts while its holder is still a user
 * member (or the owner) of the project, so removing someone from a project
 * revokes their finance access with it.
 */

/** Who a QuickBooks call acts for. A null project means the org's default project. */
export interface FinanceCaller {
    organizationId?: number | null;
    projectId?: number | null;
    userId?: string | number | null;
    /** Only used to say whether the caller can grant the access they lack. */
    isOrgAdmin?: boolean;
    isSuperAdmin?: boolean;
}

/**
 * A finance refusal that carries what would allow the call, so CREW can show
 * the steps as a card instead of a dead-end sentence.
 */
export class PermissionRequiredError extends ForbiddenError {
    constructor(message: string, readonly permission: PermissionRequiredPayload) {
        super(message);
    }
}

/**
 * Approval requests that need an Executive are addressed to this, not to a
 * person: every Executive on the project sees and may decide them.
 */
const EXECUTIVE_APPROVER_PREFIX = 'finance-role:executive:project:';
export const executiveApproverAddress = (projectId: number) => `${EXECUTIVE_APPROVER_PREFIX}${projectId}`;
export function executiveApproverProject(address: string | null | undefined): number | null {
    if (!address?.startsWith(EXECUTIVE_APPROVER_PREFIX)) return null;
    const id = Number(address.slice(EXECUTIVE_APPROVER_PREFIX.length));
    return Number.isInteger(id) && id > 0 ? id : null;
}

class FinanceRolesService {
    /** The project whose roles govern a call: the named one, else the org default. */
    async permissionProjectId(organizationId: number, projectId?: number | null): Promise<number | null> {
        if (projectId != null) return projectId;
        return projectService.resolveDefaultProjectId(organizationId);
    }

    /** Project ids (of `projectIds`, in this org) where the user is a user member or the owner. */
    private async memberProjects(organizationId: number, userId: string, projectIds?: number[]): Promise<Set<number>> {
        const owned = await db.select({ id: projects.id }).from(projects).where(and(
            eq(projects.organizationId, organizationId), eq(projects.ownerUserId, userId),
            ...(projectIds ? [inArray(projects.id, projectIds)] : [])));
        const joined = await db.select({ id: projectMembers.projectId }).from(projectMembers)
            .innerJoin(projects, eq(projects.id, projectMembers.projectId))
            .where(and(eq(projects.organizationId, organizationId), eq(projectMembers.principalType, 'user'),
                eq(projectMembers.principalId, userId), ...(projectIds ? [inArray(projectMembers.projectId, projectIds)] : [])));
        return new Set([...owned, ...joined].map(r => r.id));
    }

    /** Every finance role the user holds in the org, by project, membership-checked. */
    async rolesByProject(organizationId: number, userId: string): Promise<Map<number, FinanceRole[]>> {
        const rows = await db.select({ projectId: projectFinanceRoles.projectId, role: projectFinanceRoles.role })
            .from(projectFinanceRoles)
            .where(and(eq(projectFinanceRoles.organizationId, organizationId), eq(projectFinanceRoles.userId, userId)));
        if (!rows.length) return new Map();
        const member = await this.memberProjects(organizationId, userId, [...new Set(rows.map(r => r.projectId))]);
        const out = new Map<number, FinanceRole[]>();
        for (const r of rows) {
            if (!member.has(r.projectId) || !isFinanceRole(r.role)) continue;
            out.set(r.projectId, [...(out.get(r.projectId) ?? []), r.role]);
        }
        return out;
    }

    async rolesFor(organizationId: number, projectId: number, userId: string): Promise<FinanceRole[]> {
        return (await this.rolesByProject(organizationId, userId)).get(projectId) ?? [];
    }

    /** The caller's access on the project their call is scoped to. No user means no access. */
    async accessFor(caller: FinanceCaller): Promise<{ projectId: number | null; access: FinanceAccess }> {
        const organizationId = caller.organizationId;
        if (organizationId == null || !caller.userId) return { projectId: null, access: financeAccess([]) };
        const projectId = await this.permissionProjectId(organizationId, caller.projectId);
        if (projectId == null) return { projectId: null, access: financeAccess([]) };
        return { projectId, access: financeAccess(await this.rolesFor(organizationId, projectId, String(caller.userId))) };
    }

    async assertAnyRole(caller: FinanceCaller): Promise<FinanceAccess> {
        const { projectId, access } = await this.accessFor(caller);
        if (!access.any) {
            throw await this.refusal(caller, projectId, 'use QuickBooks', FINANCE_ROLES.map(role => FINANCE_ROLE_LABELS[role]),
                (grantedBy) => `QuickBooks access needs a finance role (AR, AP, Audit or Executive) on this project. Ask ${grantedBy}.`);
        }
        return access;
    }

    async assertCan(caller: FinanceCaller, entity: string, op: FinanceOp): Promise<{ projectId: number | null; access: FinanceAccess }> {
        const scoped = await this.accessFor(caller);
        if (!scoped.access.can(entity, op)) {
            const roles = FINANCE_ROLES.filter(role => roleGrants(role, entity, op)).map(role => FINANCE_ROLE_LABELS[role]);
            // Nothing to grant: no role may do this, so there are no steps to show.
            if (!roles.length) throw new ForbiddenError(`No finance role may ${op} QuickBooks ${entity} records through Oddjob.`);
            throw await this.refusal(caller, scoped.projectId, `${op} QuickBooks ${entity} records`, roles,
                (grantedBy) => `You cannot ${op} QuickBooks ${entity} records on this project. That needs the ${roles.join(' or ')} finance role; ask ${grantedBy}.`);
        }
        return scoped;
    }

    async assertCanReport(caller: FinanceCaller, report: string): Promise<void> {
        const { projectId, access } = await this.accessFor(caller);
        if (!access.canReport(report)) {
            const roles = FINANCE_ROLES.filter(role => QUICKBOOKS_REPORT_ACCESS[report]?.includes(role) ?? false).map(role => FINANCE_ROLE_LABELS[role]);
            // An unknown report has no role to grant, and "needs the  finance role" helps nobody.
            if (!roles.length) throw new ForbiddenError(`No finance role may read the QuickBooks ${report} report through Oddjob.`);
            throw await this.refusal(caller, projectId, `read the QuickBooks ${report} report`, roles,
                () => `The QuickBooks ${report} report needs the ${roles.join(' or ')} finance role on this project.`);
        }
    }

    /**
     * For readers without a project (the ontology): the entities the user may read
     * through a connector. A project connection uses that project's roles; an
     * org-wide connection uses the union of the user's roles across the org.
     */
    async readableEntities(organizationId: number, userId: string | undefined): Promise<(connectorProjectId: number | null) => (entity: string) => boolean> {
        if (!userId) return () => () => false;
        const byProject = await this.rolesByProject(organizationId, userId);
        const all = financeAccess([...byProject.values()].flat());
        return projectId => {
            const access = projectId == null ? all : financeAccess(byProject.get(projectId) ?? []);
            return entity => access.can(entity, 'read');
        };
    }

    /** Projects where the user may decide Executive approvals. */
    async executiveProjects(organizationId: number | null | undefined, userId: string): Promise<number[]> {
        const rows = await db.select({ projectId: projectFinanceRoles.projectId, organizationId: projectFinanceRoles.organizationId })
            .from(projectFinanceRoles)
            .where(and(eq(projectFinanceRoles.userId, userId), eq(projectFinanceRoles.role, 'executive'),
                ...(organizationId != null ? [eq(projectFinanceRoles.organizationId, organizationId)] : [])));
        const out: number[] = [];
        for (const orgId of new Set(rows.map(r => r.organizationId))) {
            const ids = rows.filter(r => r.organizationId === orgId).map(r => r.projectId);
            const member = await this.memberProjects(orgId, userId, ids);
            out.push(...ids.filter(id => member.has(id)));
        }
        return out;
    }

    /**
     * Whether `userId` may approve a QuickBooks write. The approver needs the same
     * permission the write needs; where the matrix also asks for an Executive, the
     * approver must be an Executive and must not be the person who proposed it.
     */
    async assertCanApprove(input: {
        organizationId: number; projectId: number; userId: string; proposedBy: string | null;
        entity: string; op: FinanceOp;
    }): Promise<void> {
        const roles = await this.rolesFor(input.organizationId, input.projectId, input.userId);
        if (requiresExecutiveApproval(input.entity, input.op)) {
            if (!roles.includes('executive')) throw new ForbiddenError(`This QuickBooks ${input.entity} ${input.op} needs an Executive's approval on the project.`);
            if (input.proposedBy && input.proposedBy === input.userId) throw new ForbiddenError('An Executive other than the person who asked for it must approve this.');
            return;
        }
        if (!financeAccess(roles).can(input.entity, input.op)) {
            throw new ForbiddenError(`Approving this needs a finance role that may ${input.op} QuickBooks ${input.entity} records on the project.`);
        }
    }

    /**
     * The refusal for a call the caller's roles do not allow, with the steps that
     * would allow it: connect QuickBooks, join the project, hold a role. Says who
     * can take them; a project with no owner is managed by an org admin.
     */
    private async refusal(caller: FinanceCaller, projectId: number | null, action: string, allowedRoles: string[],
        message: (grantedBy: string) => string): Promise<ForbiddenError> {
        const organizationId = caller.organizationId;
        if (organizationId == null || projectId == null) return new ForbiddenError(message('an org admin'));
        try {
            const [project] = await db.select({ id: projects.id, key: projects.key, name: projects.name, ownerUserId: projects.ownerUserId })
                .from(projects).where(and(eq(projects.id, projectId), eq(projects.organizationId, organizationId))).limit(1);
            if (!project) return new ForbiddenError(message('an org admin'));
            const userId = caller.userId != null ? String(caller.userId) : null;
            const member = userId ? (await this.memberProjects(organizationId, userId, [project.id])).has(project.id) : false;
            let connected = false;
            try {
                const { findQuickBooksConnection } = await import('@domain/integrations/quickbooks/service.js');
                connected = (await findQuickBooksConnection(organizationId, project.id))?.status === 'connected';
            } catch { /* An unreadable connection counts as not connected. */ }
            let grantedBy = 'an org admin';
            if (project.ownerUserId) {
                const [owner] = await db.select({ username: users.username }).from(users).where(eq(users.id, project.ownerUserId)).limit(1);
                grantedBy = owner?.username ? `the project owner (${owner.username})` : 'the project owner';
            }
            const callerCanGrant = Boolean(caller.isOrgAdmin || caller.isSuperAdmin || (userId && project.ownerUserId === userId));
            const steps: PermissionStep[] = [
                { id: 'connect', label: `Connect QuickBooks to ${project.name}`, done: connected },
                ...(member ? [] : [{ id: 'join' as const, label: `Add you to ${project.name}`, done: false }]),
                { id: 'grant', label: `Give you the ${allowedRoles.join(' or ')} finance role`, done: false },
            ];
            const text = message(callerCanGrant ? 'an org admin or the project owner, which includes you' : grantedBy);
            return new PermissionRequiredError(text, {
                type: 'permission_required', key: `${project.id}:${action}`, title: 'QuickBooks access needed', action, reason: text,
                allowedRoles, project: { id: project.id, key: project.key, name: project.name }, organizationId, steps, grantedBy, callerCanGrant,
                manageHref: `/projects/${encodeURIComponent(project.key)}?tab=integrations&orgId=${organizationId}`,
            });
        } catch {
            // The details are a courtesy; the refusal itself must never fail.
            return new ForbiddenError(message('an org admin'));
        }
    }

    async ensureSystemExecutive(userId: string, grantedBy: string | null = null): Promise<{ organizationId: number; projectId: number }> {
        if (!userId) throw new BadRequestError('A user is required for the Oddjob System Executive role.');
        let [systemOrg] = await db.select({ id: orgs.id }).from(orgs).where(eq(orgs.name, 'Oddjob System')).limit(1);
        if (!systemOrg) {
            const { systemKnowledgeService } = await import('@domain/knowledge/core/system-knowledge-service.js');
            systemOrg = { id: await systemKnowledgeService.ensureSystemOrg() };
        }
        const project = await projectService.ensureDefaultProject({ organizationId: systemOrg.id, userId, isSuperAdmin: true });
        await db.transaction(async tx => {
            await tx.insert(projectMembers).values({ projectId: project.id, principalType: 'user', principalId: userId, role: 'owner', addedBy: grantedBy }).onConflictDoNothing();
            await tx.insert(projectFinanceRoles).values({ projectId: project.id, organizationId: systemOrg.id, userId, role: 'executive', grantedBy }).onConflictDoNothing();
        });
        return { organizationId: systemOrg.id, projectId: project.id };
    }

    // ---- Management (project owner) ----------------------------------------

    async listForProject(ctx: ProjectCtx, idOrKey: number | string) {
        const project = await projectService.getProject(ctx, idOrKey);
        const [members, role, rows] = await Promise.all([
            projectService.listMembers(ctx, project.id),
            projectService.roleFor(ctx, project),
            db.select().from(projectFinanceRoles).where(eq(projectFinanceRoles.projectId, project.id)),
        ]);
        const users = members.filter(m => m.principalType === 'user');
        return {
            canManage: role === 'owner',
            members: users.map(m => ({
                userId: m.principalId,
                displayName: m.displayName,
                secondary: m.secondary,
                projectRole: m.role,
                financeRoles: rows.filter(r => r.userId === m.principalId).map(r => r.role).filter(isFinanceRole),
            })),
        };
    }

    async setRoles(ctx: ProjectCtx, idOrKey: number | string, userId: string, roles: unknown): Promise<FinanceRole[]> {
        if (!Array.isArray(roles) || !roles.every(isFinanceRole)) {
            throw new BadRequestError(`roles must be a list of: ${FINANCE_ROLES.join(', ')}.`);
        }
        const project = await projectService.getProject(ctx, idOrKey);
        if (await projectService.roleFor(ctx, project) !== 'owner') {
            throw new ForbiddenError(`Only an owner of project '${project.key}' can assign finance roles.`);
        }
        const member = await this.memberProjects(project.organizationId, userId, [project.id]);
        if (!member.has(project.id)) throw new BadRequestError('Add this person to the project before giving them a finance role.');

        const wanted = [...new Set(roles)];
        await db.transaction(async tx => {
            await tx.delete(projectFinanceRoles).where(and(eq(projectFinanceRoles.projectId, project.id), eq(projectFinanceRoles.userId, userId)));
            if (wanted.length) {
                await tx.insert(projectFinanceRoles).values(wanted.map(role => ({
                    projectId: project.id, organizationId: project.organizationId, userId, role, grantedBy: ctx.userId ?? null,
                })));
            }
        });
        return wanted;
    }

    /** Called when someone leaves a project, so a later re-add starts with no finance access. */
    async clearForMember(projectId: number, userId: string): Promise<void> {
        await db.delete(projectFinanceRoles).where(and(eq(projectFinanceRoles.projectId, projectId), eq(projectFinanceRoles.userId, userId)));
    }
}

export const financeRolesService = new FinanceRolesService();

/** Approval-inbox addressing for a user's Executive projects. */
export async function executiveApproverAddresses(organizationId: number | null | undefined, userId: string): Promise<string[]> {
    return (await financeRolesService.executiveProjects(organizationId, userId)).map(executiveApproverAddress);
}

