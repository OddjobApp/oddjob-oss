import { and, or, eq, gte, inArray, isNull, isNotNull, lte, sql, desc, asc } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
    projects,
    projectMembers,
    projectFinanceRoles,
    projectResources,
    projectEvents,
    type ProjectEventKind,
    type ProjectEventSeverity,
    slugifyProjectKey,
    type Project,
    type ProjectRole,
    type ProjectResourceType,
    type ProjectRelation,
    type InsertProjectInput,
    type UpdateProjectInput,
} from "@shared/schema/projects.js";
import { operationalCycles } from "@shared/schema/operational-cycles.js";
import { missions } from "@shared/schema/missions/core.js";
import { apps } from "@shared/schema/apps.js";
import { datasets } from "@shared/schema/datasets.js";
import { knowledgeDocuments } from "@shared/schema/knowledge-base.js";
import { cycleRunEvents } from "@shared/schema/cycle-run-events.js";
import { missionRuns } from "@shared/schema/missions/runs.js";
import { orgs, users, userOrgs } from "@shared/schema/auth.js";
import { jobs } from "@shared/schema/jobs/table.js";
import { hilForms } from "@shared/schema/hil.js";
import { workflows } from "@shared/schema/workflows.js";
import { createLogger } from "@server/utils/logger.js";
import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
} from "@server/utils/errors.js";

const logger = createLogger("ProjectService");

/**
 * Project Spaces — the durable scope between orgs and operational cycles.
 *
 * Org isolation works exactly like OntologyService: every method funnels through
 * `requireOrg`, and the org id is NEVER read from a caller-supplied parameter, so
 * cross-tenant access is impossible by construction.
 *
 * See docs/PROJECT_SPACES_DESIGN.md.
 */

export interface ProjectCtx {
    /** Resolved, non-null org id. Callers (routes/tools) must resolve this. */
    organizationId: number;
    userId?: string;
    /**
     * Agent principal acting in this request, identified by agent name — the key the
     * shared agent pool uses and what `cycle_run_events.agent_id` carries.
     *
     * This is §8's "agent principals get roles too", and it works as a CEILING rather
     * than a grant (see `agentCeilingFor`): an agent with no membership row anywhere in
     * the org is UNGOVERNED and behaves exactly as it does today, so turning this on
     * costs no migration. The moment an agent is given any project role it becomes
     * governed, and its reach is capped to the projects and roles it was granted —
     * even when it is acting on behalf of an org admin.
     */
    agentId?: string;
    isSuperAdmin?: boolean;
    /** Org admins retain full access to every project regardless of membership (§8). */
    isOrgAdmin?: boolean;
}

export interface ProjectWithSpend extends Project {
    spendToDateUsd: number;
    cycleCount: number;
    activeCycleCount: number;
}

/** A membership row with enough identity attached to render it. */
export interface ProjectMemberView {
    id: number;
    projectId: number;
    principalType: "user" | "agent";
    principalId: string;
    role: ProjectRole;
    addedBy: string | null;
    createdAt: Date;
    displayName: string;
    secondary: string | null;
    /** Derived from `projects.owner_user_id` rather than a row — not removable. */
    implicit: boolean;
    isProjectOwner: boolean;
}

/** Ascending capability. A member satisfies a requirement at or below their rank. */
const ROLE_RANK: Record<ProjectRole, number> = {
    viewer: 1,
    operator: 2,
    editor: 3,
    owner: 4,
};

/** What an agent principal's grants mean for a single project. */
export interface AgentCeiling {
    /** The agent holds at least one project role somewhere in this org. */
    governed: boolean;
    /** Its role on the project in question, if any. */
    role: ProjectRole | null;
}

/** An agent with no grants anywhere: the pre-existing, unconstrained behaviour. */
export const UNGOVERNED_AGENT: AgentCeiling = { governed: false, role: null };

/**
 * Apply an agent principal's ceiling to the role a request would otherwise carry.
 *
 * Pure, so the whole of §8's agent story is testable without a database.
 *
 *  - No agent principal, or an ungoverned agent -> the base role, unchanged. This is
 *    what makes the feature free to adopt: today every agent is ungoverned.
 *  - A governed agent with no role on THIS project -> null. Granting an agent a role
 *    on one project is what confines it to that project; otherwise "blast radius"
 *    would be a label on a table nobody reads.
 *  - A governed agent with a role here -> the LOWER of the two. An agent never
 *    exceeds the human it acts for, and a human never exceeds the agent's grant while
 *    acting through it — including an org admin, whose org-wide access is exactly the
 *    thing a ceiling exists to bound.
 *
 * A ceiling only ever LOWERS: it can never hand a caller a role they did not already
 * have, which is what keeps §8's "additive to org roles and never expand them" true
 * for agents as well. An agent acting alone supplies its own base role instead (see
 * `roleFor`), so a granted agent still works with no human in the loop.
 */
export function capRole(base: ProjectRole | null, ceiling: AgentCeiling | null): ProjectRole | null {
    if (!ceiling || !ceiling.governed) return base;
    if (!base || !ceiling.role) return null;
    return ROLE_RANK[base] <= ROLE_RANK[ceiling.role] ? base : ceiling.role;
}

export function requireOrg(ctx: ProjectCtx): number {
    if (!ctx || typeof ctx.organizationId !== "number" || Number.isNaN(ctx.organizationId)) {
        throw new ForbiddenError("Project access requires a resolved organization context.");
    }
    return ctx.organizationId;
}

/**
 * Reverse lookup cache: (resource_type, resource_id) -> project_id.
 *
 * This is what neutralises the junction's read cost on hot paths (§6.1/§11). Map
 * iteration order is insertion order, so re-inserting on a hit gives true LRU
 * eviction. `null` is cached too — an unattached resource is the common case and
 * must not re-query every time.
 */
class ResourceProjectCache {
    private readonly entries = new Map<string, number | null>();

    constructor(private readonly maxSize = 5000) {}

    private key(type: string, id: number): string {
        return `${type}:${id}`;
    }

    get(type: string, id: number): number | null | undefined {
        const k = this.key(type, id);
        if (!this.entries.has(k)) return undefined;
        const value = this.entries.get(k)!;
        // Re-insert to mark as most-recently-used.
        this.entries.delete(k);
        this.entries.set(k, value);
        return value;
    }

    set(type: string, id: number, projectId: number | null): void {
        const k = this.key(type, id);
        if (this.entries.has(k)) this.entries.delete(k);
        this.entries.set(k, projectId);
        if (this.entries.size > this.maxSize) {
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined) this.entries.delete(oldest);
        }
    }

    invalidate(type: string, id: number): void {
        this.entries.delete(this.key(type, id));
    }

    /** Called when a project is archived/deleted — its whole membership set is stale. */
    clear(): void {
        this.entries.clear();
    }

    get size(): number {
        return this.entries.size;
    }
}

export class ProjectService {
    readonly resourceCache = new ResourceProjectCache();

    // ---- Reads -------------------------------------------------------------

    async listProjects(
        ctx: ProjectCtx,
        opts?: { includeArchived?: boolean },
    ): Promise<Project[]> {
        const org = requireOrg(ctx);
        // Guarantee every organization has a default project loaded
        await this.ensureDefaultProject(ctx).catch(() => {});
        const conds = [eq(projects.organizationId, org)];
        if (!opts?.includeArchived) {
            conds.push(sql`${projects.status} <> 'archived'`);
        }

        const rows = await db
            .select()
            .from(projects)
            .where(and(...conds))
            .orderBy(desc(projects.isDefault), asc(projects.name));

        // A governed agent lists only what it was granted, whatever the visibility and
        // whatever authority it is acting under — the listing has to agree with the
        // read gate or the UI would show doors that 404.
        if (ctx.agentId) {
            const grants = await this.agentGrantsFor(org, ctx.agentId);
            if (grants.size > 0) return rows.filter((p) => grants.has(p.id));
        }

        // `private` projects are hidden from non-members in listings; org admins still
        // see everything (§8).
        if (this.hasOrgWideAccess(ctx)) return rows;

        const visible = rows.filter((p) => p.visibility !== "private");
        const privateOnes = rows.filter((p) => p.visibility === "private");
        if (privateOnes.length === 0) return visible;

        const memberships = await this.membershipRolesFor(
            ctx,
            privateOnes.map((p) => p.id),
        );
        const permitted = privateOnes.filter((p) => memberships.has(p.id));
        return [...visible, ...permitted].sort((a, b) => {
            if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    }

    /** Resolve by numeric id or URL key. Both are org-scoped. */
    async getProject(ctx: ProjectCtx, idOrKey: number | string): Promise<Project> {
        const org = requireOrg(ctx);
        const numeric = typeof idOrKey === "number" ? idOrKey : Number(idOrKey);
        const byId = Number.isInteger(numeric) && String(idOrKey).trim() === String(numeric);

        const rows = await db
            .select()
            .from(projects)
            .where(
                and(
                    eq(projects.organizationId, org),
                    byId ? eq(projects.id, numeric) : eq(projects.key, String(idOrKey)),
                ),
            )
            .limit(1);

        const project = rows[0];
        if (!project) throw new NotFoundError(`Project '${idOrKey}' not found.`);
        await this.assertCanRead(ctx, project);
        return project;
    }

    /**
     * The org's default project, created on demand. Every org has exactly one, which
     * is what lets scope resolution stay total: a request that names no project still
     * lands somewhere real and behaves exactly as it does today (§9 Phase 2).
     */
    async ensureDefaultProject(ctx: ProjectCtx): Promise<Project> {
        const org = requireOrg(ctx);

        const existing = await db
            .select()
            .from(projects)
            .where(and(eq(projects.organizationId, org), eq(projects.isDefault, true)))
            .limit(1);
        if (existing[0]) return existing[0];

        const orgRow = await db
            .select({ name: orgs.name })
            .from(orgs)
            .where(eq(orgs.id, org))
            .limit(1);
        const orgName = orgRow[0]?.name ?? `Organization ${org}`;

        // The partial unique index projects_org_default_unique is the real guard against
        // a race here; onConflictDoNothing turns a concurrent create into a re-read.
        const inserted = await db
            .insert(projects)
            .values({
                organizationId: org,
                key: await this.uniqueKey(org, slugifyProjectKey(orgName)),
                name: orgName,
                objective: "Default project space — everything not yet assigned elsewhere.",
                isDefault: true,
                createdBy: ctx.userId ?? "system",
            })
            .onConflictDoNothing()
            .returning();

        if (inserted[0]) {
            logger.info(`[Projects] Created default project '${inserted[0].key}' for org ${org}.`);
            return inserted[0];
        }

        const raced = await db
            .select()
            .from(projects)
            .where(and(eq(projects.organizationId, org), eq(projects.isDefault, true)))
            .limit(1);
        if (!raced[0]) {
            throw new ConflictError(`Could not create or resolve a default project for org ${org}.`);
        }
        return raced[0];
    }

    // ---- Writes ------------------------------------------------------------

    async createProject(
        ctx: ProjectCtx,
        input: Omit<InsertProjectInput, "organizationId" | "createdBy"> & { key?: string },
    ): Promise<Project> {
        const org = requireOrg(ctx);
        const key = await this.uniqueKey(org, input.key || slugifyProjectKey(input.name));

        const rows = await db
            .insert(projects)
            .values({
                ...input,
                key,
                organizationId: org,
                // A project created through the API is never the org default; the default is
                // owned by ensureDefaultProject so the partial unique index can't be tripped.
                isDefault: false,
                ownerUserId: input.ownerUserId ?? ctx.userId ?? null,
                createdBy: ctx.userId ?? "system",
            })
            .returning();

        const project = rows[0];

        // The creator is the owner, otherwise a private project would be invisible to
        // the person who just made it.
        if (ctx.userId) {
            await db
                .insert(projectMembers)
                .values({
                    projectId: project.id,
                    principalType: "user",
                    principalId: ctx.userId,
                    role: "owner",
                    addedBy: ctx.userId,
                })
                .onConflictDoNothing();
        }

        logger.info(`[Projects] Created project '${project.key}' (${project.id}) in org ${org}.`);
        return project;
    }

    async updateProject(
        ctx: ProjectCtx,
        idOrKey: number | string,
        patch: UpdateProjectInput,
    ): Promise<Project> {
        const project = await this.getProject(ctx, idOrKey);
        await this.assertRole(ctx, project, "editor");

        // Archiving has a precondition (no open cycles) that a generic PATCH would walk
        // straight past, so it stays on its own endpoint. Coming BACK from archived is
        // allowed here, but it is an owner's call and must clear the tombstone.
        const reopening = project.status === "archived" && !!patch.status && patch.status !== "archived";
        if (patch.status === "archived" && project.status !== "archived") {
            throw new BadRequestError(
                "Use the archive endpoint to archive a project — it checks for open cycles first.",
            );
        }
        if (reopening) await this.assertRole(ctx, project, "owner");

        // Only an owner decides who can see a project; an editor changing it to `org`
        // would be a silent disclosure of everything inside.
        if (patch.visibility && patch.visibility !== project.visibility) {
            await this.assertRole(ctx, project, "owner");
        }

        const nextKey = patch.key && patch.key !== project.key
            ? await this.uniqueKey(project.organizationId, patch.key)
            : undefined;

        const rows = await db
            .update(projects)
            .set({
                ...patch,
                ...(nextKey ? { key: nextKey } : {}),
                ...(reopening ? { archivedAt: null } : {}),
                updatedAt: new Date(),
            })
            .where(eq(projects.id, project.id))
            .returning();

        if (reopening) this.resourceCache.clear();
        return rows[0];
    }

    /**
     * Archiving refuses while any cycle is still active (§10.5). Closing work
     * explicitly is the point — a silent pause would strand running executions.
     */
    async archiveProject(ctx: ProjectCtx, idOrKey: number | string): Promise<Project> {
        const project = await this.getProject(ctx, idOrKey);
        await this.assertRole(ctx, project, "owner");

        if (project.isDefault) {
            throw new BadRequestError(
                "The default project cannot be archived — it is where unassigned resources land.",
            );
        }

        const active = await db
            .select({ id: operationalCycles.id, name: operationalCycles.name })
            .from(operationalCycles)
            .where(
                and(
                    eq(operationalCycles.projectId, project.id),
                    inArray(operationalCycles.status, ["active", "paused", "pending_approval", "reviewing"]),
                    isNull(operationalCycles.deletedAt),
                ),
            );

        if (active.length > 0) {
            throw new ConflictError(
                `Cannot archive '${project.name}': ${active.length} cycle(s) still open (${active
                    .slice(0, 3)
                    .map((c) => c.name)
                    .join(", ")}). Close them first.`,
            );
        }

        const rows = await db
            .update(projects)
            .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
            .where(eq(projects.id, project.id))
            .returning();

        this.resourceCache.clear();
        logger.info(`[Projects] Archived project '${project.key}' (${project.id}).`);
        return rows[0];
    }

    // ---- Members -----------------------------------------------------------

    /**
     * Members with something a human can recognise attached. The junction stores an
     * opaque `principal_id`; a member list that shows only UUIDs is unusable, so user
     * principals are resolved to their account and agent principals are marked as such.
     *
     * The owner recorded on the project itself is folded in even when no membership row
     * exists for them (`createProject` writes one, but a project created before that —
     * or by the backfill — has only `owner_user_id`), so the list never claims a project
     * has no owner while the header shows one.
     */
    async listMembers(ctx: ProjectCtx, idOrKey: number | string): Promise<ProjectMemberView[]> {
        const project = await this.getProject(ctx, idOrKey);

        const rows = await db
            .select()
            .from(projectMembers)
            .where(eq(projectMembers.projectId, project.id))
            .orderBy(asc(projectMembers.createdAt));

        const materialised: ProjectMemberView[] = rows.map((r) => ({
            id: r.id,
            projectId: r.projectId,
            principalType: r.principalType as "user" | "agent",
            principalId: r.principalId,
            role: r.role as ProjectRole,
            addedBy: r.addedBy,
            createdAt: r.createdAt,
            displayName: r.principalId,
            secondary: null,
            implicit: false,
            isProjectOwner: project.ownerUserId === r.principalId && r.principalType === "user",
        }));

        if (
            project.ownerUserId
            && !materialised.some((m) => m.principalType === "user" && m.principalId === project.ownerUserId)
        ) {
            materialised.unshift({
                id: -1,
                projectId: project.id,
                principalType: "user",
                principalId: project.ownerUserId,
                role: "owner",
                addedBy: null,
                createdAt: project.createdAt,
                displayName: project.ownerUserId,
                secondary: null,
                // No row to delete: the UI must not offer a Remove that cannot succeed.
                implicit: true,
                isProjectOwner: true,
            });
        }

        await this.decorateUserPrincipals(materialised);
        return materialised;
    }

    /** Resolve user principal ids to accounts, in one query. */
    private async decorateUserPrincipals(members: ProjectMemberView[]): Promise<void> {
        const userIds = members.filter((m) => m.principalType === "user").map((m) => m.principalId);
        if (userIds.length === 0) return;

        const accounts = await db
            .select({
                id: users.id,
                username: users.username,
                email: users.email,
                firstName: users.firstName,
                lastName: users.lastName,
            })
            .from(users)
            .where(inArray(users.id, userIds));

        const byId = new Map(accounts.map((u) => [u.id, u]));
        for (const m of members) {
            if (m.principalType !== "user") continue;
            const u = byId.get(m.principalId);
            if (!u) continue;
            const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
            m.displayName = full || u.username;
            m.secondary = u.email ?? u.username;
        }
    }

    /**
     * Who can still be added. Users come from the org roster and agents from the shared
     * `ai_agent` pool, both minus whoever already holds a role — a picker that offers
     * an existing member would silently overwrite their role through the upsert.
     */
    async listMemberCandidates(ctx: ProjectCtx, idOrKey: number | string): Promise<{
        users: Array<{ principalId: string; displayName: string; secondary: string | null }>;
        agents: Array<{ principalId: string; displayName: string; secondary: string | null }>;
    }> {
        const org = requireOrg(ctx);
        const project = await this.getProject(ctx, idOrKey);
        // Only someone who can actually grant a role gets to see the roster.
        await this.assertRole(ctx, project, "owner");

        const [existing, roster, agentRows] = await Promise.all([
            db
                .select({
                    principalType: projectMembers.principalType,
                    principalId: projectMembers.principalId,
                })
                .from(projectMembers)
                .where(eq(projectMembers.projectId, project.id)),
            db
                .select({
                    id: users.id,
                    username: users.username,
                    email: users.email,
                    firstName: users.firstName,
                    lastName: users.lastName,
                })
                .from(userOrgs)
                .innerJoin(users, eq(users.id, userOrgs.userId))
                .where(eq(userOrgs.orgId, org)),
            // Agents are a shared pool of `ai_agent` jobs keyed by NAME — the same
            // identity `cycle_run_events.agent_id` records — so the name is the principal.
            db
                .selectDistinct({ name: jobs.name, description: jobs.description })
                .from(jobs)
                .where(
                    and(
                        eq(jobs.type, "ai_agent"),
                        eq(jobs.organizationId, org),
                        eq(jobs.lifecycleStatus, "active"),
                    ),
                ),
        ]);

        const taken = new Set(existing.map((e) => `${e.principalType}:${e.principalId}`));
        if (project.ownerUserId) taken.add(`user:${project.ownerUserId}`);

        return {
            users: roster
                .filter((u) => !taken.has(`user:${u.id}`))
                .map((u) => {
                    const full = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
                    return {
                        principalId: u.id,
                        displayName: full || u.username,
                        secondary: u.email ?? u.username,
                    };
                })
                .sort((a, b) => a.displayName.localeCompare(b.displayName)),
            agents: agentRows
                .filter((a) => !taken.has(`agent:${a.name}`))
                .map((a) => ({
                    principalId: a.name,
                    displayName: a.name,
                    secondary: a.description ?? null,
                }))
                .sort((a, b) => a.displayName.localeCompare(b.displayName)),
        };
    }

    async addMember(
        ctx: ProjectCtx,
        idOrKey: number | string,
        member: { principalType: "user" | "agent"; principalId: string; role: ProjectRole },
    ) {
        const project = await this.getProject(ctx, idOrKey);
        await this.assertRole(ctx, project, "owner");

        const rows = await db
            .insert(projectMembers)
            .values({
                projectId: project.id,
                principalType: member.principalType,
                principalId: member.principalId,
                role: member.role,
                addedBy: ctx.userId,
            })
            .onConflictDoUpdate({
                target: [projectMembers.projectId, projectMembers.principalType, projectMembers.principalId],
                set: { role: member.role, addedBy: ctx.userId ?? null },
            })
            .returning();

        // A grant is what makes an agent governed, so the ceiling cache is stale the
        // instant this row lands.
        if (member.principalType === "agent") this.forgetAgentGrants();
        return rows[0];
    }

    async removeMember(
        ctx: ProjectCtx,
        idOrKey: number | string,
        principalType: string,
        principalId: string,
    ): Promise<boolean> {
        const project = await this.getProject(ctx, idOrKey);
        await this.assertRole(ctx, project, "owner");

        // Removing the last owner would strand the project: nobody could manage members
        // or archive it again except an org admin. Refuse rather than produce that state.
        if (principalType === "user") {
            const owners = await db
                .select({ principalId: projectMembers.principalId })
                .from(projectMembers)
                .where(
                    and(
                        eq(projectMembers.projectId, project.id),
                        eq(projectMembers.principalType, "user"),
                        eq(projectMembers.role, "owner"),
                    ),
                );
            const remaining = owners.filter((o) => o.principalId !== principalId);
            const projectOwnerSurvives =
                !!project.ownerUserId && project.ownerUserId !== principalId;
            if (owners.some((o) => o.principalId === principalId) && remaining.length === 0 && !projectOwnerSurvives) {
                throw new ConflictError(
                    `'${project.name}' would be left with no owner. Give someone else the owner role first.`,
                );
            }
        }

        const rows = await db
            .delete(projectMembers)
            .where(
                and(
                    eq(projectMembers.projectId, project.id),
                    eq(projectMembers.principalType, principalType),
                    eq(projectMembers.principalId, principalId),
                ),
            )
            .returning({ id: projectMembers.id });

        if (principalType === "agent") this.forgetAgentGrants();
        // Leaving the project ends their finance roles too, so a later re-add
        // starts with no QuickBooks access (finance-roles.service.ts).
        if (principalType === "user" && rows.length > 0) {
            await db.delete(projectFinanceRoles).where(and(
                eq(projectFinanceRoles.projectId, project.id), eq(projectFinanceRoles.userId, principalId)));
        }
        return rows.length > 0;
    }

    // ---- Resources ---------------------------------------------------------

    /**
     * The authored half of a project's timeline.
     *
     * `from`/`to` default to an open range because the timeline is read both
     * ways: a person looks forward at what is coming, an agent asked about a
     * past decision looks back. Ordered soonest-first, unlike the activity feed,
     * because a timeline is read forwards.
     *
     * Access is whatever getProject enforces — a private project's events are as
     * private as the project.
     */
    async listEvents(
        ctx: ProjectCtx,
        idOrKey: number | string,
        opts?: { from?: Date; to?: Date; limit?: number },
    ) {
        const project = await this.getProject(ctx, idOrKey);
        const conds = [eq(projectEvents.projectId, project.id)];
        if (opts?.from) conds.push(gte(projectEvents.startsAt, opts.from));
        if (opts?.to) conds.push(lte(projectEvents.startsAt, opts.to));

        return db
            .select()
            .from(projectEvents)
            .where(and(...conds))
            .orderBy(projectEvents.startsAt)
            .limit(Math.min(Math.max(1, opts?.limit ?? 100), 500));
    }

    async createEvent(
        ctx: ProjectCtx,
        idOrKey: number | string,
        input: {
            title: string;
            description?: string | null;
            kind?: ProjectEventKind;
            severity?: ProjectEventSeverity;
            startsAt: Date;
            endsAt?: Date | null;
            recurrence?: string | null;
            recurrenceTimezone?: string;
            recurrenceUntil?: Date | null;
        },
    ) {
        const project = await this.getProject(ctx, idOrKey);

        // A range that ends before it starts would sort and render incoherently,
        // and is far more likely a client bug than an intent.
        if (input.endsAt && input.endsAt < input.startsAt) {
            throw new BadRequestError("endsAt cannot be before startsAt.");
        }

        const [event] = await db
            .insert(projectEvents)
            .values({
                projectId: project.id,
                organizationId: project.organizationId,
                title: input.title,
                description: input.description ?? null,
                kind: input.kind ?? "milestone",
                severity: input.severity ?? "Medium",
                startsAt: input.startsAt,
                endsAt: input.endsAt ?? null,
                recurrence: input.recurrence ?? null,
                recurrenceTimezone: input.recurrenceTimezone ?? "UTC",
                recurrenceUntil: input.recurrenceUntil ?? null,
                createdBy: ctx.userId ?? "unknown",
            })
            .returning();

        return event;
    }

    async updateEvent(
        ctx: ProjectCtx,
        idOrKey: number | string,
        eventId: number,
        changes: Partial<{
            title: string;
            description: string | null;
            kind: ProjectEventKind;
            severity: ProjectEventSeverity;
            startsAt: Date;
            endsAt: Date | null;
            recurrence: string | null;
            recurrenceTimezone: string;
            recurrenceUntil: Date | null;
        }>,
    ) {
        const project = await this.getProject(ctx, idOrKey);

        const [updated] = await db
            .update(projectEvents)
            .set({ ...changes, updatedAt: new Date() })
            // Scoped by project as well as id: an event id from another project
            // must not be reachable by naming a project you can see.
            .where(and(eq(projectEvents.id, eventId), eq(projectEvents.projectId, project.id)))
            .returning();

        if (!updated) throw new NotFoundError(`Event ${eventId} not found in this project.`);
        return updated;
    }

    async deleteEvent(ctx: ProjectCtx, idOrKey: number | string, eventId: number) {
        const project = await this.getProject(ctx, idOrKey);
        const [removed] = await db
            .delete(projectEvents)
            .where(and(eq(projectEvents.id, eventId), eq(projectEvents.projectId, project.id)))
            .returning();

        if (!removed) throw new NotFoundError(`Event ${eventId} not found in this project.`);
        return removed;
    }

    async listResources(
        ctx: ProjectCtx,
        idOrKey: number | string,
        opts?: { resourceType?: ProjectResourceType; relation?: ProjectRelation },
    ) {
        const project = await this.getProject(ctx, idOrKey);
        const conds = [eq(projectResources.projectId, project.id)];
        if (opts?.resourceType) conds.push(eq(projectResources.resourceType, opts.resourceType));
        if (opts?.relation) conds.push(eq(projectResources.relation, opts.relation));

        return db
            .select()
            .from(projectResources)
            .where(and(...conds))
            .orderBy(desc(projectResources.createdAt));
    }

    /**
     * Attach a resource. A `primary` attach MOVES the resource — the partial unique
     * index allows only one primary home, so the previous one is released first
     * rather than letting the insert fail with a constraint error the caller can't act on.
     */
    async attachResource(
        ctx: ProjectCtx,
        idOrKey: number | string,
        resourceType: ProjectResourceType,
        resourceId: number,
        relation: ProjectRelation = "primary",
    ) {
        const project = await this.getProject(ctx, idOrKey);
        await this.assertRole(ctx, project, "editor");

        // Resource ids in the junction are plain integers, so a form is checked to be
        // one of this organization's authored forms, and one the caller can already
        // see: moving a form out of a private project needs read access to that project.
        if (resourceType === "form") {
            const [form] = await db
                .select({ id: hilForms.id })
                .from(hilForms)
                .where(and(eq(hilForms.id, resourceId), eq(hilForms.kind, "template"), eq(hilForms.organizationId, project.organizationId)))
                .limit(1);
            if (!form) throw new NotFoundError("Form " + resourceId + " not found.");
            const current = await this.resolveProjectForResource("form", resourceId);
            if (current !== null && current !== project.id) {
                try {
                    await this.getProject(ctx, current);
                } catch (error) {
                    if (error instanceof NotFoundError) throw new NotFoundError("Form " + resourceId + " not found.");
                    throw error;
                }
            }
            if (relation === "primary") {
                // The form row carries its project, so a name is unique within it (0114); a
                // default project does not namespace names. Set first, so a clash leaves the
                // form where it was.
                try {
                    await db
                        .update(hilForms)
                        .set({ projectId: project.isDefault ? null : project.id })
                        .where(and(eq(hilForms.id, resourceId), eq(hilForms.organizationId, project.organizationId)));
                } catch (error) {
                    const e = error as { code?: string; cause?: { code?: string } };
                    if ((e?.code ?? e?.cause?.code) === "23505") {
                        throw new ConflictError(`Another form in project '${project.key}' already has this form's name. Rename one of them first.`);
                    }
                    throw error;
                }
            }
        }

        // Same ownership check as `form`, minus the column sync — workflows has
        // no project_id column; the junction alone is the ownership record.
        if (resourceType === "workflow") {
            const [workflow] = await db
                .select({ id: workflows.id })
                .from(workflows)
                .where(and(eq(workflows.id, resourceId), eq(workflows.organizationId, project.organizationId)))
                .limit(1);
            if (!workflow) throw new NotFoundError("Workflow " + resourceId + " not found.");
            const current = await this.resolveProjectForResource("workflow", resourceId);
            if (current !== null && current !== project.id) {
                try {
                    await this.getProject(ctx, current);
                } catch (error) {
                    if (error instanceof NotFoundError) throw new NotFoundError("Workflow " + resourceId + " not found.");
                    throw error;
                }
            }
        }

        if (relation === "primary") {
            await db
                .delete(projectResources)
                .where(
                    and(
                        eq(projectResources.resourceType, resourceType),
                        eq(projectResources.resourceId, resourceId),
                        eq(projectResources.relation, "primary"),
                    ),
                );
        }

        const rows = await db
            .insert(projectResources)
            .values({
                projectId: project.id,
                resourceType,
                resourceId,
                relation,
                addedBy: ctx.userId,
            })
            .onConflictDoUpdate({
                target: [projectResources.projectId, projectResources.resourceType, projectResources.resourceId],
                set: { relation, addedBy: ctx.userId ?? null },
            })
            .returning();

        // Cycles carry a real column as well (§5.3) — keep the two in step.
        if (resourceType === "cycle" && relation === "primary") {
            await db
                .update(operationalCycles)
                .set({ projectId: project.id, updatedAt: new Date() })
                .where(
                    and(
                        eq(operationalCycles.id, resourceId),
                        eq(operationalCycles.organizationId, project.organizationId),
                    ),
                );
        }

        this.resourceCache.invalidate(resourceType, resourceId);
        return rows[0];
    }

    async detachResource(
        ctx: ProjectCtx,
        idOrKey: number | string,
        resourceType: ProjectResourceType,
        resourceId: number,
    ): Promise<boolean> {
        const project = await this.getProject(ctx, idOrKey);
        await this.assertRole(ctx, project, "editor");

        const rows = await db
            .delete(projectResources)
            .where(
                and(
                    eq(projectResources.projectId, project.id),
                    eq(projectResources.resourceType, resourceType),
                    eq(projectResources.resourceId, resourceId),
                ),
            )
            .returning({ id: projectResources.id, relation: projectResources.relation });

        if (resourceType === "form" && rows.some((row) => row.relation === "primary")) {
            await db
                .update(hilForms)
                .set({ projectId: null })
                .where(and(eq(hilForms.id, resourceId), eq(hilForms.projectId, project.id)));
        }

        if (rows.length > 0 && resourceType === "cycle") {
            await db
                .update(operationalCycles)
                .set({ projectId: null, updatedAt: new Date() })
                .where(and(eq(operationalCycles.id, resourceId), eq(operationalCycles.projectId, project.id)));
        }

        this.resourceCache.invalidate(resourceType, resourceId);
        return rows.length > 0;
    }

    /**
     * Which project owns this resource? Cached (§6.1). Cycles answer from their own
     * column and never touch the junction.
     */
    async resolveProjectForResource(
        resourceType: ProjectResourceType,
        resourceId: number,
    ): Promise<number | null> {
        if (!Number.isInteger(resourceId)) return null;

        const cached = this.resourceCache.get(resourceType, resourceId);
        if (cached !== undefined) return cached;

        let projectId: number | null = null;

        if (resourceType === "cycle") {
            const rows = await db
                .select({ projectId: operationalCycles.projectId })
                .from(operationalCycles)
                .where(eq(operationalCycles.id, resourceId))
                .limit(1);
            projectId = rows[0]?.projectId ?? null;
        }

        if (projectId === null) {
            const rows = await db
                .select({ projectId: projectResources.projectId })
                .from(projectResources)
                .where(
                    and(
                        eq(projectResources.resourceType, resourceType),
                        eq(projectResources.resourceId, resourceId),
                        eq(projectResources.relation, "primary"),
                    ),
                )
                .limit(1);
            projectId = rows[0]?.projectId ?? null;
        }

        this.resourceCache.set(resourceType, resourceId, projectId);
        return projectId;
    }

    // ---- Budget rollup (§6.3) ---------------------------------------------

    /**
     * Projects sum their cycles' spend. `projects.budget_limit_usd` is the approval
     * gate finance cares about; cycle budgets stay as execution guardrails.
     */
    async listProjectsWithSpend(
        ctx: ProjectCtx,
        opts?: { includeArchived?: boolean },
    ): Promise<ProjectWithSpend[]> {
        const visible = await this.listProjects(ctx, opts);
        if (visible.length === 0) return [];

        const ids = visible.map((p) => p.id);
        const rollup = await db
            .select({
                projectId: operationalCycles.projectId,
                spend: sql<string>`COALESCE(SUM(${operationalCycles.currentSpendUsd}), 0)`,
                cycleCount: sql<number>`COUNT(*)::int`,
                activeCycleCount: sql<number>`COUNT(*) FILTER (WHERE ${operationalCycles.status} = 'active')::int`,
            })
            .from(operationalCycles)
            .where(
                and(
                    inArray(operationalCycles.projectId, ids),
                    isNull(operationalCycles.deletedAt),
                ),
            )
            .groupBy(operationalCycles.projectId);

        const byProject = new Map(rollup.map((r) => [r.projectId, r]));
        return visible.map((p) => {
            const r = byProject.get(p.id);
            return {
                ...p,
                spendToDateUsd: r ? Number(r.spend) : 0,
                cycleCount: r?.cycleCount ?? 0,
                activeCycleCount: r?.activeCycleCount ?? 0,
            };
        });
    }

    async getProjectSpend(ctx: ProjectCtx, idOrKey: number | string) {
        const project = await this.getProject(ctx, idOrKey);
        const rows = await db
            .select({
                spend: sql<string>`COALESCE(SUM(${operationalCycles.currentSpendUsd}), 0)`,
                cycleCount: sql<number>`COUNT(*)::int`,
                activeCycleCount: sql<number>`COUNT(*) FILTER (WHERE ${operationalCycles.status} = 'active')::int`,
            })
            .from(operationalCycles)
            .where(
                and(eq(operationalCycles.projectId, project.id), isNull(operationalCycles.deletedAt)),
            );

        const spendToDateUsd = Number(rows[0]?.spend ?? 0);
        const budgetLimitUsd = project.budgetLimitUsd === null ? null : Number(project.budgetLimitUsd);
        return {
            projectId: project.id,
            spendToDateUsd,
            budgetLimitUsd,
            remainingUsd: budgetLimitUsd === null ? null : budgetLimitUsd - spendToDateUsd,
            cycleCount: rows[0]?.cycleCount ?? 0,
            activeCycleCount: rows[0]?.activeCycleCount ?? 0,
        };
    }

    /**
     * The org's default project id, memoised.
     *
     * Ingest paths that upsert on `(project_id, name)` MUST pass a non-null project:
     * Postgres treats NULLs as distinct, so a null project_id silently turns an
     * idempotent upsert back into a duplicate insert. This is the cheap resolver those
     * paths use when the caller carries no explicit project scope.
     */
    private readonly defaultProjectIds = new Map<number, number>();

    async resolveDefaultProjectId(organizationId: number): Promise<number | null> {
        if (typeof organizationId !== "number" || Number.isNaN(organizationId)) return null;

        const cached = this.defaultProjectIds.get(organizationId);
        if (cached !== undefined) return cached;

        try {
            const project = await this.ensureDefaultProject({ organizationId, userId: "system" });
            this.defaultProjectIds.set(organizationId, project.id);
            return project.id;
        } catch (e: any) {
            // Never let project resolution take down an ingest path — a null project
            // still writes the row, it just isn't namespaced.
            logger.warn(`[Projects] Could not resolve default project for org ${organizationId}: ${e?.message ?? e}`);
            return null;
        }
    }

    // ---- Permissions (§8) --------------------------------------------------

    /** Org admins and super admins bypass project membership entirely. */
    private hasOrgWideAccess(ctx: ProjectCtx): boolean {
        return ctx.isSuperAdmin === true || ctx.isOrgAdmin === true;
    }

    private async membershipRolesFor(
        ctx: ProjectCtx,
        projectIds: number[],
    ): Promise<Map<number, ProjectRole>> {
        const result = new Map<number, ProjectRole>();
        if (!ctx.userId || projectIds.length === 0) return result;

        const rows = await db
            .select({ projectId: projectMembers.projectId, role: projectMembers.role })
            .from(projectMembers)
            .where(
                and(
                    inArray(projectMembers.projectId, projectIds),
                    eq(projectMembers.principalType, "user"),
                    eq(projectMembers.principalId, ctx.userId),
                ),
            );
        for (const r of rows) result.set(r.projectId, r.role as ProjectRole);
        return result;
    }

    /**
     * Every grant an agent principal holds in this org, memoised for a few seconds.
     *
     * One query answers both halves of the ceiling: whether the agent is governed at
     * all, and what it may do on each project. The TTL is short because revoking an
     * agent's access is a containment action — a stale allow is the failure mode that
     * matters, not a stale deny.
     */
    private readonly agentGrants = new Map<string, { at: number; roles: Map<number, ProjectRole> }>();
    private static readonly AGENT_GRANT_TTL_MS = 5_000;

    private async agentGrantsFor(
        organizationId: number,
        agentId: string,
    ): Promise<Map<number, ProjectRole>> {
        const cacheKey = `${organizationId}:${agentId}`;
        const hit = this.agentGrants.get(cacheKey);
        if (hit && Date.now() - hit.at < ProjectService.AGENT_GRANT_TTL_MS) return hit.roles;

        // Joined to `projects` so an agent named in another org's project can never
        // govern (or free) this one.
        const rows = await db
            .select({ projectId: projectMembers.projectId, role: projectMembers.role })
            .from(projectMembers)
            .innerJoin(projects, eq(projects.id, projectMembers.projectId))
            .where(
                and(
                    eq(projectMembers.principalType, "agent"),
                    eq(projectMembers.principalId, agentId),
                    eq(projects.organizationId, organizationId),
                ),
            );

        const roles = new Map<number, ProjectRole>(
            rows.map((r) => [r.projectId, r.role as ProjectRole]),
        );
        this.agentGrants.set(cacheKey, { at: Date.now(), roles });
        return roles;
    }

    /** Invalidate immediately on a membership write, so a revoke takes effect at once. */
    private forgetAgentGrants(): void {
        this.agentGrants.clear();
    }

    /** True when this request acts as an agent that holds at least one project grant. */
    async isGovernedAgent(ctx: ProjectCtx): Promise<boolean> {
        if (!ctx.agentId) return false;
        const grants = await this.agentGrantsFor(requireOrg(ctx), ctx.agentId);
        return grants.size > 0;
    }

    async agentCeilingFor(ctx: ProjectCtx, projectId: number): Promise<AgentCeiling> {
        if (!ctx.agentId) return UNGOVERNED_AGENT;
        const grants = await this.agentGrantsFor(requireOrg(ctx), ctx.agentId);
        return { governed: grants.size > 0, role: grants.get(projectId) ?? null };
    }

    async roleFor(ctx: ProjectCtx, project: Project): Promise<ProjectRole | null> {
        const ceiling = await this.agentCeilingFor(ctx, project.id);

        // An agent acting alone is its own principal, so its grant is the base rather
        // than a cap on someone else's.
        if (!ctx.userId && ctx.agentId && ceiling.governed) return ceiling.role;

        const base = this.hasOrgWideAccess(ctx)
            ? "owner" as ProjectRole
            : ctx.userId && project.ownerUserId === ctx.userId
                ? "owner" as ProjectRole
                : (await this.membershipRolesFor(ctx, [project.id])).get(project.id) ?? null;

        return capRole(base, ceiling);
    }

    /**
     * Reading an `org`-visible project needs no membership — project roles are
     * additive to org roles and never expand or contract them (§8).
     *
     * A governed agent is the one caller that org visibility does not admit: the point
     * of confining an agent is that it cannot wander into projects it was not given.
     */
    async assertCanRead(ctx: ProjectCtx, project: Project): Promise<void> {
        const ceiling = await this.agentCeilingFor(ctx, project.id);
        if (ceiling.governed && !ceiling.role) {
            throw new NotFoundError(`Project '${project.key}' not found.`);
        }
        if (project.visibility !== "private") return;
        if (this.hasOrgWideAccess(ctx) && !ceiling.governed) return;
        const role = await this.roleFor(ctx, project);
        if (!role) throw new NotFoundError(`Project '${project.key}' not found.`);
    }

    /**
     * Changing anything inside a project needs the editor role — the same gate
     * updateProject and the resource writers already use.
     *
     * Read access is deliberately much wider than write access: assertCanRead
     * admits the whole org to an `org`-visible project, and a viewer to a
     * private one. A route that has only called getProject has therefore
     * authorized a READ, and must call this before it writes. Exposed because
     * the writers that do not live in this service — the project file editor —
     * still have to ask the same question.
     */
    async assertCanEdit(ctx: ProjectCtx, project: Project): Promise<void> {
        await this.assertRole(ctx, project, "editor");
    }

    private async assertRole(ctx: ProjectCtx, project: Project, required: ProjectRole): Promise<void> {
        const role = await this.roleFor(ctx, project);
        if (!role || ROLE_RANK[role] < ROLE_RANK[required]) {
            throw new ForbiddenError(
                `This action requires the '${required}' role on project '${project.key}'.`,
            );
        }
    }

    // ---- Helpers -----------------------------------------------------------

    /** Append -2, -3, … until the (org, key) unique index is satisfied. */
    private async uniqueKey(organizationId: number, desired: string): Promise<string> {
        const base = slugifyProjectKey(desired);
        for (let attempt = 0; attempt < 50; attempt++) {
            const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
            const clash = await db
                .select({ id: projects.id })
                .from(projects)
                .where(and(eq(projects.organizationId, organizationId), eq(projects.key, candidate)))
                .limit(1);
            if (clash.length === 0) return candidate;
        }
        throw new ConflictError(`Could not derive a unique project key from '${desired}'.`);
    }
    /** Returns the first available organization ID for fallback/dev purposes */
    async getFallbackOrgId(): Promise<number | null> {
        const [firstOrg] = await db.select({ id: orgs.id }).from(orgs).limit(1);
        return firstOrg?.id ?? null;
    }

    // ---- Scoped work surfaces (Overview / Cycles / Work tabs) ------------------
    // These back the /:key/{cycles,missions,apps,knowledge,activity} routes. They
    // live here because route handlers must not touch db directly.

    async listCycles(ctx: { organizationId: number }, projectId: number) {
        return await db
            .select()
            .from(operationalCycles)
            .where(and(
                eq(operationalCycles.projectId, projectId),
                eq(operationalCycles.organizationId, ctx.organizationId),
                isNull(operationalCycles.deletedAt),
            ))
            .orderBy(desc(operationalCycles.createdAt));
    }

    async listMissions(ctx: { organizationId: number }, projectId: number) {
        const attached = await db
            .select({ resourceId: projectResources.resourceId })
            .from(projectResources)
            .where(and(
                eq(projectResources.projectId, projectId),
                eq(projectResources.resourceType, "mission"),
            ));

        const ids = attached.map((r) => r.resourceId);
        if (ids.length === 0) return [];

        // Re-assert the org on the mission rows themselves: resource ids in the
        // junction are plain integers, so org ownership is checked here rather
        // than assumed.
        return await db
            .select({
                id: missions.id,
                name: missions.name,
                description: missions.description,
                status: missions.status,
                type: missions.type,
                createdAt: missions.createdAt,
            })
            .from(missions)
            .where(and(
                inArray(missions.id, ids),
                eq(missions.organizationId, ctx.organizationId),
                isNull(missions.deletedAt),
            ))
            .orderBy(desc(missions.createdAt));
    }

    async listApps(ctx: { organizationId: number }, projectId: number) {
        return await db
            .select({
                id: apps.id,
                name: apps.name,
                slug: apps.slug,
                description: apps.description,
                status: apps.status,
                icon: apps.icon,
                blueprintSlug: apps.blueprintSlug,
                updatedAt: apps.updatedAt,
            })
            .from(projectResources)
            .innerJoin(apps, eq(apps.id, projectResources.resourceId))
            .where(and(
                eq(projectResources.projectId, projectId),
                eq(projectResources.resourceType, "app"),
                or(
                    eq(apps.organizationId, ctx.organizationId),
                    isNull(apps.organizationId),
                    eq(apps.isPublic, true),
                    eq(apps.isSystem, true),
                ),
            ))
            .orderBy(desc(apps.updatedAt));
    }

    async listKnowledge(ctx: { organizationId: number }, projectId: number) {
        const [datasetRows, documentRows] = await Promise.all([
            db
                .select({
                    id: datasets.id,
                    name: datasets.name,
                    description: datasets.description,
                    tags: datasets.tags,
                    updatedAt: datasets.updatedAt,
                })
                .from(datasets)
                .where(and(
                    eq(datasets.projectId, projectId),
                    eq(datasets.organizationId, ctx.organizationId),
                ))
                .orderBy(desc(datasets.updatedAt))
                .limit(100),
            db
                .select({
                    id: knowledgeDocuments.id,
                    title: knowledgeDocuments.title,
                    summary: knowledgeDocuments.summary,
                    sourceType: knowledgeDocuments.sourceType,
                    updatedAt: knowledgeDocuments.updatedAt,
                })
                .from(knowledgeDocuments)
                .where(and(
                    eq(knowledgeDocuments.projectId, projectId),
                    eq(knowledgeDocuments.organizationId, ctx.organizationId),
                ))
                .orderBy(desc(knowledgeDocuments.updatedAt))
                .limit(100),
        ]);
        return { datasets: datasetRows, documents: documentRows };
    }

    /**
     * Recent step activity across a project's cycles.
     *
     * The route this serves used to carry a note saying run_id references
     * operational_cycles "despite its name". It does not: it is a
     * pipeline_executions.id, and this joined events to cycles on an equality
     * between two unrelated id spaces — so a project's activity feed showed its
     * own cycle names against step events belonging to whatever execution
     * happened to share the number.
     *
     * The real path runs through mission_runs, which carries both the cycle it
     * belongs to and the pipeline execution it started.
     */
    async listActivity(ctx: { organizationId: number }, projectId: number, limit: number) {
        const runs = await db
            .select({
                pipelineExecutionId: missionRuns.pipelineExecutionId,
                cycleId: missionRuns.cycleId,
                cycleName: operationalCycles.name,
            })
            .from(missionRuns)
            .innerJoin(operationalCycles, eq(operationalCycles.id, missionRuns.cycleId))
            .where(and(
                eq(operationalCycles.projectId, projectId),
                eq(operationalCycles.organizationId, ctx.organizationId),
                isNotNull(missionRuns.pipelineExecutionId),
            ));

        if (runs.length === 0) return [];

        // Which cycle each execution belongs to, so the feed can still name it.
        const cycleByExecution = new Map(
            runs.map((r) => [r.pipelineExecutionId as number, { id: r.cycleId, name: r.cycleName }]),
        );

        const events = await db
            .select({
                id: cycleRunEvents.id,
                runId: cycleRunEvents.runId,
                eventType: cycleRunEvents.eventType,
                stepCode: cycleRunEvents.stepCode,
                agentId: cycleRunEvents.agentId,
                error: cycleRunEvents.error,
                durationMs: cycleRunEvents.durationMs,
                timestamp: cycleRunEvents.timestamp,
            })
            .from(cycleRunEvents)
            .where(inArray(cycleRunEvents.runId, [...cycleByExecution.keys()]))
            .orderBy(desc(cycleRunEvents.timestamp))
            .limit(limit);

        return events.map(({ runId, ...event }) => ({
            ...event,
            pipelineExecutionId: runId,
            cycleId: cycleByExecution.get(runId)?.id ?? null,
            cycleName: cycleByExecution.get(runId)?.name ?? null,
        }));
    }
}

/** Shared singleton. */
export const projectService = new ProjectService();
