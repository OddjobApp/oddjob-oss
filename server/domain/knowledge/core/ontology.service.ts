import { FINANCIAL_TYPES, FINANCIAL_LINKS } from './financial-ontology.js';
import { eq, and, or, desc, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
    ontologyObjectTypes,
    ontologyObjects,
    ontologyActions,
    ontologyActionLog,
    ontologyLinkTypes,
    ontologyLinks,
    ONTOLOGY_LINK_BACKINGS,
    type OntologyObjectType,
    type OntologyAction,
    type OntologyLinkCardinality,
} from "@shared/schema/ontology/ontology.js";
import { createLogger } from "../../../utils/logger.js";
import { NotFoundError, BadRequestError, ForbiddenError } from "@server/utils/errors.js";
import { getAdapter, ONTOLOGY_ADAPTERS } from "./ontology-adapters.js";

const logger = createLogger("OntologyService");

/**
 * DB-backed, org-scoped AIP-style Ontology.
 *
 * Replaces the former in-memory mock. Every read/write is scoped to
 * ctx.organizationId — the org id is NEVER taken from a caller-supplied parameter,
 * which is what makes cross-tenant access impossible by construction.
 *
 * See docs/specs/ONTOLOGY_SERVICE_DESIGN.md.
 */

export interface OntologyCtx {
    /** Resolved, non-null org id. Callers (tools/routes) must resolve this. */
    organizationId: number;
    userId?: string;
    isSuperAdmin?: boolean;
    /** Optional session/mission linkage, forwarded to the approval request for a write. */
    sessionId?: string;
    missionId?: number;
    missionRunId?: number;
}

export interface OntologyObjectTypeView {
    name: string;
    description: string | null;
    properties: Record<string, string>;
    titleProperty: string | null;
    backing: string;
}

export interface OntologyLinkTypeView {
    name: string;
    inverseName: string;
    description: string | null;
    sourceType: string;
    /** null => polymorphic; the concrete type is named by targetTypeProperty. */
    targetType: string | null;
    cardinality: string;
    backing: string;
    sourceProperty: string | null;
    targetProperty: string | null;
    targetTypeProperty: string | null;
    targetTypeMap: Record<string, string>;
}

export interface OntologyTraversalResult {
    link: {
        /** The name as traversed — the forward name, or the inverse one. */
        name: string;
        direction: "forward" | "inverse";
        fromType: string;
        toType: string | null;
    };
    objects: Array<Record<string, any>>;
    /**
     * False when the answer may be partial: the Object Type's adapter cannot filter
     * on the join property, so the service scanned a bounded page and matched in
     * memory. A caller that treats a partial answer as the whole set draws exactly
     * the wrong conclusion ("nothing depends on this, safe to delete"), so this is
     * reported rather than left to be inferred from a row count.
     */
    complete: boolean;
    /** Why the result is empty or partial, when that needs saying. */
    note?: string;
}

/**
 * Loose equality across the string/number boundary that JSONB storage and adapter
 * projections blur: a join key read back from `properties` is a string where the
 * same value off a typed column is a number, and an exact comparison would make
 * every materialized-to-virtual traversal return nothing.
 */
function sameValue(a: any, b: any): boolean {
    if (a === null || a === undefined || b === null || b === undefined) return false;
    return String(a) === String(b);
}

/**
 * Coerce a join value to the declared type of the property it will be matched
 * against. Returns undefined when the value cannot be that type at all — a
 * non-numeric string against an integer column, which Postgres raises on rather
 * than returning no rows.
 */
export function coercePropertyValue(declaredType: string | undefined, value: any): any {
    if (value === null || value === undefined) return undefined;
    if (declaredType === "integer" || declaredType === "number") {
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
    }
    if (declaredType === "boolean") {
        if (typeof value === "boolean") return value;
        const s = String(value).toLowerCase();
        return s === "true" ? true : s === "false" ? false : undefined;
    }
    return typeof value === "string" ? value : String(value);
}

/**
 * Postgres 22P02, "invalid text representation": the bound value is not a legal
 * literal for the column's type. In these queries the only caller-supplied bind is
 * the filter value, so this can mean nothing else.
 */
function isUnrepresentableValue(e: any): boolean {
    return e?.code === "22P02" || e?.cause?.code === "22P02";
}

export interface OntologyActionResult {
    status: "executed" | "approval_required" | "denied" | "failed";
    message: string;
    result?: any;
    /** decision-router request id, when the action went through the approval gate. */
    approvalId?: number;
}

/** A builtin (code-registered) write handler. Allow-listed at startup. */
export type OntologyBuiltinHandler = (
    ctx: OntologyCtx,
    params: Record<string, any>,
) => Promise<any>;

/**
 * A named, parameterized SQL handler. Registered in code (never built from action
 * params) so `handler_ref` can only name a vetted, org-scoped query — no raw SQL from
 * the caller. The handler receives the org id and validated params and returns rows.
 */
export type OntologySqlHandler = (
    ctx: OntologyCtx,
    params: Record<string, any>,
) => Promise<any>;

/**
 * The org-isolation gate. Every service method funnels through this — a call without
 * a resolved numeric org id is refused rather than defaulted, so cross-tenant access
 * is impossible by construction. Exported for unit testing.
 */
export function requireOrg(ctx: OntologyCtx): number {
    if (!ctx || typeof ctx.organizationId !== "number") {
        throw new ForbiddenError("Ontology access requires a resolved organization context.");
    }
    return ctx.organizationId;
}

/**
 * Validate action params against a stored `{ key: type }` schema. Pure; exported for
 * unit testing. Throws BadRequestError on the first violation.
 */
export function validateActionParams(
    schema: Record<string, string>,
    params: Record<string, any>,
    actionName: string,
): void {
    for (const [key, type] of Object.entries(schema ?? {})) {
        if (params?.[key] === undefined || params?.[key] === null) {
            throw new BadRequestError(`Missing required parameter '${key}' for action '${actionName}'.`);
        }
        if (type === "integer" && !Number.isInteger(Number(params[key]))) {
            throw new BadRequestError(`Parameter '${key}' must be an integer.`);
        }
    }
}

export class OntologyService {
    /** Allow-listed builtin action handlers, keyed by handlerRef. */
    private static readonly builtins = new Map<string, OntologyBuiltinHandler>();
    /** Allow-listed named SQL handlers, keyed by handlerRef. */
    private static readonly sqlHandlers = new Map<string, OntologySqlHandler>();

    static registerBuiltin(ref: string, handler: OntologyBuiltinHandler): void {
        this.builtins.set(ref, handler);
    }

    static registerSqlHandler(ref: string, handler: OntologySqlHandler): void {
        this.sqlHandlers.set(ref, handler);
    }

    // ---- Object Types -----------------------------------------------------

    async listObjectTypes(ctx: OntologyCtx): Promise<OntologyObjectTypeView[]> {
        const org = requireOrg(ctx);
        await this.ensureDefaultsSeeded(ctx, org);
        const rows = await db
            .select()
            .from(ontologyObjectTypes)
            .where(and(eq(ontologyObjectTypes.organizationId, org), eq(ontologyObjectTypes.isActive, true)));
        return rows.map((r) => this.toTypeView(r));
    }

    async getObjectType(ctx: OntologyCtx, name: string): Promise<OntologyObjectType> {
        const org = requireOrg(ctx);
        await this.ensureDefaultsSeeded(ctx, org);
        const rows = await db
            .select()
            .from(ontologyObjectTypes)
            .where(and(eq(ontologyObjectTypes.organizationId, org), eq(ontologyObjectTypes.name, name)))
            .limit(1);
        const def = rows[0];
        if (!def) throw new NotFoundError(`Ontology Object type '${name}' not found.`);
        return def;
    }

    /** Orgs whose defaults have been checked in this process. */
    private readonly defaultsChecked = new Map<number, Promise<void>>();

    /**
     * Register any default Object Type this org is missing, once per process.
     *
     * seedDefaultObjectTypes otherwise runs only when an org is CREATED, so an org
     * that predates a default — or predates the ontology tables existing at all —
     * reads an empty ontology forever. Every read funnels through here instead, so
     * an existing org picks the defaults up the first time it touches the ontology,
     * and a newly added default (Query) reaches orgs created before it.
     *
     * The check reads names rather than counting: a count cannot tell a missing
     * default from a custom type, and comparing names is what lets a single new
     * default trigger a re-seed. Deactivated types count as present — isActive is
     * deliberately not filtered here, so a type an org switched off stays off.
     */
    private async ensureDefaultsSeeded(ctx: OntologyCtx, org: number): Promise<void> {
        let check = this.defaultsChecked.get(org);
        if (!check) {
            check = (async () => {
                const existing = await db
                    .select({ name: ontologyObjectTypes.name })
                    .from(ontologyObjectTypes)
                    .where(eq(ontologyObjectTypes.organizationId, org));
                const have = new Set(existing.map((r) => r.name));
                if (!OntologyService.DEFAULT_VIRTUAL_TYPES.every((t) => have.has(t.name))) {
                    await this.seedDefaultObjectTypes({ ...ctx, organizationId: org });
                }

                // Actions are back-filled on the same reasoning as types: seeding at
                // org creation alone would leave every existing org unable to run an
                // Action that shipped after it, which is all of them.
                const haveActions = new Set(
                    (
                        await db
                            .select({ name: ontologyActions.name })
                            .from(ontologyActions)
                            .where(eq(ontologyActions.organizationId, org))
                    ).map((r) => r.name),
                );
                if (!OntologyService.DEFAULT_ACTIONS.every((a) => haveActions.has(a.name))) {
                    await this.seedDefaultActions({ ...ctx, organizationId: org });
                }

                // Link Types back-fill for the same reason again, and AFTER the types:
                // a default link can only be declared once both of its ends exist.
                //
                // Keyed on (source type, name), which is the table's own uniqueness.
                // Matching on the name alone would let an org's CUSTOM link block a
                // default that shares its name from a different source type: the name
                // would already be in the set, the guard would call the default
                // present, and the insert that would have succeeded is never
                // attempted. Nothing collides today, but the failure only appears when
                // a new default is added later, and then it appears as a link that
                // silently never exists for that one org.
                const haveLinks = new Set(
                    (
                        await db
                            .select({
                                name: ontologyLinkTypes.name,
                                sourceType: ontologyObjectTypes.name,
                            })
                            .from(ontologyLinkTypes)
                            .innerJoin(
                                ontologyObjectTypes,
                                eq(ontologyObjectTypes.id, ontologyLinkTypes.sourceTypeId),
                            )
                            .where(eq(ontologyLinkTypes.organizationId, org))
                    ).map((r) => `${r.sourceType}::${r.name}`),
                );
                if (
                    !OntologyService.DEFAULT_LINK_TYPES.every((l) =>
                        haveLinks.has(`${l.sourceType}::${l.name}`),
                    )
                ) {
                    await this.seedDefaultLinkTypes({ ...ctx, organizationId: org });
                }
            })().catch((err: any) => {
                // Seeding must never fail the read that triggered it: the org keeps
                // whatever types it already has. Dropping the memo lets the next call
                // retry, so a transient DB error is not cached for the process's life.
                this.defaultsChecked.delete(org);
                logger.warn(`[Ontology] Could not seed defaults (types, actions, links) for org ${org}: ${err?.message ?? err}`);
            });
            this.defaultsChecked.set(org, check);
        }
        await check;
    }

    private toTypeView(r: OntologyObjectType): OntologyObjectTypeView {
        // For virtual types the property map lives on the adapter; for materialized
        // types it's stored on the row.
        const adapter = r.backing === "virtual" && r.sourceAdapter ? getAdapter(r.sourceAdapter) : undefined;
        return {
            name: r.name,
            description: r.description,
            properties: adapter ? adapter.properties : ((r.propertiesSchema as Record<string, string>) ?? {}),
            titleProperty: adapter ? adapter.titleProperty : r.titleProperty,
            backing: r.backing,
        };
    }

    // ---- Objects ----------------------------------------------------------

    async listObjects(
        ctx: OntologyCtx,
        typeName: string,
        opts?: { limit?: number },
    ): Promise<Array<Record<string, any>>> {
        const org = requireOrg(ctx);
        const def = await this.getObjectType(ctx, typeName);

        if (def.backing === "virtual") {
            const adapter = def.sourceAdapter ? getAdapter(def.sourceAdapter) : undefined;
            if (!adapter) throw new BadRequestError(`Object type '${typeName}' has no registered adapter '${def.sourceAdapter}'.`);
            return adapter.list(ctx, { limit: opts?.limit });
        }

        const rows = await db
            .select()
            .from(ontologyObjects)
            .where(and(eq(ontologyObjects.organizationId, org), eq(ontologyObjects.objectTypeId, def.id)))
            .orderBy(desc(ontologyObjects.createdAt))
            .limit(Math.min(Math.max(1, opts?.limit ?? 50), 200));
        return rows.map((r) => ({ id: r.externalId ?? r.id, ...(r.properties as Record<string, any>) }));
    }

    async getObject(ctx: OntologyCtx, typeName: string, id: any): Promise<Record<string, any>> {
        const org = requireOrg(ctx);
        const def = await this.getObjectType(ctx, typeName);

        if (def.backing === "virtual") {
            const adapter = def.sourceAdapter ? getAdapter(def.sourceAdapter) : undefined;
            if (!adapter) throw new BadRequestError(`Object type '${typeName}' has no registered adapter '${def.sourceAdapter}'.`);
            const obj = await adapter.get(ctx, id);
            if (!obj) throw new NotFoundError(`Ontology Object of type '${typeName}' with id '${id}' not found.`);
            return obj;
        }

        const row = await this.materializedRow(org, def.id, id);
        if (!row) throw new NotFoundError(`Ontology Object of type '${typeName}' with id '${id}' not found.`);
        return OntologyService.materializedView(row);
    }

    /**
     * A materialized row by its CALLER-facing id: externalId first, then the numeric
     * primary key. Stored links reference the primary key while callers hand us
     * whichever id they were shown, so link/unlink and traversal have to resolve the
     * two the same way `getObject` does or they disagree about what an id means.
     */
    private async materializedRow(org: number, objectTypeId: number, id: any) {
        const rows = await db
            .select()
            .from(ontologyObjects)
            .where(and(eq(ontologyObjects.organizationId, org), eq(ontologyObjects.objectTypeId, objectTypeId), eq(ontologyObjects.externalId, String(id))))
            .limit(1);
        if (rows[0]) return rows[0];
        if (!/^\d+$/.test(String(id))) return undefined;
        const byPk = await db
            .select()
            .from(ontologyObjects)
            .where(and(eq(ontologyObjects.organizationId, org), eq(ontologyObjects.objectTypeId, objectTypeId), eq(ontologyObjects.id, Number(id))))
            .limit(1);
        return byPk[0];
    }

    /** The caller-facing shape of a materialized object. */
    private static materializedView(row: typeof ontologyObjects.$inferSelect): Record<string, any> {
        return { id: row.externalId ?? row.id, ...(row.properties as Record<string, any>) };
    }

    // ---- Link Types -------------------------------------------------------

    /**
     * The org's declared relationships, optionally narrowed to those leaving (or
     * arriving at) one Object Type. Type ids are resolved back to names because a
     * name is what every caller — agent, pod, route — actually holds.
     */
    async listLinkTypes(ctx: OntologyCtx, typeName?: string): Promise<OntologyLinkTypeView[]> {
        const org = requireOrg(ctx);
        await this.ensureDefaultsSeeded(ctx, org);

        const conds = [eq(ontologyLinkTypes.organizationId, org), eq(ontologyLinkTypes.isActive, true)];
        if (typeName) {
            const def = await this.getObjectType(ctx, typeName);
            // Both directions: a link is as real read from its target as from its source.
            conds.push(
                or(eq(ontologyLinkTypes.sourceTypeId, def.id), eq(ontologyLinkTypes.targetTypeId, def.id))!,
            );
        }

        const rows = await db.select().from(ontologyLinkTypes).where(and(...conds));
        if (rows.length === 0) return [];

        const types = await db
            .select({ id: ontologyObjectTypes.id, name: ontologyObjectTypes.name })
            .from(ontologyObjectTypes)
            .where(eq(ontologyObjectTypes.organizationId, org));
        const nameById = new Map(types.map((t) => [t.id, t.name]));

        return rows.map((r) => ({
            name: r.name,
            inverseName: r.inverseName,
            description: r.description,
            sourceType: nameById.get(r.sourceTypeId) ?? String(r.sourceTypeId),
            targetType: r.targetTypeId == null ? null : (nameById.get(r.targetTypeId) ?? String(r.targetTypeId)),
            cardinality: r.cardinality,
            backing: r.backing,
            sourceProperty: r.sourceProperty,
            targetProperty: r.targetProperty,
            targetTypeProperty: r.targetTypeProperty,
            targetTypeMap: (r.targetTypeMap as Record<string, string>) ?? {},
        }));
    }

    /**
     * Declare a `derived` Link Type — a relationship that already exists as a
     * foreign key on the source's backing table.
     *
     * The important work here is refusing a link that cannot resolve. `sourceProperty`
     * is checked against the source type's ACTUAL property map (the adapter's, for a
     * virtual type), so a link naming a column that does not exist is rejected at
     * declaration rather than returning nothing forever at traversal time. Same for a
     * polymorphic link's `targetTypeMap`: every value must name a real Object Type.
     *
     * Idempotent on (org, sourceType, name) so re-running a seeder or re-confirming a
     * pod updates the declaration instead of erroring.
     */
    async defineLinkType(
        ctx: OntologyCtx,
        input: {
            sourceType: string;
            name: string;
            inverseName: string;
            sourceProperty?: string;
            targetType?: string | null;
            targetProperty?: string;
            cardinality?: string;
            description?: string;
            targetTypeProperty?: string;
            targetTypeMap?: Record<string, string>;
            backing?: string;
            path?: string[];
        },
    ): Promise<OntologyLinkTypeView> {
        const org = requireOrg(ctx);
        const source = await this.getObjectType(ctx, input.sourceType);
        const backing = input.backing ?? "derived";
        if (!ONTOLOGY_LINK_BACKINGS.includes(backing as any)) {
            throw new BadRequestError(`Unknown link backing '${backing}'. Use ${ONTOLOGY_LINK_BACKINGS.join(", ")}.`);
        }
        const path = input.path ?? [];

        const sourceProps = this.toTypeView(source).properties ?? {};
        // A derived link IS its source property; a materialized one has no join key
        // at all, because the edge is the record.
        if (backing === "derived") {
            if (!input.sourceProperty) {
                throw new BadRequestError("A derived link must name the source property carrying its join key.");
            }
            if (!(input.sourceProperty in sourceProps)) {
                throw new BadRequestError(
                    `Object type '${input.sourceType}' has no property '${input.sourceProperty}'. ` +
                        `Available: ${Object.keys(sourceProps).join(", ") || "(none)"}.`,
                );
            }
        }

        let targetTypeId: number | null = null;
        let target: OntologyObjectType | undefined;
        if (input.targetType) {
            target = await this.getObjectType(ctx, input.targetType);
            targetTypeId = target.id;
        }

        if (backing === "path") {
            if (path.length === 0) {
                throw new BadRequestError("A composed link must name the hops to follow, e.g. ['has_resource', 'resource_of'].");
            }
            if (!target) {
                throw new BadRequestError(
                    "A composed link must name the Object Type it lands on: the last hop may be polymorphic, and the declared target is what the caller is promised.",
                );
            }
            // A hop that names nothing is the failure mode worth catching here — it
            // returns an empty walk forever, which reads as "nothing is related".
            const declared = await db
                .select({ name: ontologyLinkTypes.name, inverseName: ontologyLinkTypes.inverseName, sourceTypeId: ontologyLinkTypes.sourceTypeId, targetTypeId: ontologyLinkTypes.targetTypeId })
                .from(ontologyLinkTypes)
                .where(and(eq(ontologyLinkTypes.organizationId, org), eq(ontologyLinkTypes.isActive, true)));
            for (const hop of path) {
                if (!declared.some((d) => d.name === hop || d.inverseName === hop)) {
                    throw new BadRequestError(`Hop '${hop}' is not a relationship declared in this organization.`);
                }
            }
            // The first hop is the one that can be checked exactly: it has to leave
            // from the source type, forward or inverse.
            const first = path[0];
            const leavesSource = declared.some(
                (d) => (d.name === first && d.sourceTypeId === source.id) || (d.inverseName === first && d.targetTypeId === source.id),
            );
            if (!leavesSource) {
                throw new BadRequestError(`Hop '${first}' cannot be followed from '${input.sourceType}'.`);
            }
        }

        if (backing === "materialized") {
            // Stored edges reference ontology_objects rows. A virtual type is a view
            // over a domain table and has no row there, so an edge naming one could
            // never be created — refusing at declaration beats a link that accepts
            // its definition and rejects every write.
            if (!target) {
                throw new BadRequestError("A materialized link must name a target Object Type; stored edges cannot be polymorphic.");
            }
            for (const t of [source, target]) {
                if (t.backing !== "materialized") {
                    throw new BadRequestError(
                        `Object type '${t.name}' is ${t.backing}, so it has no stored row for an edge to reference. ` +
                            `Materialized links can only join materialized types; use a derived link over '${t.name}'s own properties instead.`,
                    );
                }
            }
        }

        const targetTypeMap = input.targetTypeMap ?? {};
        if (targetTypeId == null) {
            if (!input.targetTypeProperty) {
                throw new BadRequestError(
                    "A link with no target Object Type is polymorphic and must name the property identifying the target's type.",
                );
            }
            if (!(input.targetTypeProperty in sourceProps)) {
                throw new BadRequestError(
                    `Object type '${input.sourceType}' has no property '${input.targetTypeProperty}' to read the target type from.`,
                );
            }
            if (Object.keys(targetTypeMap).length === 0) {
                throw new BadRequestError(
                    "A polymorphic link must map its type-property values to Object Type names.",
                );
            }
            // Each mapped name must be a real type, or the traversal dead-ends on
            // whichever discriminator value was mistyped — silently, and only for
            // the rows carrying it.
            for (const [value, typeName] of Object.entries(targetTypeMap)) {
                await this.getObjectType(ctx, typeName).catch(() => {
                    throw new BadRequestError(
                        `targetTypeMap['${value}'] names Object type '${typeName}', which does not exist in this organization.`,
                    );
                });
            }
        }

        const values = {
            organizationId: org,
            name: input.name,
            inverseName: input.inverseName,
            description: input.description ?? null,
            sourceTypeId: source.id,
            targetTypeId,
            cardinality: input.cardinality ?? "one_to_many",
            backing,
            path,
            sourceProperty: backing === "derived" ? input.sourceProperty! : null,
            targetProperty: input.targetProperty ?? "id",
            targetTypeProperty: targetTypeId == null ? input.targetTypeProperty! : null,
            targetTypeMap: targetTypeId == null ? targetTypeMap : {},
            createdBy: ctx.userId,
            updatedAt: new Date(),
        };

        await db
            .insert(ontologyLinkTypes)
            .values(values)
            .onConflictDoUpdate({
                target: [
                    ontologyLinkTypes.organizationId,
                    ontologyLinkTypes.sourceTypeId,
                    ontologyLinkTypes.name,
                ],
                set: {
                    inverseName: values.inverseName,
                    description: values.description,
                    targetTypeId: values.targetTypeId,
                    cardinality: values.cardinality,
                    backing: values.backing,
                    sourceProperty: values.sourceProperty,
                    targetProperty: values.targetProperty,
                    targetTypeProperty: values.targetTypeProperty,
                    targetTypeMap: values.targetTypeMap,
                    path: values.path,
                    isActive: true,
                    updatedAt: values.updatedAt,
                },
            });

        logger.info(`[Ontology] Declared link '${input.sourceType} --${input.name}--> ${input.targetType ?? "*"}' for org ${org}.`);

        return {
            name: values.name,
            inverseName: values.inverseName,
            description: values.description,
            sourceType: input.sourceType,
            targetType: input.targetType ?? null,
            cardinality: values.cardinality,
            backing: values.backing,
            sourceProperty: values.sourceProperty,
            targetProperty: values.targetProperty,
            targetTypeProperty: values.targetTypeProperty,
            targetTypeMap: values.targetTypeMap,
        };
    }

    /** How many rows a fallback scan will look at before admitting it may have missed some. */
    private static readonly SCAN_CAP = 200;

    /**
     * Objects of `typeName` whose `property` equals `value`.
     *
     * Three paths, in descending order of exactness:
     *  - virtual type whose adapter implements listBy: an indexed WHERE, always complete;
     *  - materialized type: a WHERE on the JSONB property, likewise exact;
     *  - virtual type without listBy: a bounded scan matched in memory, reported as
     *    incomplete when the scan filled its page, because beyond that point the
     *    service genuinely does not know whether more rows match.
     *
     * `extraMatch` narrows a polymorphic link to the rows actually pointing at the
     * type being traversed from — see the caller.
     */
    private async findObjectsByProperty(
        ctx: OntologyCtx,
        typeName: string,
        property: string,
        value: any,
        opts: { limit: number; extraMatch?: { property: string; values: Set<string> } },
    ): Promise<{ objects: Array<Record<string, any>>; complete: boolean }> {
        const org = requireOrg(ctx);
        const def = await this.getObjectType(ctx, typeName);
        const view = this.toTypeView(def);

        const coerced = coercePropertyValue(view.properties[property], value);
        // Not merely "no rows": the value cannot inhabit this column's type, so no row
        // could ever match. Complete, and empty.
        if (coerced === undefined) return { objects: [], complete: true };

        const narrow = (rows: Array<Record<string, any>>) =>
            opts.extraMatch
                ? rows.filter((r) => opts.extraMatch!.values.has(String(r[opts.extraMatch!.property])))
                : rows;

        if (def.backing === "virtual") {
            const adapter = def.sourceAdapter ? getAdapter(def.sourceAdapter) : undefined;
            if (!adapter) {
                throw new BadRequestError(`Object type '${typeName}' has no registered adapter '${def.sourceAdapter}'.`);
            }

            if (adapter.listBy) {
                // Over-fetch when a post-filter will drop rows, so narrowing does not
                // quietly turn a full page into a short one.
                const fetchLimit = opts.extraMatch ? Math.min(opts.limit * 4, 200) : opts.limit;
                try {
                    const rows = await adapter.listBy(ctx, property, coerced, { limit: fetchLimit });
                    return this.page(narrow(rows), rows.length, fetchLimit, opts.limit);
                } catch (e: any) {
                    // The value cannot inhabit the column's type — a "42" against a
                    // uuid key, say. That is the same conclusion coercePropertyValue
                    // reaches for a non-numeric integer, arrived at by the database
                    // instead because only it knows the column is a uuid. No row can
                    // match, so this is an empty answer and a complete one, not an
                    // error to surface.
                    if (isUnrepresentableValue(e)) return { objects: [], complete: true };
                    // A link may legitimately name a property the adapter surfaces but
                    // cannot filter on — a joined or computed value like appName.
                    // defineLinkType accepts those because reading one FORWARD works
                    // fine; only the inbound direction needs a WHERE. Falling through
                    // to the scan answers it correctly and flags it as bounded, which
                    // beats failing the traversal outright.
                    if (e?.name !== "UnfilterablePropertyError") throw e;
                }
            }

            const scanned = await adapter.list(ctx, { limit: OntologyService.SCAN_CAP });
            const matched = narrow(scanned.filter((r) => sameValue(r[property], coerced)));
            return this.page(matched, scanned.length, OntologyService.SCAN_CAP, opts.limit);
        }

        // Materialized. `id` is the row's identity rather than a stored property, so
        // it is matched against externalId (and the numeric key) instead of the JSONB.
        const identity =
            property === "id"
                ? /^\d+$/.test(String(coerced))
                    ? or(eq(ontologyObjects.externalId, String(coerced)), eq(ontologyObjects.id, Number(coerced)))!
                    : eq(ontologyObjects.externalId, String(coerced))
                : sql`${ontologyObjects.properties}->>${property} = ${String(coerced)}`;

        const fetchLimit = opts.extraMatch ? Math.min(opts.limit * 4, 200) : opts.limit;
        const rows = await db
            .select()
            .from(ontologyObjects)
            .where(and(eq(ontologyObjects.organizationId, org), eq(ontologyObjects.objectTypeId, def.id), identity))
            .orderBy(desc(ontologyObjects.createdAt))
            .limit(fetchLimit);

        const mapped = rows.map((r) => ({ id: r.externalId ?? r.id, ...(r.properties as Record<string, any>) }));
        return this.page(narrow(mapped), rows.length, fetchLimit, opts.limit);
    }

    /**
     * Cut a matched set down to the caller's limit and say whether anything was left
     * behind.
     *
     * Two distinct ways to be incomplete, and both have to be caught: the underlying
     * read filled its page (so more rows may exist unread), or narrowing left more
     * matches than the caller asked for (so more rows exist, already read). Reporting
     * only the first would call a truncated answer complete.
     */
    private page(
        matched: Array<Record<string, any>>,
        fetched: number,
        fetchLimit: number,
        limit: number,
    ): { objects: Array<Record<string, any>>; complete: boolean } {
        return {
            objects: matched.slice(0, limit),
            complete: fetched < fetchLimit && matched.length <= limit,
        };
    }

    /**
     * Follow a declared relationship from one object to the objects on its other end.
     *
     * A derived link is not a stored edge — it is a claim that a property on the
     * source holds the target's key — so traversal is resolved at read time in the
     * direction asked for:
     *  - forward, from the source: read the join key off the object and fetch the
     *    target by it. One indexed lookup, no scan;
     *  - inverse, from the target: find the sources whose join property points back
     *    at this object. That is a filter, which is why adapters grew listBy.
     *
     * The link is matched by NAME in either direction, because `inverseName` exists
     * precisely so the relationship can be read from the far end — an agent holding
     * an App should be able to ask for `deployed_by` without knowing which end
     * declared it.
     */
    async traverse(
        ctx: OntologyCtx,
        opts: { objectType: string; id: any; link: string; limit?: number },
    ): Promise<OntologyTraversalResult> {
        const org = requireOrg(ctx);
        const def = await this.getObjectType(ctx, opts.objectType);
        const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);

        const types = await db
            .select({ id: ontologyObjectTypes.id, name: ontologyObjectTypes.name })
            .from(ontologyObjectTypes)
            .where(eq(ontologyObjectTypes.organizationId, org));
        const nameById = new Map(types.map((t) => [t.id, t.name]));

        const links = await db
            .select()
            .from(ontologyLinkTypes)
            .where(and(eq(ontologyLinkTypes.organizationId, org), eq(ontologyLinkTypes.isActive, true)));

        // Forward first: a name declared ON this type is the one its owner meant.
        let row = links.find((l) => l.sourceTypeId === def.id && l.name === opts.link);
        let direction: "forward" | "inverse" = "forward";
        if (!row) {
            row = links.find(
                (l) =>
                    l.inverseName === opts.link &&
                    (l.targetTypeId === def.id ||
                        // A polymorphic link has no target type id; this type is a valid
                        // far end if the discriminator map names it.
                        (l.targetTypeId == null &&
                            Object.values((l.targetTypeMap as Record<string, string>) ?? {}).includes(def.name))),
            );
            direction = "inverse";
        }

        if (!row) {
            const available = [
                ...links.filter((l) => l.sourceTypeId === def.id).map((l) => l.name),
                ...links
                    .filter(
                        (l) =>
                            l.targetTypeId === def.id ||
                            (l.targetTypeId == null &&
                                Object.values((l.targetTypeMap as Record<string, string>) ?? {}).includes(def.name)),
                    )
                    .map((l) => l.inverseName),
            ];
            throw new NotFoundError(
                `No relationship '${opts.link}' is declared on Object type '${opts.objectType}'. ` +
                    `Traversable from here: ${available.join(", ") || "(none)"}.`,
            );
        }

        if (row.backing === "path") {
            return this.traversePath(ctx, row, direction, opts, nameById);
        }
        if (row.backing === "materialized") {
            return this.traverseStored(ctx, org, row, direction, opts, nameById);
        }
        if (row.backing !== "derived") {
            throw new BadRequestError(
                `Link '${opts.link}' has an unknown backing ('${row.backing}').`,
            );
        }
        if (!row.sourceProperty) {
            throw new BadRequestError(`Link '${opts.link}' declares no source property and cannot be resolved.`);
        }

        const obj = await this.getObject(ctx, opts.objectType, opts.id);
        const targetProperty = row.targetProperty ?? "id";
        // Deliberately no `cardinality` here. It is declared source -> target, and half
        // of these traversals run target -> source, where that statement does not
        // describe what the caller just received: `step_of` is one_to_one ("one step
        // has one pipeline"), so reporting it verbatim on an inverse `has_step` would
        // sit next to a list of several steps and flatly contradict it. It cannot be
        // mechanically inverted either — the enum has no many_to_one, so one_to_one is
        // doing double duty for genuine 1:1 and for many:1, and the inverse of the
        // second is one-to-many while the inverse of the first is one. The declaration
        // is available unambiguously from listLinkTypes, which states its own source
        // and target; what a traversal caller actually needs to know — "might there be
        // more?" — is `complete`.
        const linkView = {
            name: opts.link,
            direction,
            fromType: opts.objectType,
        };

        if (direction === "forward") {
            let toType: string | null;
            if (row.targetTypeId != null) {
                toType = nameById.get(row.targetTypeId) ?? null;
            } else {
                // Polymorphic: this row's own discriminator says what it points at.
                const discriminator = row.targetTypeProperty ? obj[row.targetTypeProperty] : undefined;
                const map = (row.targetTypeMap as Record<string, string>) ?? {};
                toType = discriminator == null ? null : (map[String(discriminator)] ?? null);
                if (!toType) {
                    return {
                        link: { ...linkView, toType: null },
                        objects: [],
                        complete: true,
                        note:
                            discriminator == null
                                ? `This ${opts.objectType} has no value for '${row.targetTypeProperty}', so its target type is unknown.`
                                : `'${discriminator}' is not mapped to an Object Type by this link.`,
                    };
                }
            }
            if (!toType) throw new BadRequestError(`Link '${opts.link}' points at an Object Type that no longer exists.`);

            const joinValue = obj[row.sourceProperty];
            if (joinValue === null || joinValue === undefined) {
                return {
                    link: { ...linkView, toType },
                    objects: [],
                    complete: true,
                    note: `This ${opts.objectType} has no value for '${row.sourceProperty}', so the link resolves to nothing.`,
                };
            }

            // The overwhelmingly common shape: the join lands on the target's identity,
            // which is a keyed fetch rather than a filter.
            if (targetProperty === "id") {
                const found = await this.getObject(ctx, toType, joinValue).catch((e: any) => {
                    if (e instanceof NotFoundError) return null;
                    throw e;
                });
                return { link: { ...linkView, toType }, objects: found ? [found] : [], complete: true };
            }

            const res = await this.findObjectsByProperty(ctx, toType, targetProperty, joinValue, { limit });
            return { link: { ...linkView, toType }, objects: res.objects, complete: res.complete, ...this.partialNote(res.complete) };
        }

        // Inverse: who points AT this object.
        const toType = nameById.get(row.sourceTypeId) ?? null;
        if (!toType) throw new BadRequestError(`Link '${opts.link}' starts from an Object Type that no longer exists.`);

        const ourValue = obj[targetProperty];
        if (ourValue === null || ourValue === undefined) {
            return {
                link: { ...linkView, toType },
                objects: [],
                complete: true,
                note: `This ${opts.objectType} has no value for '${targetProperty}', so nothing can point at it through this link.`,
            };
        }

        // For a polymorphic link the join key alone is not enough: Project Resource
        // rows pointing at Mission 5 and at App 5 carry the SAME resourceId, and
        // matching on it alone would report an unrelated App's containers as this
        // Mission's. The discriminator has to match too.
        let extraMatch: { property: string; values: Set<string> } | undefined;
        if (row.targetTypeId == null && row.targetTypeProperty) {
            const map = (row.targetTypeMap as Record<string, string>) ?? {};
            extraMatch = {
                property: row.targetTypeProperty,
                values: new Set(
                    Object.entries(map)
                        .filter(([, typeName]) => typeName === def.name)
                        .map(([value]) => value),
                ),
            };
        }

        const res = await this.findObjectsByProperty(ctx, toType, row.sourceProperty, ourValue, { limit, extraMatch });
        return { link: { ...linkView, toType }, objects: res.objects, complete: res.complete, ...this.partialNote(res.complete) };
    }

    /**
     * Traversal for `backing = "path"`: follow the declared hops in order.
     *
     * Each hop is an ordinary traversal, so a path inherits everything the engine
     * already does — polymorphic discriminators, org scoping, per-hop partialness —
     * rather than reimplementing a join. That is the whole reason paths are stored as
     * link names instead of as a SQL route through a junction table.
     *
     * Two honesty rules, both about not overstating the answer:
     *   - `complete` is the AND over every hop. One partial hop makes the whole
     *     answer partial, because the objects it did not return would have led
     *     somewhere.
     *   - a polymorphic hop mid-path yields objects of several types; only those
     *     matching the NEXT hop's source type can continue, and the rest are dropped
     *     silently by design — they are not "missing", they simply have no such
     *     relationship.
     */
    private async traversePath(
        ctx: OntologyCtx,
        row: typeof ontologyLinkTypes.$inferSelect,
        direction: "forward" | "inverse",
        opts: { objectType: string; id: any; link: string; limit?: number },
        nameById: Map<number, string>,
    ): Promise<OntologyTraversalResult> {
        const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
        const hops = (row.path as string[]) ?? [];
        const toTypeId = direction === "forward" ? row.targetTypeId : row.sourceTypeId;
        const toType = toTypeId == null ? null : (nameById.get(toTypeId) ?? null);
        const linkView = { name: opts.link, direction, fromType: opts.objectType, toType };

        if (hops.length === 0) {
            throw new BadRequestError(`Composed link '${opts.link}' declares no hops to follow.`);
        }

        // Walking a path backwards is not the same hops in reverse order — it is each
        // hop's OPPOSITE name, in reverse order. Reversing ["has_resource",
        // "resource_of"] literally asks a Mission to follow `resource_of`, which is
        // declared on Project Resource and means the wrong thing here; what a Mission
        // can follow is that link's inverse, `project_links`.
        let route = hops;
        if (direction === "inverse") {
            const declared = await db
                .select({ name: ontologyLinkTypes.name, inverseName: ontologyLinkTypes.inverseName })
                .from(ontologyLinkTypes)
                .where(and(eq(ontologyLinkTypes.organizationId, requireOrg(ctx)), eq(ontologyLinkTypes.isActive, true)));
            route = [...hops].reverse().map((hop) => {
                const match = declared.find((d) => d.name === hop || d.inverseName === hop);
                if (!match) throw new BadRequestError(`Composed link '${opts.link}' names a hop '${hop}' that no longer exists.`);
                return match.name === hop ? match.inverseName : match.name;
            });
        }

        let frontier: Array<{ type: string; id: any }> = [{ type: opts.objectType, id: opts.id }];
        let complete = true;

        for (const [index, hopName] of route.entries()) {
            const next = new Map<string, { type: string; id: any }>();
            for (const node of frontier) {
                const hop = await this.traverse(ctx, {
                    objectType: node.type,
                    id: node.id,
                    link: hopName,
                    limit,
                }).catch((e: any) => {
                    // A hop this object's type does not declare is not an error for
                    // the walk: a polymorphic previous hop legitimately produces types
                    // that go no further.
                    if (e instanceof NotFoundError && index > 0) return null;
                    throw e;
                });
                if (!hop) continue;
                complete &&= hop.complete;
                for (const obj of hop.objects) {
                    if (!hop.link.toType) continue;
                    next.set(`${hop.link.toType}:${obj.id}`, { type: hop.link.toType, id: obj.id });
                }
            }
            // Fan-out is bounded at every hop, not just at the end: without this a
            // two-hop walk from a busy node multiplies into thousands of queries.
            frontier = [...next.values()].slice(0, limit);
            if (next.size > limit) complete = false;
            if (frontier.length === 0) break;
        }

        // The declared target is the contract. A path whose last hop is polymorphic
        // returns several types, and handing back the ones the caller was not
        // promised would make `toType` a lie.
        const wanted = toType ? frontier.filter((n) => n.type === toType) : frontier;
        const objects: Array<Record<string, any>> = [];
        for (const node of wanted) {
            const obj = await this.getObject(ctx, node.type, node.id).catch((e: any) => {
                if (e instanceof NotFoundError) return null;
                throw e;
            });
            if (obj) objects.push(obj);
        }

        return { link: linkView, objects, complete, ...this.partialNote(complete) };
    }

    /**
     * Traversal for `backing = "materialized"`: read the stored edges rather than
     * resolving a foreign key.
     *
     * Both endpoints are rows in `ontology_objects`, because that is what
     * `ontology_links` references. A virtual object — a mission, a pipeline — has no
     * row there and so can never be an endpoint; `link()` refuses to create such an
     * edge, and this is the read side of the same rule.
     */
    private async traverseStored(
        ctx: OntologyCtx,
        org: number,
        row: typeof ontologyLinkTypes.$inferSelect,
        direction: "forward" | "inverse",
        opts: { objectType: string; id: any; link: string; limit?: number },
        nameById: Map<number, string>,
    ): Promise<OntologyTraversalResult> {
        const limit = Math.min(Math.max(1, opts.limit ?? 50), 200);
        const here = await this.getObjectType(ctx, opts.objectType);
        const self = await this.materializedRow(org, here.id, opts.id);
        if (!self) throw new NotFoundError(`Ontology Object of type '${opts.objectType}' with id '${opts.id}' not found.`);

        const toTypeId = direction === "forward" ? row.targetTypeId : row.sourceTypeId;
        const toType = toTypeId == null ? null : (nameById.get(toTypeId) ?? null);
        const linkView = { name: opts.link, direction, fromType: opts.objectType, toType };

        // Forward reads target ids off edges we are the source of; inverse the mirror.
        const near = direction === "forward" ? ontologyLinks.sourceObjectId : ontologyLinks.targetObjectId;
        const far = direction === "forward" ? ontologyLinks.targetObjectId : ontologyLinks.sourceObjectId;

        const rows = await db
            .select({ row: ontologyObjects })
            .from(ontologyLinks)
            .innerJoin(ontologyObjects, eq(ontologyObjects.id, far))
            .where(and(
                eq(ontologyLinks.organizationId, org),
                eq(ontologyLinks.linkTypeId, row.id),
                eq(near, self.id),
                // Belt and braces: the edge is already org-scoped, but an object row
                // that somehow belongs elsewhere must not come back through it.
                eq(ontologyObjects.organizationId, org),
            ))
            .orderBy(desc(ontologyLinks.createdAt))
            .limit(limit + 1);

        const complete = rows.length <= limit;
        return {
            link: linkView,
            objects: rows.slice(0, limit).map((r) => OntologyService.materializedView(r.row)),
            complete,
            ...this.partialNote(complete),
        };
    }

    /**
     * Create a stored edge between two materialized objects.
     *
     * Idempotent: the table's unique index is (org, linkType, source, target), and
     * re-linking two objects is a statement of the same fact, not a second edge.
     */
    async link(
        ctx: OntologyCtx,
        input: { sourceType: string; linkName: string; sourceId: any; targetId: any },
    ): Promise<{ created: boolean; sourceObjectId: number; targetObjectId: number }> {
        const org = requireOrg(ctx);
        const { linkType, source, target } = await this.resolveStoredEnds(ctx, org, input);

        const res = await db
            .insert(ontologyLinks)
            .values({
                organizationId: org,
                linkTypeId: linkType.id,
                sourceObjectId: source.id,
                targetObjectId: target.id,
                createdBy: ctx.userId,
            })
            .onConflictDoNothing({
                target: [
                    ontologyLinks.organizationId,
                    ontologyLinks.linkTypeId,
                    ontologyLinks.sourceObjectId,
                    ontologyLinks.targetObjectId,
                ],
            })
            .returning({ id: ontologyLinks.id });

        return { created: res.length > 0, sourceObjectId: source.id, targetObjectId: target.id };
    }

    /** Remove a stored edge. Removing one that is not there is not an error. */
    async unlink(
        ctx: OntologyCtx,
        input: { sourceType: string; linkName: string; sourceId: any; targetId: any },
    ): Promise<{ removed: number }> {
        const org = requireOrg(ctx);
        const { linkType, source, target } = await this.resolveStoredEnds(ctx, org, input);

        const res = await db
            .delete(ontologyLinks)
            .where(and(
                eq(ontologyLinks.organizationId, org),
                eq(ontologyLinks.linkTypeId, linkType.id),
                eq(ontologyLinks.sourceObjectId, source.id),
                eq(ontologyLinks.targetObjectId, target.id),
            ))
            .returning({ id: ontologyLinks.id });

        return { removed: res.length };
    }

    /**
     * The shared checks behind link/unlink: the link is real, it is materialized, and
     * both objects exist as rows this org owns. Resolving both ends before touching
     * anything keeps a half-valid call from mutating.
     */
    private async resolveStoredEnds(
        ctx: OntologyCtx,
        org: number,
        input: { sourceType: string; linkName: string; sourceId: any; targetId: any },
    ) {
        const sourceType = await this.getObjectType(ctx, input.sourceType);
        const rows = await db
            .select()
            .from(ontologyLinkTypes)
            .where(and(
                eq(ontologyLinkTypes.organizationId, org),
                eq(ontologyLinkTypes.sourceTypeId, sourceType.id),
                eq(ontologyLinkTypes.name, input.linkName),
            ))
            .limit(1);
        const linkType = rows[0];
        if (!linkType) throw new NotFoundError(`No relationship '${input.linkName}' is declared on Object type '${input.sourceType}'.`);
        if (!linkType.isActive) throw new BadRequestError(`Relationship '${input.linkName}' is switched off.`);
        if (linkType.backing !== "materialized") {
            // A derived link's edges live in the source table's foreign key. Writing
            // one here would create a second, divergent answer to the same question.
            throw new BadRequestError(
                `Relationship '${input.linkName}' is derived from '${linkType.sourceProperty}', so its edges cannot be written directly — change that property instead.`,
            );
        }
        if (linkType.targetTypeId == null) {
            throw new BadRequestError(`Relationship '${input.linkName}' is polymorphic and cannot store edges.`);
        }

        const source = await this.materializedRow(org, sourceType.id, input.sourceId);
        if (!source) throw new NotFoundError(`Ontology Object of type '${input.sourceType}' with id '${input.sourceId}' not found.`);
        const target = await this.materializedRow(org, linkType.targetTypeId, input.targetId);
        if (!target) {
            const targetName = (await db
                .select({ name: ontologyObjectTypes.name })
                .from(ontologyObjectTypes)
                .where(eq(ontologyObjectTypes.id, linkType.targetTypeId))
                .limit(1))[0]?.name ?? String(linkType.targetTypeId);
            throw new NotFoundError(`Ontology Object of type '${targetName}' with id '${input.targetId}' not found.`);
        }

        return { linkType, source, target };
    }

    private partialNote(complete: boolean): { note?: string } {
        // Deliberately covers both ways of being partial — the page limit was reached,
        // or the Object Type's adapter cannot filter on the join property so only a
        // bounded scan was possible. Naming only one of them would be wrong half the
        // time, and this note is the thing a caller acts on.
        return complete
            ? {}
            : {
                  note:
                      "More objects may be related than are listed here: either the requested limit was reached, " +
                      "or this Object Type cannot be filtered on the join property and only the first " +
                      `${OntologyService.SCAN_CAP} rows were examined. Do not read this as the complete set.`,
              };
    }

    // ---- Actions ----------------------------------------------------------

    async listActions(ctx: OntologyCtx, typeName?: string): Promise<OntologyAction[]> {
        const org = requireOrg(ctx);
        // Back-fill first, as every other read does. Without this the unfiltered
        // call — the one the Explorer makes — never seeds, so a newly added default
        // Action appears only once some OTHER call happens to trigger seeding, and
        // the two run concurrently on page load, which makes it appear at random.
        await this.ensureDefaultsSeeded(ctx, org);
        const conds = [eq(ontologyActions.organizationId, org), eq(ontologyActions.isActive, true)];
        if (typeName) {
            const def = await this.getObjectType(ctx, typeName);
            conds.push(eq(ontologyActions.objectTypeId, def.id));
        }
        return db.select().from(ontologyActions).where(and(...conds));
    }

    async getToolActionAnalytics(ctx: OntologyCtx) {
        const org = requireOrg(ctx);
        const { agentToolUsage } = await import("@shared/schema/agent/tool-analytics.js");
        return db.select({
            actionId: ontologyActions.id,
            actionName: ontologyActions.name,
            toolName: ontologyActions.handlerRef,
            riskLevel: ontologyActions.riskLevel,
            requiresApproval: ontologyActions.requiresApproval,
            totalInvocations: sql<number>`count(${agentToolUsage.id})::int`,
            successRate: sql<number>`coalesce(avg(case when ${agentToolUsage.status} = 'success' then 1.0 else 0.0 end), 0)::float`,
            averageExecutionTimeMs: sql<number>`coalesce(avg(${agentToolUsage.executionTimeMs}), 0)::float`,
            lastUsedAt: sql<string | null>`max(${agentToolUsage.createdAt})`,
        }).from(ontologyActions)
          .leftJoin(agentToolUsage, and(
              eq(agentToolUsage.organizationId, org),
              eq(agentToolUsage.toolName, ontologyActions.handlerRef),
          ))
          .where(and(eq(ontologyActions.organizationId, org), eq(ontologyActions.handlerKind, "tool")))
          .groupBy(
              ontologyActions.id,
              ontologyActions.name,
              ontologyActions.handlerRef,
              ontologyActions.riskLevel,
              ontologyActions.requiresApproval,
          );
    }

    /**
     * Validate → govern (writes) → dispatch → audit.
     *
     * Reads run immediately. A write with `requiresApproval` is routed through the
     * governor's decision-router (the same HIL gate the rest of the platform uses):
     * if approved it dispatches and records the approval id; if denied/timed-out it
     * does NOT mutate and is logged with the approval id. Fails safe on any gate error.
     */
    async executeAction(
        ctx: OntologyCtx,
        actionName: string,
        params: Record<string, any>,
    ): Promise<OntologyActionResult> {
        const org = requireOrg(ctx);

        const rows = await db
            .select()
            .from(ontologyActions)
            .where(and(eq(ontologyActions.organizationId, org), eq(ontologyActions.name, actionName)))
            .limit(1);
        const action = rows[0];
        if (!action) throw new NotFoundError(`Ontology Action '${actionName}' not found.`);
        if (!action.isActive) throw new BadRequestError(`Ontology Action '${actionName}' is inactive.`);

        this.validateParams(action, params ?? {});

        // Write gate — route through the governor for human approval.
        let approvalId: number | undefined;
        if (action.effect === "write" && action.requiresApproval) {
            const decision = await this.requestWriteApproval(ctx, action, params ?? {});
            approvalId = decision.requestId;
            if (!decision.approved) {
                await this.audit(org, action.id, ctx.userId, params, "denied", { reason: decision.reason, source: decision.source }, approvalId, ctx.missionRunId);
                // A timeout means "not yet decided", which we surface as approval_required
                // so the caller can poll/await; an explicit rejection is a denial.
                const pending = decision.source === "timeout" || decision.snoozed === true;
                return {
                    status: pending ? "approval_required" : "denied",
                    message: decision.reason ?? `Action '${actionName}' was not approved.`,
                    approvalId,
                };
            }
        }

        try {
            const result = await this.dispatch(ctx, action, params ?? {});
            await this.audit(org, action.id, ctx.userId, params, "executed", result, approvalId, ctx.missionRunId);
            logger.info(`[Ontology] Executed action '${actionName}' for org ${org}${approvalId ? ` (approval ${approvalId})` : ""}.`);
            return { status: "executed", message: `Action '${actionName}' executed.`, result, approvalId };
        } catch (e: any) {
            await this.audit(org, action.id, ctx.userId, params, "failed", { error: e?.message }, approvalId, ctx.missionRunId);
            throw e;
        }
    }

    /**
     * Request human approval for a write action via the governor's decision-router.
     * Lazy-imported so the governor/redis stack isn't pulled into read-only paths or
     * unit tests. Fails safe: if the gate itself errors, the write is treated as denied.
     */
    private async requestWriteApproval(
        ctx: OntologyCtx,
        action: OntologyAction,
        params: Record<string, any>,
    ): Promise<{ approved: boolean; requestId?: number; reason?: string; source?: string; snoozed?: boolean }> {
        try {
            const { decisionRouter } = await import("../../governor/core/decision-router.js");
            const result = await decisionRouter.requestDecision({
                sessionId: ctx.sessionId ?? `ontology-${ctx.organizationId}-${action.name}-${Date.now()}`,
                tool: `ontology_action:${action.name}`,
                params,
                goal: action.description ?? `Execute ontology action '${action.name}'`,
                riskLevel: (action.riskLevel as "low" | "medium" | "high") ?? "medium",
                description: action.description ?? undefined,
                approverType: "internal",
                approverId: ctx.userId,
                channels: ["copilot", "inbox"],
                organizationId: ctx.organizationId,
                missionId: ctx.missionId,
                metadata: { source: "ontology", actionId: action.id, actionName: action.name },
            });
            return {
                approved: result.approved,
                requestId: result.requestId,
                reason: result.reason,
                source: result.source,
                snoozed: result.snoozed,
            };
        } catch (e: any) {
            logger.error(`[Ontology] Approval gate failed for action '${action.name}': ${e?.message}`);
            return { approved: false, reason: `Approval gate error: ${e?.message}`, source: "error" };
        }
    }

    private validateParams(action: OntologyAction, params: Record<string, any>): void {
        validateActionParams((action.parametersSchema as Record<string, string>) ?? {}, params, action.name);
    }

    private async dispatch(ctx: OntologyCtx, action: OntologyAction, params: Record<string, any>): Promise<any> {
        switch (action.handlerKind) {
            case "builtin": {
                const handler = OntologyService.builtins.get(action.handlerRef);
                if (!handler) throw new BadRequestError(`No builtin handler registered for '${action.handlerRef}'.`);
                return handler(ctx, params);
            }
            case "sql": {
                const handler = OntologyService.sqlHandlers.get(action.handlerRef);
                if (!handler) throw new BadRequestError(`No named SQL handler registered for '${action.handlerRef}'.`);
                return handler(ctx, params);
            }
            case "tool":
                return this.dispatchTool(ctx, action.handlerRef, params);
            case "pipeline":
                return this.dispatchPipeline(ctx, action.handlerRef, params);
            default:
                throw new BadRequestError(`Handler kind '${action.handlerKind}' is not supported.`);
        }
    }

    /** Invoke a registered agent tool by name, org-scoped via a minimal ToolContext. */
    private async dispatchTool(ctx: OntologyCtx, toolName: string, params: Record<string, any>): Promise<any> {
        const { getAgentTools } = await import("../../tools/v1/tool-registry.service.js");
        const tools = getAgentTools();
        const toolDef = (tools as Record<string, any>)[toolName];
        if (!toolDef || typeof toolDef.execute !== "function") {
            throw new BadRequestError(`Tool handler '${toolName}' is not a registered tool.`);
        }
        const toolContext = {
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            isSuperAdmin: ctx.isSuperAdmin,
            missionId: ctx.missionId ?? null,
            named: {},
            positional: {},
        };
        return toolDef.execute(params, toolContext);
    }

    /**
     * Trigger a pipeline by id. The pipeline MUST belong to ctx.organizationId — this
     * ownership check is the isolation boundary that stops an action from launching
     * another org's pipeline. `params` are passed as the pipeline's initial variables.
     */
    private async dispatchPipeline(ctx: OntologyCtx, handlerRef: string, params: Record<string, any>): Promise<any> {
        const pipelineId = Number(handlerRef);
        if (!Number.isInteger(pipelineId)) {
            throw new BadRequestError(`Pipeline handler ref '${handlerRef}' is not a valid pipeline id.`);
        }
        const { pipelines } = await import("@shared/schema/pipelines/pipeline-core.js");
        const owned = await db
            .select({ id: pipelines.id })
            .from(pipelines)
            .where(and(eq(pipelines.id, pipelineId), eq(pipelines.organizationId, ctx.organizationId)))
            .limit(1);
        if (owned.length === 0) {
            throw new NotFoundError(`Pipeline ${pipelineId} not found in this organization.`);
        }
        const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");
        const result = await pipelineExecutor.executePipeline(
            pipelineId,
            ctx.userId ?? "ontology",
            null,
            null,
            params,
            undefined,
            undefined,
            ctx.missionId,
        );
        return { executionId: result.executionId, success: result.success, error: result.error };
    }

    private async audit(
        organizationId: number,
        actionId: number,
        actorUserId: string | undefined,
        params: any,
        status: string,
        result: any,
        approvalId?: number,
        missionRunId?: number,
    ): Promise<void> {
        try {
            await db.insert(ontologyActionLog).values({ organizationId, actionId, actorUserId, params, status, result, approvalId, missionRunId });
        } catch (e: any) {
            logger.warn(`[Ontology] Failed to write action-log entry: ${e?.message}`);
        }
    }

    /** Adapter keys available for `virtual` Object Types (for admin/UI use). */
    static availableAdapters(): string[] {
        return Object.keys(ONTOLOGY_ADAPTERS);
    }

    /**
     * The default `virtual` Object Types every org gets: a business-facing name mapped
     * to an org-scoped read adapter over existing platform data.
     */
    static readonly DEFAULT_VIRTUAL_TYPES: ReadonlyArray<{ name: string; adapter: string; description: string }> = [
        ...FINANCIAL_TYPES,
        { name: "Project", adapter: "projects", description: "A Project Space — the durable body of work that owns cycles, missions, apps and knowledge." },
        { name: "Project Resource", adapter: "project_resources", description: "The containment relation: which Project Space a cycle, mission, app, dataset or document belongs to." },
        { name: "Mission", adapter: "missions", description: "An autonomous mission run in this organization." },
        { name: "Job", adapter: "jobs", description: "A configured job/agent definition in this organization." },
        { name: "Pipeline", adapter: "pipelines", description: "A data/automation pipeline in this organization." },
        { name: "Mission Run", adapter: "mission_runs", description: "One execution of a mission: whether it succeeded, where it stopped, what it cost, and the pipeline runs it drove." },
        { name: "Pipeline Step", adapter: "pipeline_steps", description: "One step in a pipeline's definition: the job or tool it runs, its position, and how it behaves on failure." },
        { name: "Pipeline Run", adapter: "pipeline_runs", description: "One execution of a pipeline, with its status, error and the mission it ran for." },
        { name: "Pipeline Step Run", adapter: "pipeline_step_runs", description: "One execution of one pipeline step — where a run actually succeeded, failed or was retried." },
        { name: "Schedule", adapter: "schedules", description: "A reusable recurrence — pattern, timezone and holiday policy — that any number of Scheduled Jobs can run on." },
        { name: "Scheduled Job", adapter: "scheduled_jobs", description: "Something set to run automatically: the job, pipeline or mission it starts, on which Schedule, with its retry and alerting policy." },
        { name: "Dataset", adapter: "datasets", description: "A dataset owned by this organization." },
        { name: "Knowledge Entity", adapter: "knowledge_graph", description: "A verified knowledge-graph entity exposed through the governed Ontology." },
        { name: "Transference Rule", adapter: "transference_rules", description: "A transference rule for LLM call replacement via local handlers." },
        { name: "Swarm Task", adapter: "swarm_tasks", description: "A multi-agent coordination task in the swarm system." },
        { name: "Prompt Version", adapter: "prompt_versions", description: "A versioned system prompt tracked by the Evolution Engine." },
        { name: "Query", adapter: "saved_queries", description: "A saved knowledge-graph query, runnable by agents and usable as the data behind a document." },
        { name: "Alert", adapter: "alerts", description: "An operational alert raised by this organization's jobs, pipelines and app instances." },
        { name: "App", adapter: "apps", description: "An application in this organization's catalogue: one it authored, or a standard built-in." },
        { name: "App Deployment", adapter: "app_deployments", description: "An app this organization has installed, with its runtime state, publication and spend." },
        { name: "Approval", adapter: "approvals", description: "A human decision the platform is waiting on, or has already recorded — the gate every governed write routes through." },
        // These five adapters were registered but named by no default type, so they
        // were unreachable through the ontology API despite being fully written.
        { name: "Signal", adapter: "signals", description: "An observed external event extracted into this organization's signal intelligence." },
        { name: "Prediction", adapter: "predictions", description: "A predicted state transition derived from a signal, with its affected entities and impact horizons." },
        { name: "Surprise", adapter: "surprises", description: "Where a prediction and the observed outcome diverged — the error the learning loop feeds on." },
        { name: "Project Event", adapter: "project_events", description: "An authored entry on a project's timeline: a deadline, a launch, a commitment." },
        { name: "Calculation", adapter: "calculations", description: "A calculation node in this organization's calculation graph, with its formula and cached result." },
        { name: "Cycle", adapter: "operational_cycles", description: "An operational cycle: the recurring window of work that owns missions, carries the budget they spend against, and belongs to a Project Space." },
        { name: "Spatial Region", adapter: "spatial_regions", description: "A named geographic area — region, zone or corridor — stored as a mixed-resolution H3 cell set. Membership is answered by spatial containment, which reports 'indeterminate' when a fix is too coarse to place, never 'outside'." },
        { name: "User", adapter: "users", description: "A registered human member or operator in this organization, projected with strict zero-trust sanitization (credentials and tokens omitted)." },
        { name: "Team", adapter: "teams", description: "A hybrid operational team or squad composed of human operators and autonomous agent pods with home H3 spatial bases and supervisory leads." },
        { name: "Skill", adapter: "skills", description: "An imported or provisioned AI skill capability bundle that can augment agent cards or provision new jobs." },
        { name: "AgentCard", adapter: "agent_cards", description: "A persona-based agent card with model bindings, tools, and capability declarations used by the intent router and CREW system." },
    ];

    /**
     * Idempotently register the default virtual Object Types for an org. Safe to call
     * repeatedly (relies on the org+name unique index). Returns how many were newly
     * inserted.
     */
    async seedDefaultObjectTypes(ctx: OntologyCtx): Promise<number> {
        const org = requireOrg(ctx);
        let inserted = 0;
        for (const t of OntologyService.DEFAULT_VIRTUAL_TYPES) {
            const res = await db
                .insert(ontologyObjectTypes)
                .values({
                    organizationId: org,
                    name: t.name,
                    description: t.description,
                    backing: "virtual",
                    sourceAdapter: t.adapter,
                    titleProperty: "name",
                    createdBy: ctx.userId,
                })
                .onConflictDoNothing({ target: [ontologyObjectTypes.organizationId, ontologyObjectTypes.name] })
                .returning({ id: ontologyObjectTypes.id });
            inserted += res.length;
        }
        if (inserted > 0) logger.info(`[Ontology] Seeded ${inserted} default Object Type(s) for org ${org}.`);
        return inserted;
    }

    /**
     * The default `derived` Link Types every org gets.
     *
     * All of them resolve a foreign key the source table already carries, so none of
     * them stores an edge and none can go stale. They exist because an Object Type
     * with no declared relationships is a list, not an ontology: without `step_of`
     * there is no way to get from a failing Pipeline Step Run to the Pipeline it
     * belongs to, even though every id needed to do it is already in the row.
     *
     * `cardinality` is stated source -> target, which is why every FK-derived link
     * here is one_to_one: one step run has exactly one step. The one-to-many reading
     * is the INVERSE direction (a step has many runs), and it is `inverseName` that
     * names it. There is no many_to_one in the enum, and adding one would only
     * rephrase the same fact.
     */
    static readonly DEFAULT_LINK_TYPES: ReadonlyArray<{
        sourceType: string;
        name: string;
        inverseName: string;
        /** NULL => polymorphic: targetTypeProperty on the source row names the type. */
        targetType: string | null;
        sourceProperty: string;
        cardinality: OntologyLinkCardinality;
        description: string;
        /** Polymorphic only: the source property carrying the discriminator. */
        targetTypeProperty?: string;
        /** Polymorphic only: discriminator value -> Object Type name. */
        targetTypeMap?: Record<string, string>;
        /** "derived" (default), "path" — materialized defaults would need stored edges. */
        backing?: string;
        /** Composed only: the ordered hop names to follow. */
        path?: string[];
    }> = [
        ...FINANCIAL_LINKS,
        {
            sourceType: "Pipeline Step", name: "step_of", inverseName: "has_step",
            targetType: "Pipeline", sourceProperty: "pipelineId", cardinality: "one_to_one",
            description: "The pipeline this step is defined in.",
        },
        {
            sourceType: "Pipeline Step", name: "runs_job", inverseName: "run_by_step",
            targetType: "Job", sourceProperty: "jobId", cardinality: "one_to_one",
            description: "The job this step runs. Null for a tool step or a Decision Node.",
        },
        {
            sourceType: "Pipeline Step", name: "falls_back_to", inverseName: "fallback_for_step",
            targetType: "Job", sourceProperty: "fallbackJobId", cardinality: "one_to_one",
            description: "The job this step runs instead when it fails and its on-failure action is to execute a fallback.",
        },
        {
            sourceType: "Pipeline Run", name: "run_of", inverseName: "has_run",
            targetType: "Pipeline", sourceProperty: "pipelineId", cardinality: "one_to_one",
            description: "The pipeline this execution ran.",
        },
        {
            sourceType: "Pipeline Run", name: "ran_for_mission", inverseName: "has_pipeline_run",
            targetType: "Mission", sourceProperty: "missionId", cardinality: "one_to_one",
            description: "The mission this execution ran for, when it was launched by one.",
        },
        // Mission Run. `run_of`/`has_run` deliberately reuses the wording Pipeline Run
        // already has for its pipeline: uniqueness is keyed on (source, name) and
        // (target, inverseName), so the same relationship between different pairs of
        // types keeps the same name, which is the point of naming it.
        {
            sourceType: "Mission Run", name: "run_of", inverseName: "has_run",
            targetType: "Mission", sourceProperty: "missionId", cardinality: "one_to_one",
            description: "The mission this execution ran — the link that separates 'this mission failed once' from 'this mission always fails'.",
        },
        {
            sourceType: "Mission Run", name: "sub_run_of", inverseName: "has_sub_run",
            targetType: "Mission Run", sourceProperty: "parentId", cardinality: "one_to_one",
            description: "The run this one was spawned from, set by a replay or a nested sub-run. Null for a run started directly.",
        },
        {
            sourceType: "Mission Run", name: "on_pipeline", inverseName: "mission_runs_on_pipeline",
            targetType: "Pipeline", sourceProperty: "currentPipelineId", cardinality: "one_to_one",
            description: "Where the run is in its pipeline sequence right now — for a finished or stalled run, where it stopped. Live state, not history: the run's actual pipeline executions are its Pipeline Runs.",
        },
        {
            sourceType: "Pipeline Run", name: "ran_in_mission_run", inverseName: "has_pipeline_run",
            targetType: "Mission Run", sourceProperty: "missionRunId", cardinality: "one_to_one",
            description: "The mission execution that drove this pipeline execution. This is the complete record — a mission run's own pipelineExecutionId names only the current one.",
        },
        {
            sourceType: "Pipeline Step Run", name: "step_run_of", inverseName: "has_step_run",
            targetType: "Pipeline Run", sourceProperty: "pipelineExecutionId", cardinality: "one_to_one",
            description: "The pipeline execution this step execution was part of.",
        },
        {
            sourceType: "Pipeline Step Run", name: "executed_step", inverseName: "has_execution",
            targetType: "Pipeline Step", sourceProperty: "pipelineStepId", cardinality: "one_to_one",
            description: "The step definition this execution is an execution of — the link that turns repeated failures into a named step.",
        },
        {
            sourceType: "Pipeline Step Run", name: "ran_job", inverseName: "job_step_runs",
            targetType: "Job", sourceProperty: "jobId", cardinality: "one_to_one",
            description: "The job that actually ran in this step execution.",
        },
        // Scheduling. The three target links are separate rather than one polymorphic
        // link because the COLUMN names the type here — a scheduled job runs a job, or
        // a pipeline, or a mission, in mutually exclusive columns — so there is no
        // discriminator to read and nothing a polymorphic link would add.
        //
        // Each inverse is named for the far end reading it ("what schedules this
        // mission?"), and they are distinct per target type, which is what the
        // uniqueness the seeder relies on is keyed on.
        {
            sourceType: "Scheduled Job", name: "runs_on_schedule", inverseName: "has_scheduled_job",
            targetType: "Schedule", sourceProperty: "scheduleId", cardinality: "one_to_one",
            description: "The recurrence this is set to run on. Several scheduled jobs can share one Schedule.",
        },
        {
            sourceType: "Scheduled Job", name: "starts_job", inverseName: "job_schedules",
            targetType: "Job", sourceProperty: "jobId", cardinality: "one_to_one",
            description: "The job this starts automatically. Null when it schedules a pipeline or a mission instead.",
        },
        {
            sourceType: "Scheduled Job", name: "starts_pipeline", inverseName: "pipeline_schedules",
            targetType: "Pipeline", sourceProperty: "pipelineId", cardinality: "one_to_one",
            description: "The pipeline this starts automatically. Null when it schedules a job or a mission instead.",
        },
        {
            sourceType: "Scheduled Job", name: "starts_mission", inverseName: "mission_schedules",
            targetType: "Mission", sourceProperty: "missionId", cardinality: "one_to_one",
            description: "The mission this starts automatically — the link that answers why a mission ran when nobody asked for it.",
        },
        // Approval. Three links share the inverse name `has_approval` on purpose: the
        // constraint is per target type, and "this mission's approvals" and "this job's
        // approvals" are the same question asked of different things.
        {
            sourceType: "Approval", name: "for_mission", inverseName: "has_approval",
            targetType: "Mission", sourceProperty: "missionId", cardinality: "one_to_one",
            description: "The mission this decision was requested for.",
        },
        {
            sourceType: "Approval", name: "for_job", inverseName: "has_approval",
            targetType: "Job", sourceProperty: "jobId", cardinality: "one_to_one",
            description: "The job whose execution this decision gates.",
        },
        {
            sourceType: "Approval", name: "about_knowledge_entity", inverseName: "has_approval",
            targetType: "Knowledge Entity", sourceProperty: "knowledgeNodeId", cardinality: "one_to_one",
            description: "The knowledge-graph entity this decision was recorded against, for decision-pattern learning.",
        },
        // Alert. Only two of its three reference-shaped columns are keys. There is no
        // link on `jobRunId`, because there is no job-run table for it to point at:
        // the only writer of a job run id uses Date.now(). Declaring that link would
        // produce an Object Type traversal that can never resolve.
        {
            sourceType: "Alert", name: "raised_for_scheduled_job", inverseName: "has_alert",
            targetType: "Scheduled Job", sourceProperty: "scheduledJobId", cardinality: "one_to_one",
            description: "The scheduled job whose run raised this — the one column on alerts that is a real foreign key, and how a recurring failure gets attributed to the automation causing it.",
        },
        {
            sourceType: "Alert", name: "about_pipeline_run", inverseName: "has_alert",
            targetType: "Pipeline Run", sourceProperty: "pipelineRunId", cardinality: "one_to_one",
            description: "The pipeline execution this alert is about. A bare integer rather than an enforced key, so an unresolvable id means a stale or deleted run, not a bug in the link.",
        },
        // Signal intelligence. The adapters were written for exactly this thread —
        // signal -> prediction -> surprise — and have carried the join key all along.
        {
            sourceType: "Prediction", name: "predicted_from", inverseName: "has_prediction",
            targetType: "Signal", sourceProperty: "signalId", cardinality: "one_to_one",
            description: "The signal this state transition was predicted from.",
        },
        {
            sourceType: "Surprise", name: "surprise_from", inverseName: "has_surprise",
            targetType: "Signal", sourceProperty: "signalId", cardinality: "one_to_one",
            description: "The signal whose prediction this surprise measures the error of.",
        },
        {
            sourceType: "Project Event", name: "event_of", inverseName: "has_event",
            targetType: "Project", sourceProperty: "projectId", cardinality: "one_to_one",
            description: "The project whose timeline this event sits on.",
        },
        // Cycle. It reaches its project through a real column rather than the
        // project_resources junction — the documented single exception, because the
        // relation is strict ownership on the budget-rollup hot path. The inverse is
        // `has_cycle`, not `has_resource`: inverse uniqueness is keyed on (target,
        // inverseName), so reusing `has_resource` here would collide with the
        // junction's own link into Project.
        {
            sourceType: "Cycle", name: "in_project", inverseName: "has_cycle",
            targetType: "Project", sourceProperty: "projectId", cardinality: "one_to_one",
            description: "The Project Space this cycle belongs to, and whose budget its spend rolls up into. Null for a cycle created before project scoping, which today is all of them.",
        },
        {
            sourceType: "Mission Run", name: "ran_in_cycle", inverseName: "has_mission_run",
            targetType: "Cycle", sourceProperty: "cycleId", cardinality: "one_to_one",
            description: "The cycle this run was launched by — the link that turns a cycle from a plan into what it actually executed.",
        },
        // Spatial Region nesting. This is the ONLY spatial link declared as a
        // derived one, because it is the only spatial relation that is a stored
        // property rather than a geometric fact. Adjacency and containment are
        // deliberately absent: both are computed from cell sets by
        // spatialRegionService, and a derived link can only resolve a column the
        // source row carries. Declaring `contains_asset` or `neighbours` here
        // would need a stored edge that nothing recomputes when a boundary moves,
        // and a stale spatial edge is worse than no edge — it answers confidently
        // and wrongly.
        {
            sourceType: "Spatial Region", name: "within_region", inverseName: "has_sub_region",
            targetType: "Spatial Region", sourceProperty: "parentRegionId", cardinality: "one_to_one",
            description: "The larger area this one nests inside — a zone within a region. Null for a top-level area.",
        },
        // Project containment — the FIRST polymorphic defaults. The machinery was
        // built for exactly this table and has shipped unused since.
        //
        // Note what this is NOT: Project Resource stays an Object Type. A derived link
        // resolves a property the SOURCE ROW carries, and `projects` carries no
        // resource ids — the junction does. Declaring `Project --has_resource--> Mission`
        // directly would need the engine to route a link THROUGH a join table, which
        // it cannot do. So the junction is where the two links hang, and reaching a
        // project from a mission is the two-hop walk `project_links` then `in_project`.
        {
            sourceType: "Project Resource", name: "in_project", inverseName: "has_resource",
            targetType: "Project", sourceProperty: "projectId", cardinality: "one_to_one",
            description: "The Project Space this membership row puts its resource in.",
        },
        {
            sourceType: "Project Resource", name: "resource_of", inverseName: "project_links",
            targetType: null, sourceProperty: "resourceId", cardinality: "one_to_one",
            targetTypeProperty: "resourceType",
            // Four of the seven PROJECT_RESOURCE_TYPES have an Object Type today.
            // `job_collection`, `kb_document` and `form` are deliberately absent rather than
            // guessed at: traversal reports an unmapped discriminator by name, which
            // is a better answer than resolving it to the wrong table. `cycle` was in
            // that group until Cycle was registered as a type.
            targetTypeMap: { mission: "Mission", app: "App", dataset: "Dataset", cycle: "Cycle" },
            description: "The thing this membership row points at — a mission, an app or a dataset, named by its resourceType.",
        },
        // ...and the same containment said the way a person asks it. Each composes
        // the two hops above, so a Project reaches its contents directly instead of
        // the caller having to know a junction exists. One per target type rather
        // than one mixed link: `resource_of` is polymorphic, so a single composed
        // link would land on three types at once and could promise none of them.
        ...(["Mission", "App", "Dataset"] as const).map((type) => ({
            sourceType: "Project",
            name: `has_${type.toLowerCase()}`,
            inverseName: `${type.toLowerCase()}_of_project`,
            targetType: type,
            // Unused by a composed link, but the column is NOT NULL-free only for
            // derived ones; the seeder skips this check for paths.
            sourceProperty: "id",
            cardinality: "one_to_many" as OntologyLinkCardinality,
            backing: "path",
            path: ["has_resource", "resource_of"],
            description: `Every ${type.toLowerCase()} in this Project Space, through its membership rows.`,
        })),
        // Hybrid Squad & Actor relationships
        {
            sourceType: "Team", name: "has_lead", inverseName: "leads_team",
            targetType: "User", sourceProperty: "leadUserId", cardinality: "one_to_one",
            description: "The designated human supervisor and escalation lead for this squad.",
        },
    ];

    /**
     * Idempotently declare the default Link Types for an org.
     *
     * Deliberately does NOT go through defineLinkType: that resolves types via
     * getObjectType, which calls ensureDefaultsSeeded, which is what calls this — the
     * memo would make the nested call await the promise it is already inside. So the
     * type ids are resolved in one query here, and sourceProperty is validated against
     * the adapter's property map directly, which is a pure lookup with no I/O.
     *
     * A link naming a type or property that does not exist is skipped with a warning
     * rather than thrown: one bad default must not cost the org the other seven.
     */
    async seedDefaultLinkTypes(ctx: OntologyCtx): Promise<number> {
        const org = requireOrg(ctx);

        const types = await db
            .select({
                id: ontologyObjectTypes.id,
                name: ontologyObjectTypes.name,
                backing: ontologyObjectTypes.backing,
                sourceAdapter: ontologyObjectTypes.sourceAdapter,
                propertiesSchema: ontologyObjectTypes.propertiesSchema,
            })
            .from(ontologyObjectTypes)
            .where(eq(ontologyObjectTypes.organizationId, org));
        const byName = new Map(types.map((t) => [t.name, t]));

        const propertiesOf = (t: (typeof types)[number]): Record<string, any> => {
            const adapter = t.backing === "virtual" && t.sourceAdapter ? getAdapter(t.sourceAdapter) : undefined;
            return adapter ? adapter.properties : ((t.propertiesSchema as Record<string, any>) ?? {});
        };

        let inserted = 0;
        for (const l of OntologyService.DEFAULT_LINK_TYPES) {
            const source = byName.get(l.sourceType);
            const target = l.targetType === null ? undefined : byName.get(l.targetType);
            if (!source || (l.targetType !== null && !target)) {
                logger.warn(
                    `[Ontology] Skipping default link '${l.sourceType} --${l.name}--> ${l.targetType}' for org ${org}: ` +
                        `${!source ? l.sourceType : l.targetType} is not registered.`,
                );
                continue;
            }
            // A composed link has no join key of its own — its hops carry them — so
            // the source-property check applies only to derived ones.
            if ((l.backing ?? "derived") === "derived" && !(l.sourceProperty in propertiesOf(source))) {
                logger.warn(
                    `[Ontology] Skipping default link '${l.name}' for org ${org}: ` +
                        `'${l.sourceType}' has no property '${l.sourceProperty}'.`,
                );
                continue;
            }

            // Polymorphic: keep only the discriminator values whose Object Type this
            // org actually has. Dropping the WHOLE link because one of three targets
            // is switched off would cost the org the other two, and the entries that
            // survive resolve correctly on their own.
            let targetTypeMap: Record<string, string> = {};
            if (l.targetType === null) {
                if (!l.targetTypeProperty || !(l.targetTypeProperty in propertiesOf(source))) {
                    logger.warn(
                        `[Ontology] Skipping polymorphic default link '${l.name}' for org ${org}: ` +
                            `'${l.sourceType}' has no discriminator property '${l.targetTypeProperty}'.`,
                    );
                    continue;
                }
                for (const [value, typeName] of Object.entries(l.targetTypeMap ?? {})) {
                    if (byName.has(typeName)) targetTypeMap[value] = typeName;
                    else logger.warn(`[Ontology] Default link '${l.name}' for org ${org}: dropping '${value}' — no Object Type '${typeName}'.`);
                }
                if (Object.keys(targetTypeMap).length === 0) {
                    logger.warn(`[Ontology] Skipping polymorphic default link '${l.name}' for org ${org}: nothing it points at is registered.`);
                    continue;
                }
            }

            const res = await db
                .insert(ontologyLinkTypes)
                .values({
                    organizationId: org,
                    name: l.name,
                    inverseName: l.inverseName,
                    description: l.description,
                    sourceTypeId: source.id,
                    targetTypeId: target?.id ?? null,
                    cardinality: l.cardinality,
                    backing: l.backing ?? "derived",
                    sourceProperty: (l.backing ?? "derived") === "derived" ? l.sourceProperty : null,
                    path: l.path ?? [],
                    targetProperty: "id",
                    targetTypeProperty: l.targetTypeProperty ?? null,
                    targetTypeMap,
                    createdBy: ctx.userId,
                })
                // Idempotent, but does not resurrect a link an org deliberately turned
                // off: isActive is left alone, unlike defineLinkType, where re-declaring
                // is an explicit act by a caller who wants it back.
                .onConflictDoNothing({
                    target: [
                        ontologyLinkTypes.organizationId,
                        ontologyLinkTypes.sourceTypeId,
                        ontologyLinkTypes.name,
                    ],
                })
                .returning({ id: ontologyLinkTypes.id });
            inserted += res.length;
        }

        if (inserted > 0) logger.info(`[Ontology] Seeded ${inserted} default Link Type(s) for org ${org}.`);
        return inserted;
    }

    /** Handler ref for the builtin that declares a Link Type. */
    static readonly DEFINE_LINK_TYPE_REF = "ontology.define_link_type";
    static readonly LINK_OBJECTS_REF = "ontology.link_objects";
    static readonly UNLINK_OBJECTS_REF = "ontology.unlink_objects";

    /**
     * Governed Actions every org gets.
     *
     * `parametersSchema` lists ONLY genuinely required params: validateActionParams
     * treats every key in it as mandatory, so an optional param declared here would
     * be impossible to omit. The rest (targetType, cardinality, polymorphic fields)
     * are validated inside defineLinkType, which can express optionality.
     *
     * effect "write" + requiresApproval means declaring a relationship routes through
     * decisionRouter like any other ontology write — schema changes are governed by
     * the same gate as data changes.
     */
    static readonly DEFAULT_ACTIONS: ReadonlyArray<{
        name: string;
        description: string;
        handlerRef: string;
        parametersSchema: Record<string, string>;
        riskLevel: string;
    }> = [
        {
            name: "define_link_type",
            description:
                "Declare either a derived relationship over an existing property or a stored relationship between materialized Object Types.",
            handlerRef: OntologyService.DEFINE_LINK_TYPE_REF,
            parametersSchema: {
                sourceType: "string",
                name: "string",
                inverseName: "string",
            },
            riskLevel: "low",
        },
        {
            name: "link_objects",
            description:
                "Record a relationship between two objects, for a link type backed by stored edges. " +
                "Idempotent — linking the same pair twice states the same fact once.",
            handlerRef: OntologyService.LINK_OBJECTS_REF,
            parametersSchema: {
                sourceType: "string",
                linkName: "string",
                sourceId: "string",
                targetId: "string",
            },
            riskLevel: "low",
        },
        {
            name: "unlink_objects",
            description: "Remove a stored relationship between two objects. Removing one that is not there is not an error.",
            handlerRef: OntologyService.UNLINK_OBJECTS_REF,
            parametersSchema: {
                sourceType: "string",
                linkName: "string",
                sourceId: "string",
                targetId: "string",
            },
            riskLevel: "low",
        },
    ];

    /** Idempotently register the default governed Actions for an org. */
    async seedDefaultActions(ctx: OntologyCtx): Promise<number> {
        const org = requireOrg(ctx);
        let inserted = 0;
        for (const a of OntologyService.DEFAULT_ACTIONS) {
            const res = await db
                .insert(ontologyActions)
                .values({
                    organizationId: org,
                    name: a.name,
                    description: a.description,
                    parametersSchema: a.parametersSchema,
                    effect: "write",
                    handlerKind: "builtin",
                    handlerRef: a.handlerRef,
                    requiresApproval: true,
                    riskLevel: a.riskLevel,
                    createdBy: ctx.userId,
                })
                .onConflictDoUpdate({
                    target: [ontologyActions.organizationId, ontologyActions.name],
                    set: {
                        description: a.description,
                        parametersSchema: a.parametersSchema,
                        handlerRef: a.handlerRef,
                        requiresApproval: true,
                        riskLevel: a.riskLevel,
                    },
                })
                .returning({ id: ontologyActions.id });
            inserted += res.length;
        }
        if (inserted > 0) logger.info(`[Ontology] Seeded ${inserted} default Action(s) for org ${org}.`);
        return inserted;
    }
}

/**
 * Register the code-backed Action handlers.
 *
 * Called at module load, unlike the mock `bootstrap()` this service used to carry:
 * that one injected fake DB rows and made every tenant see the same demo object.
 * This is a pure Map.set with no I/O and no tenant state — the handler still runs
 * only when an org-scoped, approved Action dispatches to it.
 *
 * Exported so tests can re-register against a fresh registry.
 */
export function registerOntologyBuiltins(): void {
    OntologyService.registerBuiltin(
        OntologyService.DEFINE_LINK_TYPE_REF,
        async (ctx, params) => ontologyService.defineLinkType(ctx, params as any),
    );
    OntologyService.registerBuiltin(
        OntologyService.LINK_OBJECTS_REF,
        async (ctx, params) => ontologyService.link(ctx, params as any),
    );
    OntologyService.registerBuiltin(
        OntologyService.UNLINK_OBJECTS_REF,
        async (ctx, params) => ontologyService.unlink(ctx, params as any),
    );
}

/** Shared singleton. */
export const ontologyService = new OntologyService();

registerOntologyBuiltins();
