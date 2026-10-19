/**
 * Read access to an installed app's stored records (`app_records`) for agents.
 *
 * An app's records are namespaced by (appId, orgId, collection). Which app row
 * holds an org's data is not uniform: an org can run its own install copy
 * (slug `<base>` or `<base>-org<orgId>`, organization_id = the org), or write
 * against the shared system row under its own org id — BudgetMaster and Rescue
 * Dispatch do the latter. Both are candidates; the one holding this org's
 * records wins, and every record read is filtered to the caller's org, so a
 * shared row never exposes another tenant's data.
 *
 * Three further gates, each answering a different question:
 *
 *  - Project Space. An app's project is its deployment's for this org, else the
 *    app row's. An app in a project the caller cannot read resolves exactly like
 *    a missing one; a governed agent is held to its own project grants.
 *  - The room. Data from a PRIVATE project is only read from a room in that same
 *    project: an agent's reply is visible to everyone in the room it speaks in,
 *    so reading project B's records into project A's room hands them to A.
 *  - Finance roles. Records mirrored from QuickBooks (record ids `qbo:…`) are the
 *    same data the `quickbooks_*` tools gate per entity; reading them here needs
 *    the same finance role, on the project of the connection that wrote them.
 */

import { and, asc, desc, eq, isNull, like, or, sql, type SQL } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { apps, appDeployments, appRecords, saasConnectors } from "@shared/schema/index.js";
import { NotFoundError, BadRequestError } from "@server/utils/errors.js";
import { projectService, type ProjectCtx } from "@domain/projects/core/project.service.js";

/** Collection and field names are used as JSON keys; keep them to identifiers. */
const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;

export interface ReaderCtx {
    organizationId: number;
    userId?: string;
    /** The speaking agent's name: a governed agent is capped to its own project grants. */
    agentName?: string;
    isOrgAdmin?: boolean;
    isSuperAdmin?: boolean;
    /**
     * The Project Space of the room this read will be spoken into. `undefined`
     * when the read is not spoken into a shared room (a private copilot chat).
     */
    roomProjectId?: number | null;
}

export interface ResolvedApp {
    id: number;
    slug: string;
    name: string;
}

export interface CollectionSummary {
    collection: string;
    records: number;
    lastUpdatedAt: string | null;
    /** Mirrored from QuickBooks: reading it needs a finance role. */
    quickbooks: boolean;
}

export interface RecordFilter {
    recordId?: string;
    filterField?: string;
    filterValue?: string;
}

export interface RecordPage {
    app: ResolvedApp;
    collection: string;
    total: number;
    offset: number;
    records: Array<{ recordId: string; data: unknown; updatedAt: string }>;
}

export const AGGREGATE_OPS = ["count", "sum", "avg", "min", "max"] as const;
export type AggregateOp = (typeof AGGREGATE_OPS)[number];

export interface AggregateResult {
    app: ResolvedApp;
    collection: string;
    op: AggregateOp;
    field: string | null;
    groupBy: string | null;
    /** Records the filter matched. */
    matched: number;
    /** Of those, records whose field held a number (all of them for count). */
    counted: number;
    value: number | null;
    groups?: Array<{ key: string | null; value: number | null; counted: number }>;
    totalGroups?: number;
}

function projectCtx(ctx: ReaderCtx): ProjectCtx {
    return {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        agentId: ctx.agentName,
        isOrgAdmin: ctx.isOrgAdmin,
        isSuperAdmin: ctx.isSuperAdmin,
    };
}

function assertName(value: string, what: string): void {
    if (!NAME_PATTERN.test(value)) throw new BadRequestError(`Invalid ${what} '${value}'.`);
}

async function recordCount(appId: number, orgId: number): Promise<number> {
    const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(appRecords)
        .where(and(eq(appRecords.appId, appId), eq(appRecords.orgId, orgId)));
    return row?.n ?? 0;
}

/**
 * Resolve the app row that holds `ctx.organizationId`'s records for `app`,
 * given as a slug (preferred) or a display name.
 */
export async function resolveAppForRecords(ctx: ReaderCtx, app: string): Promise<ResolvedApp> {
    const orgId = ctx.organizationId;
    const wanted = app.trim();
    if (!wanted) throw new BadRequestError("Name the app to read, by slug or name.");
    const base = wanted.replace(new RegExp(`-org${orgId}$`), "");
    // Deployment URLs and catalog slugs are different identifiers. Resolve
    // either through the same tenant/project/room visibility gates below.
    const deploymentSlug = wanted.match(/^(?:\/app\/)?([a-z0-9-]+)(?:\/[a-z0-9-]+)*(?:[?#].*)?$/)?.[1];

    const candidates = await db
        .select({
            id: apps.id,
            slug: apps.slug,
            name: apps.name,
            organizationId: apps.organizationId,
            appProjectId: apps.projectId,
            deploymentProjectId: appDeployments.projectId,
        })
        .from(apps)
        .leftJoin(appDeployments, and(eq(appDeployments.appId, apps.id), eq(appDeployments.organizationId, orgId)))
        .where(and(
            or(
                eq(apps.slug, base),
                eq(apps.slug, `${base}-org${orgId}`),
                sql`lower(${apps.name}) = lower(${wanted})`,
                ...(deploymentSlug ? [eq(appDeployments.publicSlug, deploymentSlug)] : []),
            ),
            or(eq(apps.organizationId, orgId), isNull(apps.organizationId)),
        ));

    const visible: typeof candidates = [];
    let heldByRoom = false;
    for (const row of candidates) {
        const projectId = row.deploymentProjectId ?? row.appProjectId;
        if (projectId == null) { visible.push(row); continue; }
        let project;
        try {
            project = await projectService.getProject(projectCtx(ctx), projectId);
        } catch {
            continue; // Not readable by this caller: indistinguishable from absent.
        }
        if (project.visibility === "private" && ctx.roomProjectId !== undefined && ctx.roomProjectId !== project.id) {
            heldByRoom = true;
            continue;
        }
        visible.push(row);
    }
    if (visible.length === 0) {
        if (heldByRoom) {
            throw new NotFoundError(
                `'${wanted}' belongs to a private Project Space other than this room's, so its records cannot be read into this room. ` +
                "Read it from a room in that project.",
            );
        }
        throw new NotFoundError(`No app '${wanted}' is available to this organization. Call list_installed_apps for valid slugs.`);
    }

    // The row holding this org's records first; among equals, the org's own copy.
    const scored = await Promise.all(visible.map(async (row) => ({
        row,
        records: await recordCount(row.id, orgId),
        own: row.organizationId === orgId,
    })));
    scored.sort((a, b) =>
        Number(b.records > 0) - Number(a.records > 0) || Number(b.own) - Number(a.own) || b.records - a.records);
    const { row } = scored[0];
    return { id: row.id, slug: row.slug, name: row.name };
}

export async function listAppCollections(appId: number, orgId: number): Promise<CollectionSummary[]> {
    const rows = await db
        .select({
            collection: appRecords.collection,
            records: sql<number>`count(*)::int`,
            lastUpdatedAt: sql<Date | null>`max(${appRecords.updatedAt})`,
            quickbooks: sql<boolean>`bool_or(${appRecords.recordId} like 'qbo:%')`,
        })
        .from(appRecords)
        .where(and(eq(appRecords.appId, appId), eq(appRecords.orgId, orgId)))
        .groupBy(appRecords.collection)
        .orderBy(asc(appRecords.collection));
    return rows.map((r) => ({
        collection: r.collection,
        records: r.records,
        lastUpdatedAt: r.lastUpdatedAt ? new Date(r.lastUpdatedAt).toISOString() : null,
        quickbooks: Boolean(r.quickbooks),
    }));
}

function scopeConditions(app: ResolvedApp, orgId: number, collection: string, filter: RecordFilter): SQL[] {
    assertName(collection, "collection name");
    const conditions: SQL[] = [
        eq(appRecords.appId, app.id),
        eq(appRecords.orgId, orgId),
        eq(appRecords.collection, collection),
    ];
    if (filter.recordId !== undefined) {
        if (typeof filter.recordId !== 'string' || !filter.recordId.trim() || filter.recordId.length > 150) throw new BadRequestError('Invalid recordId.');
        conditions.push(eq(appRecords.recordId, filter.recordId.trim()));
    }
    if (filter.filterField) {
        assertName(filter.filterField, "filter field");
        if (filter.filterValue == null) throw new BadRequestError("filterValue is required with filterField.");
        // Field travels as a bound parameter, so ->> never sees raw input.
        conditions.push(sql`lower(${appRecords.data} ->> ${filter.filterField}) = lower(${filter.filterValue})`);
    }
    return conditions;
}

/**
 * Records mirrored from QuickBooks need the same finance role the quickbooks_*
 * tools require, judged on the project of the connection that wrote them.
 * Throws PermissionRequiredError (rendered as a card) for the first missing one.
 */
async function assertFinanceRead(ctx: ReaderCtx, conditions: SQL[]): Promise<void> {
    const mirrored = await db
        .selectDistinct({
            connectorId: sql<string>`split_part(${appRecords.recordId}, ':', 3)`,
            entity: sql<string>`split_part(${appRecords.recordId}, ':', 4)`,
        })
        .from(appRecords)
        .where(and(...conditions, like(appRecords.recordId, "qbo:%")));
    if (mirrored.length === 0) return;

    const { financeRolesService } = await import("@domain/projects/core/finance-roles.service.js");
    const { QUICKBOOKS_ENTITIES } = await import("@domain/integrations/quickbooks/client.js");
    const projectByConnector = new Map<number, number | null>();
    for (const { connectorId, entity } of mirrored) {
        const id = Number(connectorId);
        if (!projectByConnector.has(id)) {
            const [connector] = Number.isInteger(id)
                ? await db.select({ projectId: saasConnectors.projectId }).from(saasConnectors)
                    .where(and(eq(saasConnectors.id, id), eq(saasConnectors.orgId, ctx.organizationId))).limit(1)
                : [];
            projectByConnector.set(id, connector?.projectId ?? null);
        }
        const qboEntity = QUICKBOOKS_ENTITIES.find((e) => e.toLowerCase() === entity) ?? entity;
        await financeRolesService.assertCan({
            organizationId: ctx.organizationId,
            projectId: projectByConnector.get(id) ?? null,
            userId: ctx.userId,
            isOrgAdmin: ctx.isOrgAdmin,
            isSuperAdmin: ctx.isSuperAdmin,
        }, qboEntity, "read");
    }
}

export async function readAppRecords(
    ctx: ReaderCtx,
    app: ResolvedApp,
    opts: RecordFilter & { collection: string; limit: number; offset: number },
): Promise<RecordPage> {
    const conditions = scopeConditions(app, ctx.organizationId, opts.collection, opts);
    await assertFinanceRead(ctx, conditions);
    const where = and(...conditions);

    const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(appRecords).where(where);
    const rows = await db
        .select({ recordId: appRecords.recordId, data: appRecords.data, updatedAt: appRecords.updatedAt })
        .from(appRecords)
        .where(where)
        .orderBy(desc(appRecords.updatedAt), asc(appRecords.id))
        .limit(opts.limit)
        .offset(opts.offset);

    return {
        app,
        collection: opts.collection,
        total,
        offset: opts.offset,
        records: rows.map((r) => ({ recordId: r.recordId, data: r.data, updatedAt: r.updatedAt.toISOString() })),
    };
}

/**
 * Look up a single record by its recordId (or logical id/ticketId field) within
 * an already-authorized app and collection, enforcing the same finance role gate.
 */
export async function readAppRecordById(
    ctx: ReaderCtx,
    app: ResolvedApp,
    collection: string,
    recordId: string,
): Promise<{ recordId: string; updatedAt: string } | null> {
    const trimmed = recordId.trim();
    if (!trimmed || trimmed.length > 150) return null;
    const conditions = scopeConditions(app, ctx.organizationId, collection, {});
    const matchCondition = or(
        eq(appRecords.recordId, trimmed),
        sql`${appRecords.data} ->> 'id' = ${trimmed}`,
        sql`${appRecords.data} ->> 'ticketId' = ${trimmed}`,
    )!;
    const allConditions = [...conditions, matchCondition];
    await assertFinanceRead(ctx, allConditions);
    const [row] = await db
        .select({ recordId: appRecords.recordId, updatedAt: appRecords.updatedAt })
        .from(appRecords)
        .where(and(...allConditions))
        .limit(1);
    if (!row) return null;
    return { recordId: row.recordId, updatedAt: row.updatedAt.toISOString() };
}

/**
 * count/sum/avg/min/max over one numeric field, optionally per value of
 * another. Values that are not numbers are skipped and reported as such, never
 * coerced to zero. Summing across currencies is refused rather than mixed.
 */
export async function aggregateAppRecords(
    ctx: ReaderCtx,
    app: ResolvedApp,
    opts: RecordFilter & { collection: string; op: AggregateOp; field?: string; groupBy?: string },
): Promise<AggregateResult> {
    // The op is spliced into SQL as a function name, so it is checked here, not
    // only by the tool's schema.
    if (!AGGREGATE_OPS.includes(opts.op)) throw new BadRequestError(`Unsupported aggregate '${opts.op}'.`);
    const conditions = scopeConditions(app, ctx.organizationId, opts.collection, opts);
    if (opts.op !== "count") {
        if (!opts.field) throw new BadRequestError(`'${opts.op}' needs a numeric field.`);
        assertName(opts.field, "field");
    }
    if (opts.groupBy) assertName(opts.groupBy, "groupBy field");
    await assertFinanceRead(ctx, conditions);
    const where = and(...conditions);

    if (opts.op === "sum" || opts.op === "avg") {
        const currencyFixed = opts.groupBy === "currency" || opts.filterField === "currency";
        if (!currencyFixed) {
            const [{ currencies }] = await db
                .select({ currencies: sql<number>`count(distinct ${appRecords.data} ->> 'currency')::int` })
                .from(appRecords).where(where);
            if (currencies > 1) {
                throw new BadRequestError(
                    `These records are in ${currencies} currencies; a ${opts.op} across them would mix units. ` +
                    "Group by 'currency', or filter on one currency.",
                );
            }
        }
    }

    const numeric = opts.field
        ? sql`case
            when jsonb_typeof(${appRecords.data} -> ${opts.field}) = 'number' then (${appRecords.data} ->> ${opts.field})::numeric
            when (${appRecords.data} ->> ${opts.field}) ~ '^-?[0-9]+(\\.[0-9]+)?$' then (${appRecords.data} ->> ${opts.field})::numeric
          end`
        : null;
    const valueExpr = opts.op === "count"
        ? sql<number>`count(*)::float8`
        : sql<number | null>`${sql.raw(opts.op)}(${numeric})::float8`;
    const countedExpr = numeric ? sql<number>`count(${numeric})::int` : sql<number>`count(*)::int`;

    const [overall] = await db
        .select({ matched: sql<number>`count(*)::int`, counted: countedExpr, value: valueExpr })
        .from(appRecords).where(where);

    const result: AggregateResult = {
        app,
        collection: opts.collection,
        op: opts.op,
        field: opts.field ?? null,
        groupBy: opts.groupBy ?? null,
        matched: overall?.matched ?? 0,
        counted: overall?.counted ?? 0,
        value: overall?.value ?? null,
    };

    if (opts.groupBy) {
        const key = sql<string | null>`${appRecords.data} ->> ${opts.groupBy}`;
        const groups = await db
            .select({ key, value: valueExpr, counted: countedExpr, totalGroups: sql<number>`(count(*) over ())::int` })
            .from(appRecords).where(where)
            // By position: the key's field name is a bound parameter, so the same
            // expression written twice would be two different parameters to Postgres.
            .groupBy(sql`1`)
            .orderBy(sql`2 desc nulls last`)
            .limit(50);
        result.groups = groups.map((g) => ({ key: g.key, value: g.value, counted: g.counted }));
        result.totalGroups = groups[0]?.totalGroups ?? 0;
    }
    return result;
}
