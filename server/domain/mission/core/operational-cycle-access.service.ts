import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "@server/database_service.js";
import {
    operationalCycles,
    cycleBlueprints,
    cycleStrategicAudits,
    cycleDependencyGates,
    missionRuns,
    missions,
    missionAppBindings,
    apps,
    appDeployments,
    appInstances,
} from "@shared/schema/index.js";

/**
 * The one place a cycle is resolved for a principal.
 *
 * `server/routes/operational-cycles.ts` had thirteen copies of this scoping —
 * one helper plus twelve hand-rolled — and they had drifted into two different
 * behaviours:
 *
 *     if (!isSuperAdmin) {                      // the helper, and 3 copies
 *         if (!orgId) return REFUSE;
 *         conditions.push(eq(org, orgId));
 *     }
 *
 *     if (!isSuperAdmin && orgId) {             // 6 copies, no else
 *         conditions.push(eq(org, orgId));
 *     }
 *
 * The second shape has no branch for a non-super-admin whose organization is
 * null, so no organization predicate is added at all and the query narrows to
 * `WHERE id = $1` — any tenant's cycle, by id. It sat under POST
 * /:id/synthesize, /approve, /trigger, /abort, /milestone/approve and DELETE
 * /:id, so the consequence was a mutation rather than a read. This is the same
 * defect as `orgId != null ? eq(col, orgId) : undefined` in
 * `server/utils/org-conditions.ts`, written in a way the existing grep for it
 * does not match.
 *
 * Scoping is therefore a returned decision, not a condition array a caller
 * assembles: a caller cannot forget the null branch because it cannot build the
 * predicate itself.
 */

/** The authorization facts this layer needs. A subset of OrgContext. */
export interface CyclePrincipal {
    organizationId: number | null;
    isSuperAdmin: boolean;
}

export type CycleAccessFailure = "organization-required" | "not-found";

export type CycleAccessResult<T> =
    | { ok: true; cycle: T }
    | { ok: false; failure: CycleAccessFailure };

export type CycleMutationResult =
    | { ok: true; id: number }
    | { ok: false; failure: CycleAccessFailure };

/**
 * Builds the predicate for one cycle, or refuses.
 *
 * Returns null — rather than an unscoped predicate — when a non-super-admin has
 * no organization. Every caller must handle that, which is the point.
 */
function scopeFor(id: number, principal: CyclePrincipal, excludeDeleted: boolean): SQL[] | null {
    const conditions: SQL[] = [eq(operationalCycles.id, id)];
    if (excludeDeleted) {
        conditions.push(isNull(operationalCycles.deletedAt));
    }
    if (!principal.isSuperAdmin) {
        if (principal.organizationId == null) return null;
        conditions.push(eq(operationalCycles.organizationId, principal.organizationId));
    }
    return conditions;
}

export interface CycleLookupOptions {
    /**
     * Also require `deleted_at IS NULL`. Off by default, because only one of
     * the thirteen call sites this replaces asked for it and the job here is to
     * change the scoping and nothing else — folding a second behaviour change
     * into the same commit would make any regression ambiguous.
     *
     * Most of those callers arguably should exclude soft-deleted cycles: there
     * is little sense in synthesizing or approving a deleted one. That is a
     * deliberate change to make per route, with its own reasoning, not a
     * default to flip underneath eleven handlers at once.
     */
    excludeDeleted?: boolean;
}

export class OperationalCycleAccessService {
    /** Resolves a full cycle row this principal may see. */
    async find(
        id: number,
        principal: CyclePrincipal,
        options: CycleLookupOptions = {},
    ): Promise<CycleAccessResult<typeof operationalCycles.$inferSelect>> {
        const conditions = scopeFor(id, principal, options.excludeDeleted ?? false);
        if (!conditions) return { ok: false, failure: "organization-required" };

        const [cycle] = await db
            .select()
            .from(operationalCycles)
            .where(and(...conditions))
            .limit(1);

        return cycle ? { ok: true, cycle } : { ok: false, failure: "not-found" };
    }

    /** Resolves only the status, for callers that gate on it. */
    async findStatus(
        id: number,
        principal: CyclePrincipal,
        options: CycleLookupOptions = {},
    ): Promise<CycleAccessResult<{ status: string | null }>> {
        const conditions = scopeFor(id, principal, options.excludeDeleted ?? false);
        if (!conditions) return { ok: false, failure: "organization-required" };

        const [row] = await db
            .select({ status: operationalCycles.status })
            .from(operationalCycles)
            .where(and(...conditions))
            .limit(1);

        return row ? { ok: true, cycle: row } : { ok: false, failure: "not-found" };
    }

    /**
     * Applies a partial update to a cycle this principal may modify and returns
     * the updated row.
     *
     * `updatedAt` is stamped here so a caller cannot leave a cycle's timestamp
     * stale by forgetting it.
     */
    async updateReturning(
        id: number,
        principal: CyclePrincipal,
        values: Partial<typeof operationalCycles.$inferInsert>,
        options: CycleLookupOptions = {},
    ): Promise<CycleAccessResult<typeof operationalCycles.$inferSelect>> {
        const conditions = scopeFor(id, principal, options.excludeDeleted ?? false);
        if (!conditions) return { ok: false, failure: "organization-required" };

        const [updated] = await db
            .update(operationalCycles)
            .set({ ...values, updatedAt: new Date() })
            .where(and(...conditions))
            .returning();

        return updated ? { ok: true, cycle: updated } : { ok: false, failure: "not-found" };
    }

    /**
     * The same update for callers that only need to know it happened. Delegates,
     * so the scoping has exactly one implementation.
     */
    async update(
        id: number,
        principal: CyclePrincipal,
        values: Partial<typeof operationalCycles.$inferInsert>,
        options: CycleLookupOptions = {},
    ): Promise<CycleMutationResult> {
        const result = await this.updateReturning(id, principal, values, options);
        return result.ok ? { ok: true, id: result.cycle.id } : { ok: false, failure: result.failure };
    }

    /** Sets a cycle's status, the most common mutation on this table. */
    async setStatus(
        id: number,
        principal: CyclePrincipal,
        status: string,
        extra: Partial<typeof operationalCycles.$inferInsert> = {},
    ): Promise<CycleMutationResult> {
        return this.update(id, principal, { ...extra, status });
    }
}

export const operationalCycleAccess = new OperationalCycleAccessService();

// --- The cycle aggregate -----------------------------------------------------
//
// Blueprints, strategic audits, dependency gates and mission runs are reachable
// only through their cycle: each carries a cycleId and no organization column of
// its own. So authorization happens once, on the cycle, and the children are
// then addressed by cycleId. That is the model the route already used; what it
// lacked was one place to express it.

export interface CycleListFilters {
    status?: string | null;
    projectId?: number | null;
    limit: number;
    offset: number;
}

export interface CycleListPage {
    cycles: (typeof operationalCycles.$inferSelect)[];
    total: number;
}

export interface CycleBlueprintInput {
    name: string;
    objective: string;
    type?: string | null;
    dependencies?: unknown;
    estimatedDays: number;
    config?: unknown;
    metadata?: unknown;
}

/**
 * The cycle columns a revision may set.
 *
 * A whitelist rather than Partial<typeof operationalCycles.$inferInsert>, and
 * the distinction is the point: that type includes organizationId, so a caller
 * could move a cycle to another tenant through the one method whose purpose is
 * tenant safety. It also includes id and deletedAt, which would let a revision
 * resurrect a deleted cycle or collide with another row.
 *
 * budgetLimitUsd is a string because Drizzle's decimal() maps to one; passing a
 * number here silently stores something else.
 *
 * Adding a column is a deliberate edit to this list. That is the cost of the
 * approach and the reason to prefer it.
 */
export interface CycleRevisableFields {
    name?: string;
    description?: string | null;
    objective?: string;
    recurrence?: string | null;
    timezone?: string | null;
    priority?: number | null;
    budgetLimitUsd?: string | null;
    tokenLimit?: number | null;
    requiresApproval?: number | null;
    nextRunAt?: Date | null;
    startDate?: Date;
    endDate?: Date | null;
}

export interface CycleDetail {
    cycle: typeof operationalCycles.$inferSelect;
    runs: (typeof missionRuns.$inferSelect)[];
    blueprints: (typeof cycleBlueprints.$inferSelect)[];
    audits: (typeof cycleStrategicAudits.$inferSelect)[];
}

export type BlueprintAccessFailure = CycleAccessFailure | "blueprint-not-found";

/** The statuses that count as a run still being alive. */
const ACTIVE_RUN_STATUSES = sql`${missionRuns.status} IN ('active', 'running', 'waiting_on_human', 'waiting_on_file')`;

export class OperationalCycleAggregateService {
    /**
     * One page of an organization's cycles, with the total for the same filter.
     *
     * Takes the organization explicitly rather than a principal: the list route
     * resolves it up front, and a super admin browsing a particular
     * organization wants that organization's cycles rather than every tenant's.
     */
    async list(organizationId: number, filters: CycleListFilters): Promise<CycleListPage> {
        const conditions: SQL[] = [
            eq(operationalCycles.organizationId, organizationId),
            isNull(operationalCycles.deletedAt),
        ];
        if (filters.status) conditions.push(eq(operationalCycles.status, filters.status));
        if (filters.projectId != null) {
            conditions.push(eq(operationalCycles.projectId, filters.projectId));
        }

        const [cycles, totals] = await Promise.all([
            db
                .select()
                .from(operationalCycles)
                .where(and(...conditions))
                .orderBy(desc(operationalCycles.createdAt))
                .limit(filters.limit)
                .offset(filters.offset),
            db
                .select({ total: sql<number>`COUNT(*)::int` })
                .from(operationalCycles)
                .where(and(...conditions)),
        ]);

        return { cycles, total: Number(totals[0]?.total ?? 0) };
    }

    /**
     * A cycle with the children its detail view renders.
     *
     * Read straight from Postgres rather than through the cache: Redis commands
     * can queue during a local outage and this route has to stay deterministic.
     * The limits are the ones the route applied; the remainder is paginated by
     * separate endpoints.
     */
    async findDetail(id: number, principal: CyclePrincipal): Promise<CycleAccessResult<CycleDetail>> {
        const found = await operationalCycleAccess.find(id, principal);
        if (!found.ok) return { ok: false, failure: found.failure };

        const [runs, blueprints, audits] = await Promise.all([
            db
                .select()
                .from(missionRuns)
                .where(and(eq(missionRuns.cycleId, id), isNull(missionRuns.deletedAt)))
                .orderBy(desc(missionRuns.createdAt))
                .limit(50),
            db
                .select()
                .from(cycleBlueprints)
                .where(eq(cycleBlueprints.cycleId, id))
                .orderBy(asc(cycleBlueprints.id))
                .limit(100),
            db
                .select()
                .from(cycleStrategicAudits)
                .where(eq(cycleStrategicAudits.cycleId, id))
                .orderBy(desc(cycleStrategicAudits.createdAt))
                .limit(20),
        ]);

        return { ok: true, cycle: { cycle: found.cycle, runs, blueprints, audits } };
    }


    /**
     * The cycle's in-flight run, if it has one.
     *
     * Used to stop a second manual trigger while a run is still going.
     */
    async findInFlightRun(
        id: number,
        principal: CyclePrincipal,
    ): Promise<CycleAccessResult<{ id: number; status: string | null } | null>> {
        const found = await operationalCycleAccess.find(id, principal);
        if (!found.ok) return { ok: false, failure: found.failure };

        const [run] = await db
            .select({ id: missionRuns.id, status: missionRuns.status })
            .from(missionRuns)
            .where(
                and(
                    eq(missionRuns.cycleId, id),
                    or(
                        eq(missionRuns.status, "active"),
                        eq(missionRuns.status, "running"),
                        eq(missionRuns.status, "pending"),
                    ),
                ),
            )
            .limit(1);

        return { ok: true, cycle: run ?? null };
    }

    /**
     * Fails every live run of a cycle and reports which ones it failed.
     *
     * The route ran the select and the update with the same predicate written
     * out twice; a change to one and not the other would have terminated a
     * different set than it reported. Here the predicate is built once.
     */
    async failActiveRuns(
        id: number,
        principal: CyclePrincipal,
    ): Promise<CycleAccessResult<number[]>> {
        const found = await operationalCycleAccess.find(id, principal);
        if (!found.ok) return { ok: false, failure: found.failure };

        const live = and(
            eq(missionRuns.cycleId, id),
            isNull(missionRuns.deletedAt),
            ACTIVE_RUN_STATUSES,
        );

        const failed = await db.select({ id: missionRuns.id }).from(missionRuns).where(live);
        await db
            .update(missionRuns)
            .set({ status: "failed", updatedAt: new Date() } as any)
            .where(live);

        return { ok: true, cycle: failed.map((row) => row.id) };
    }

    /**
     * A page of the cycle's mission runs.
     *
     * The organization predicate on mission_runs is kept on top of authorizing
     * the cycle: the column is denormalized onto the table, and checking both
     * means a run mis-stamped with the wrong organization cannot be read
     * through a cycle the caller does legitimately own.
     */
    async listRuns(
        id: number,
        principal: CyclePrincipal,
        page: { limit: number; offset: number },
    ): Promise<CycleAccessResult<{ runs: (typeof missionRuns.$inferSelect)[]; total: number }>> {
        const found = await operationalCycleAccess.find(id, principal);
        if (!found.ok) return { ok: false, failure: found.failure };

        const conditions: SQL[] = [eq(missionRuns.cycleId, id), isNull(missionRuns.deletedAt)];
        if (!principal.isSuperAdmin) {
            if (principal.organizationId == null) return { ok: false, failure: "organization-required" };
            conditions.push(eq(missionRuns.organizationId, principal.organizationId));
        }

        const [runs, totals] = await Promise.all([
            db
                .select()
                .from(missionRuns)
                .where(and(...conditions))
                .orderBy(desc(missionRuns.createdAt))
                .limit(page.limit)
                .offset(page.offset),
            db.select({ count: sql<number>`COUNT(*)::int` }).from(missionRuns).where(and(...conditions)),
        ]);

        return { ok: true, cycle: { runs, total: Number(totals[0]?.count ?? 0) } };
    }

    /**
     * A page of the cycle's blueprints.
     *
     * This one closes a cross-tenant read rather than just tidying: the route
     * resolved an org context, never used it, and filtered on cycleId alone.
     * requireCycleRead establishes only that the caller is some organization's
     * admin, not that the cycle is theirs, so any org admin could page any
     * tenant's blueprints by id. Authorizing the cycle first is the fix, and
     * routing children through the cycle is what makes the omission
     * unavailable.
     */
    async listBlueprintsPage(
        id: number,
        principal: CyclePrincipal,
        page: { limit: number; offset: number },
    ): Promise<
        CycleAccessResult<{ blueprints: (typeof cycleBlueprints.$inferSelect)[]; total: number }>
    > {
        const found = await operationalCycleAccess.find(id, principal);
        if (!found.ok) return { ok: false, failure: found.failure };

        const where = eq(cycleBlueprints.cycleId, id);
        const [blueprints, totals] = await Promise.all([
            db
                .select()
                .from(cycleBlueprints)
                .where(where)
                .orderBy(asc(cycleBlueprints.id))
                .limit(page.limit)
                .offset(page.offset),
            db.select({ count: sql<number>`COUNT(*)::int` }).from(cycleBlueprints).where(where),
        ]);

        return { ok: true, cycle: { blueprints, total: Number(totals[0]?.count ?? 0) } };
    }


    /**
     * A cycle's blueprints with its mission runs, at the limits the apps view
     * needs.
     *
     * findDetail() reads the same two tables but for the detail pane, with
     * tighter limits (100 and 50). The apps view needs the whole set to pair
     * every blueprint with its latest run, so the limits are a parameter rather
     * than a second copy of the queries.
     */
    async listBlueprintsAndRuns(
        id: number,
        principal: CyclePrincipal,
        limits: { blueprints: number; runs: number },
    ): Promise<
        CycleAccessResult<{
            blueprints: (typeof cycleBlueprints.$inferSelect)[];
            runs: (typeof missionRuns.$inferSelect)[];
        }>
    > {
        const found = await operationalCycleAccess.find(id, principal);
        if (!found.ok) return { ok: false, failure: found.failure };

        const [blueprints, runs] = await Promise.all([
            db
                .select()
                .from(cycleBlueprints)
                .where(eq(cycleBlueprints.cycleId, id))
                .orderBy(asc(cycleBlueprints.id))
                .limit(limits.blueprints),
            db
                .select()
                .from(missionRuns)
                .where(and(eq(missionRuns.cycleId, id), isNull(missionRuns.deletedAt)))
                .orderBy(desc(missionRuns.createdAt))
                .limit(limits.runs),
        ]);

        return { ok: true, cycle: { blueprints, runs } };
    }


    /**
     * The apps bound to a cycle's missions, with each deployment's health.
     *
     * Four steps, and the first is the subtle one. A mission belongs to a cycle
     * either through a run (mission_runs.cycleId) or, for a cycle that has not
     * executed yet, through the cycle_blueprints rows written at install time,
     * whose config.missionId is the authoritative cycle-to-mission map. Both
     * are unioned so a freshly installed cycle still shows its bound apps
     * before any run exists, and so a re-install - which mints new mission ids
     * in the blueprints - is not masked by stale run rows pointing at the
     * previous install's missions.
     *
     * The organization predicate is applied again to missions and to bindings,
     * on top of authorizing the cycle. Both tables carry a denormalized
     * organization_id, and re-checking it means a row mis-stamped with another
     * tenant cannot be reached through a cycle the caller legitimately owns.
     *
     * Returns rows, not view models: the route owns the presentation, including
     * resolving a shared-server app's workbench module from its label.
     */
    async listMissionBindings(
        id: number,
        principal: CyclePrincipal,
    ): Promise<
        CycleAccessResult<{
            missions: { id: number; name: string | null }[];
            bindings: Array<{
                bindingId: number;
                missionId: number;
                appId: number;
                role: string | null;
                label: string | null;
                openModeDefault: string | null;
                sortOrder: number | null;
                source: string | null;
                appSlug: string | null;
                appName: string | null;
                appMeta: unknown;
                publicSlug: string | null;
                deploymentId: number | null;
            }>;
            instanceHealthByDeployment: Map<number, "running" | "errored" | "stopped">;
        }>
    > {
        const found = await operationalCycleAccess.find(id, principal);
        if (!found.ok) return { ok: false, failure: found.failure };
        const organizationId = found.cycle.organizationId;
        if (organizationId == null) return { ok: false, failure: "organization-required" };

        const empty = { missions: [], bindings: [], instanceHealthByDeployment: new Map() };

        // 1. The cycle's missions, from runs and from install-time blueprints.
        const [runRows, blueprintRows] = await Promise.all([
            db
                .select({ missionId: missionRuns.missionId })
                .from(missionRuns)
                .where(and(eq(missionRuns.cycleId, id), isNotNull(missionRuns.missionId))),
            db
                .select({ config: cycleBlueprints.config })
                .from(cycleBlueprints)
                .where(eq(cycleBlueprints.cycleId, id)),
        ]);

        const missionIds = Array.from(
            new Set(
                [
                    ...runRows.map((row) => row.missionId),
                    ...blueprintRows.map((row) => (row.config as any)?.missionId),
                ].filter((value): value is number => typeof value === "number"),
            ),
        );
        if (missionIds.length === 0) return { ok: true, cycle: empty };

        // 2. The missions themselves, organization-filtered.
        const missionRows = await db
            .select({ id: missions.id, name: missions.name })
            .from(missions)
            .where(and(inArray(missions.id, missionIds), eq(missions.organizationId, organizationId)));
        if (missionRows.length === 0) return { ok: true, cycle: empty };

        // 3. Bindings with the app metadata the view needs, in one query.
        const bindings = await db
            .select({
                bindingId: missionAppBindings.id,
                missionId: missionAppBindings.missionId,
                appId: missionAppBindings.appId,
                role: missionAppBindings.role,
                label: missionAppBindings.label,
                openModeDefault: missionAppBindings.openModeDefault,
                sortOrder: missionAppBindings.sortOrder,
                source: missionAppBindings.source,
                appSlug: apps.slug,
                appName: apps.name,
                appMeta: apps.runtimeMetadata,
                publicSlug: appDeployments.publicSlug,
                deploymentId: appDeployments.id,
            })
            .from(missionAppBindings)
            .innerJoin(apps, eq(apps.id, missionAppBindings.appId))
            .leftJoin(appDeployments, eq(appDeployments.appId, apps.id))
            .where(
                and(
                    inArray(
                        missionAppBindings.missionId,
                        missionRows.map((m) => m.id),
                    ),
                    eq(missionAppBindings.organizationId, organizationId),
                ),
            )
            .orderBy(missionAppBindings.missionId, missionAppBindings.sortOrder);

        // 4. Instance health per deployment, batched rather than N+1.
        const deploymentIds = Array.from(
            new Set(bindings.map((b) => b.deploymentId).filter((v): v is number => v != null)),
        );
        const instanceHealthByDeployment = new Map<number, "running" | "errored" | "stopped">();
        if (deploymentIds.length > 0) {
            const instances = await db
                .select({ deploymentId: appInstances.deploymentId, status: appInstances.status })
                .from(appInstances)
                .where(inArray(appInstances.deploymentId, deploymentIds));

            // running beats errored beats stopped: a deployment with both a
            // running and an errored instance counts as running.
            const rank = { running: 2, errored: 1, stopped: 0 } as const;
            for (const instance of instances) {
                const next =
                    instance.status === "running"
                        ? "running"
                        : instance.status === "errored"
                          ? "errored"
                          : "stopped";
                const current = instanceHealthByDeployment.get(instance.deploymentId);
                if (!current || rank[next] > rank[current]) {
                    instanceHealthByDeployment.set(instance.deploymentId, next);
                }
            }
        }

        return {
            ok: true,
            cycle: { missions: missionRows, bindings, instanceHealthByDeployment },
        };
    }

    /** Every blueprint of a cycle this principal may see, in insertion order. */
    async listBlueprints(
        id: number,
        principal: CyclePrincipal,
    ): Promise<CycleAccessResult<(typeof cycleBlueprints.$inferSelect)[]>> {
        const found = await operationalCycleAccess.find(id, principal);
        if (!found.ok) return { ok: false, failure: found.failure };

        const blueprints = await db
            .select()
            .from(cycleBlueprints)
            .where(eq(cycleBlueprints.cycleId, id))
            .orderBy(asc(cycleBlueprints.id));

        return { ok: true, cycle: blueprints };
    }

    /** One named blueprint of a cycle this principal may see. */
    async findBlueprintByName(
        id: number,
        principal: CyclePrincipal,
        name: string,
    ): Promise<
        | { ok: true; cycle: typeof cycleBlueprints.$inferSelect }
        | { ok: false; failure: BlueprintAccessFailure }
    > {
        const found = await operationalCycleAccess.find(id, principal);
        if (!found.ok) return { ok: false, failure: found.failure };

        const [blueprint] = await db
            .select()
            .from(cycleBlueprints)
            .where(and(eq(cycleBlueprints.cycleId, id), eq(cycleBlueprints.name, name)))
            .limit(1);

        return blueprint
            ? { ok: true, cycle: blueprint }
            : { ok: false, failure: "blueprint-not-found" };
    }


    /**
     * Records a blueprint's runtime status on its metadata.
     *
     * A domain operation rather than three queries: the route read the cycle to
     * authorize, read the blueprint by name, then merged a `runtime` block into
     * its metadata. Terminal statuses additionally stamp the output and a
     * completion time, which is what lets the UI distinguish "still running"
     * from "finished with nothing to show".
     */
    async setBlueprintRuntimeStatus(
        id: number,
        principal: CyclePrincipal,
        name: string,
        status: string,
        output?: unknown,
    ): Promise<
        | {
              ok: true;
              cycle: typeof operationalCycles.$inferSelect;
              blueprint: typeof cycleBlueprints.$inferSelect;
          }
        | { ok: false; failure: BlueprintAccessFailure }
    > {
        const found = await operationalCycleAccess.find(id, principal);
        if (!found.ok) return { ok: false, failure: found.failure };

        const [blueprint] = await db
            .select()
            .from(cycleBlueprints)
            .where(and(eq(cycleBlueprints.cycleId, id), eq(cycleBlueprints.name, name)))
            .limit(1);
        if (!blueprint) return { ok: false, failure: "blueprint-not-found" };

        const metadata = (blueprint.metadata as Record<string, any>) ?? {};
        const isTerminal = ["completed", "failed", "skipped"].includes(status);
        const nowIso = new Date().toISOString();

        await db
            .update(cycleBlueprints)
            .set({
                metadata: {
                    ...metadata,
                    runtime: {
                        ...(metadata.runtime ?? {}),
                        status,
                        ...(isTerminal ? { output, completedAt: nowIso } : {}),
                        updatedAt: nowIso,
                    },
                } as any,
                updatedAt: new Date(),
            })
            .where(eq(cycleBlueprints.id, blueprint.id));

        return { ok: true, cycle: found.cycle, blueprint };
    }

    /** Replaces one blueprint's metadata, having authorized the owning cycle. */
    async setBlueprintMetadata(
        id: number,
        principal: CyclePrincipal,
        name: string,
        metadata: unknown,
    ): Promise<{ ok: true; id: number } | { ok: false; failure: BlueprintAccessFailure }> {
        const blueprint = await this.findBlueprintByName(id, principal, name);
        if (!blueprint.ok) return blueprint;

        await db
            .update(cycleBlueprints)
            .set({ metadata: metadata as any })
            .where(and(eq(cycleBlueprints.cycleId, id), eq(cycleBlueprints.name, name)));

        return { ok: true, id };
    }

    /**
     * Replaces a cycle's blueprint set and rebuilds its dependency gates.
     *
     * One transaction because the three writes are a single fact about the
     * cycle: the metadata copy, the relational cycle_blueprints rows, and the
     * gates derived from their dependencies. Letting any pair diverge leaves a
     * cycle whose gates name blueprints that no longer exist.
     *
     * The cycle update carries the organization predicate, so a principal who
     * may not touch this cycle changes nothing: the update matches no row, the
     * transaction returns null, and the children are never rewritten.
     */
    async replaceBlueprints(
        id: number,
        principal: CyclePrincipal,
        input: {
            metadata: unknown;
            blueprints: CycleBlueprintInput[];
            /**
             * Columns on the cycle itself to set in the same transaction, for an
             * in-place revision that rewrites the cycle and its blueprints
             * together. Omitted for a blueprint-only replacement.
             */
            cycle?: CycleRevisableFields;
        },
    ): Promise<CycleAccessResult<typeof operationalCycles.$inferSelect>> {
        const conditions = scopeFor(id, principal, false);
        if (!conditions) return { ok: false, failure: "organization-required" };

        const updated = await db.transaction(async (tx) => {
            const [cycle] = await tx
                .update(operationalCycles)
                .set({
                    // The caller's fields first, so the four this method owns
                    // cannot be overridden by them even if the whitelist is
                    // later widened by mistake.
                    ...(input.cycle ?? {}),
                    metadata: input.metadata as any,
                    blueprintCount: input.blueprints.length,
                    updatedAt: new Date(),
                })
                .where(and(...conditions))
                .returning();

            if (!cycle) return null;

            await tx.delete(cycleBlueprints).where(eq(cycleBlueprints.cycleId, id));
            if (input.blueprints.length > 0) {
                await tx.insert(cycleBlueprints).values(
                    input.blueprints.map((bp) => ({
                        cycleId: id,
                        name: bp.name,
                        objective: bp.objective,
                        type: bp.type || "mission",
                        dependencies: (bp.dependencies ?? []) as any,
                        estimatedDays: bp.estimatedDays,
                        config: (bp.config ?? {}) as any,
                        metadata: (bp.metadata ?? {}) as any,
                    })),
                );
            }

            await tx.delete(cycleDependencyGates).where(eq(cycleDependencyGates.cycleId, id));
            const gates = input.blueprints.flatMap((bp) =>
                ((bp.dependencies ?? []) as any[]).map((dep) => ({
                    cycleId: id,
                    upstreamBlueprintName: dep.blueprintName,
                    downstreamBlueprintName: bp.name,
                    dependencyType: dep.type || "finish_to_start",
                    status: "waiting",
                })),
            );
            if (gates.length > 0) {
                await tx.insert(cycleDependencyGates).values(gates);
            }

            return cycle;
        });

        return updated ? { ok: true, cycle: updated } : { ok: false, failure: "not-found" };
    }
}

export const operationalCycleAggregate = new OperationalCycleAggregateService();


/** HTTP status for a refusal, so each route does not re-decide it. */
export function statusForCycleFailure(failure: CycleAccessFailure): 403 | 404 {
    return failure === "organization-required" ? 403 : 404;
}

/** The message bodies the existing routes already returned. */
export function bodyForCycleFailure(failure: CycleAccessFailure): { error: string } {
    return failure === "organization-required"
        ? { error: "Organization context required" }
        : { error: "Cycle not found" };
}
