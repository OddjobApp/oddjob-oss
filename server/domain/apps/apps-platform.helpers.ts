import { db } from "@server/database_service.js";
import { apps, appRecords } from "@shared/schema/index.js";
import { and, or, eq, sql, desc } from "drizzle-orm";
import crypto from "node:crypto";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AppPlatformHelpers");

export function normalizeLookupName(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

export async function recordAppOutbox(
    appId: number,
    orgId: number,
    kind: string,
    data: Record<string, unknown>,
): Promise<string> {
    const recordId = `${kind}-${crypto.randomUUID()}`.slice(0, 100);
    await db
        .insert(appRecords)
        .values({
            appId,
            orgId,
            collection: "sdlc_integration_outbox",
            recordId,
            data: {
                kind,
                status: "queued",
                createdAt: new Date().toISOString(),
                ...data,
            },
        })
        .catch((err: any) => {
            logger.warn(
                `[AppPlatform] Failed to persist ${kind} outbox record: ${err.message}`,
            );
        });
    return recordId;
}

export async function resolveOrgAppIdBySlug(
    orgId: number,
    slug: string,
): Promise<number | null> {
    const orgSuffixedSlug = `${slug}-org${orgId}`;
    const [row] = await db
        .select({ id: apps.id })
        .from(apps)
        .where(
            and(
                or(eq(apps.slug, slug), eq(apps.slug, orgSuffixedSlug)),
                eq(apps.organizationId, orgId),
            ),
        )
        .limit(1);
    return row?.id ?? null;
}

export async function computeAggregate(
    appId: number,
    orgId: number,
    agg: { collection?: string; op?: string; field?: string },
): Promise<number | null> {
    const collection = typeof agg?.collection === "string" ? agg.collection : "";
    const op = typeof agg?.op === "string" ? agg.op : "";
    const field = typeof agg?.field === "string" ? agg.field : "";
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(collection)) return null;
    if (op !== "count" && !/^[a-zA-Z0-9_]{1,60}$/.test(field)) return null;

    const scope = and(
        eq(appRecords.appId, appId),
        eq(appRecords.orgId, orgId),
        eq(appRecords.collection, collection),
    );

    if (op === "count") {
        const [r] = await db
            .select({ v: sql<number>`count(*)::int` })
            .from(appRecords)
            .where(scope);
        return r?.v ?? 0;
    }

    const numeric = sql`(${appRecords.data} ->> ${field})::numeric`;
    let expr;
    switch (op) {
        case "sum":
            expr = sql<string>`coalesce(sum(${numeric}), 0)`;
            break;
        case "sum_positive":
            expr = sql<string>`coalesce(sum(${numeric}) filter (where ${numeric} > 0), 0)`;
            break;
        case "sum_negative":
            expr = sql<string>`coalesce(sum(${numeric}) filter (where ${numeric} < 0), 0)`;
            break;
        case "avg":
            expr = sql<string>`coalesce(avg(${numeric}), 0)`;
            break;
        default:
            return null;
    }
    const [r] = await db.select({ v: expr }).from(appRecords).where(scope);
    const n = Number(r?.v);
    return Number.isFinite(n) ? n : null;
}

export async function buildAgentGroundingContext(
    orgId: number,
    grounding: any,
): Promise<string> {
    const slug =
        typeof grounding?.app_slug === "string" ? grounding.app_slug : null;
    const collections: string[] = Array.isArray(grounding?.collections)
        ? grounding.collections
        : [];
    const aggregates: any[] = Array.isArray(grounding?.aggregates)
        ? grounding.aggregates
        : [];
    if (!slug || (collections.length === 0 && aggregates.length === 0)) return "";

    const sourceAppId = await resolveOrgAppIdBySlug(orgId, slug);
    if (sourceAppId == null) return "";

    const maxRows = Math.min(
        Math.max(Number(grounding?.max_rows_per_collection) || 40, 1),
        200,
    );
    const sections: string[] = [];

    // Server-computed aggregates first — these are authoritative; the model is
    // told to quote them verbatim rather than re-deriving from the rows below.
    if (aggregates.length > 0) {
        const lines: string[] = [];
        for (const agg of aggregates) {
            const value = await computeAggregate(sourceAppId, orgId, agg);
            if (value == null) continue;
            const label =
                typeof agg?.label === "string"
                    ? agg.label
                    : `${agg?.op}(${agg?.collection}.${agg?.field})`;
            lines.push(`- ${label}: ${value}`);
        }
        if (lines.length > 0) {
            sections.push(
                `### DERIVED AGGREGATES (authoritative, server-computed — quote these exactly)\n${lines.join("\n")}`,
            );
        }
    }

    for (const collection of collections) {
        if (!/^[a-zA-Z0-9_-]{1,60}$/.test(collection)) continue;
        const rows = await db
            .select({ recordId: appRecords.recordId, data: appRecords.data })
            .from(appRecords)
            .where(
                and(
                    eq(appRecords.appId, sourceAppId),
                    eq(appRecords.orgId, orgId),
                    eq(appRecords.collection, collection),
                ),
            )
            .orderBy(desc(appRecords.updatedAt))
            .limit(maxRows);
        if (rows.length === 0) continue;
        const lines = rows.map((r) =>
            JSON.stringify({
                recordId: r.recordId,
                ...(r.data as Record<string, any>),
            }),
        );
        sections.push(
            `### ${collection} (${rows.length} row${rows.length === 1 ? "" : "s"})\n${lines.join("\n")}`,
        );
    }
    return sections.join("\n\n");
}

export function normalizeHilFields(schema: any): Array<{
    name: string;
    label: string;
    type: "select" | "textarea" | "text";
    options?: string[];
    required?: boolean;
}> {
    const fields = Array.isArray(schema?.fields) ? schema.fields : [];

    return fields
        .map((field: any) => {
            const name = String(field?.name ?? field?.key ?? "").trim();
            if (!name) return null;

            const rawType = String(field?.type ?? "text").toLowerCase();
            const type =
                rawType === "select"
                    ? "select"
                    : rawType === "textarea" || rawType === "url_list"
                        ? "textarea"
                        : "text";

            return {
                name,
                label: String(field?.label ?? name),
                type,
                options: Array.isArray(field?.options)
                    ? field.options.map((option: any) => String(option))
                    : undefined,
                required: Boolean(field?.required),
            };
        })
        .filter(Boolean) as Array<{
        name: string;
        label: string;
        type: "select" | "textarea" | "text";
        options?: string[];
        required?: boolean;
    }>;
}

export function getHilStage(schema: any, config: any): string {
    return String(
        schema?.stage ??
        schema?.context?.stage ??
        config?.stage ??
        config?.milestone ??
        config?.type ??
        "general",
    );
}

export function matchesHilStage(
    stage: string | undefined,
    form: { name: string; schema: any; config: any },
): boolean {
    if (!stage) return true;
    const needle = stage.toLowerCase();
    const candidates = [
        getHilStage(form.schema, form.config),
        form.schema?.context?.stage,
        form.config?.stage,
        form.config?.milestone,
        form.config?.type,
        form.name,
    ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

    return candidates.some((value) => value === needle || value.includes(needle));
}
