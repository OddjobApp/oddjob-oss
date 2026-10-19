import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { requireToolOrgId } from "./org-context.js";

/**
 * Read an installed app's stored records, so a room can reason over what an app
 * holds instead of only opening it. Read-only: writes to an app's records stay
 * with the app and with approval-gated paths.
 *
 * Failures throw rather than return a message, so the crew executor records the
 * call as failed and a draft cannot cite a lookup that found nothing.
 */

/**
 * Largest JSON this tool returns. CREW cuts tool output at
 * MAX_TOOL_OUTPUT_CHARS (4000); a page that overflows was cut mid-record while
 * its header still claimed the full page, so the agent reported rows it never
 * saw. The tool fits the page itself and says exactly what it returned.
 */
export const APP_RECORDS_OUTPUT_BUDGET = 3500;

/** One oversized field must not crowd out every other record. */
const MAX_VALUE_CHARS = 300;

function trimValue(value: unknown): unknown {
    if (typeof value === "string" && value.length > MAX_VALUE_CHARS) {
        return `${value.slice(0, MAX_VALUE_CHARS)}… [${value.length - MAX_VALUE_CHARS} more chars]`;
    }
    if (Array.isArray(value)) return value.map(trimValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimValue(v)]));
    }
    return value;
}

function project(data: unknown, fields: string[] | undefined): unknown {
    if (!fields?.length || !data || typeof data !== "object" || Array.isArray(data)) return data;
    const source = data as Record<string, unknown>;
    return Object.fromEntries(fields.filter((f) => f in source).map((f) => [f, source[f]]));
}

/**
 * The page as JSON, with as many records as fit the budget. `summary` states
 * what was returned and how to get the rest, so it cannot disagree with the rows.
 */
export function fitRecordPage(page: {
    app: { id: number; slug: string; name: string };
    collection: string;
    total: number;
    offset: number;
    records: Array<{ recordId: string; data: unknown; updatedAt: string }>;
}, opts: { fields?: string[] } = {}): string {
    const records = page.records.map((r) => ({ ...r, data: trimValue(project(r.data, opts.fields)) }));

    const render = (count: number) => {
        const returned = records.slice(0, count);
        const nextOffset = page.offset + count;
        const remaining = Math.max(page.total - nextOffset, 0);
        const sizeLimited = count < page.records.length;
        const summary =
            page.total === 0
                ? `No records matched in '${page.collection}' of ${page.app.name}.`
                : `Returned ${count} of ${page.total} matching record(s) from '${page.collection}' of ${page.app.name}` +
                  (page.offset ? `, starting at offset ${page.offset}` : "") + ". " +
                  (remaining > 0 ? `${remaining} more: call again with offset ${nextOffset}.` : "That is all of them.") +
                  (sizeLimited
                      ? ` Only ${count} fitted in one response; pass \`fields\` to return fewer fields per record, ` +
                        "or use `aggregate` for totals instead of reading every row."
                      : "");
        return JSON.stringify({
            summary,
            app: page.app,
            collection: page.collection,
            matched: page.total,
            returned: count,
            offset: page.offset,
            nextOffset: remaining > 0 ? nextOffset : null,
            records: returned,
        });
    };

    let count = records.length;
    let out = render(count);
    while (out.length > APP_RECORDS_OUTPUT_BUDGET && count > 0) {
        count -= 1;
        out = render(count);
    }
    return out;
}

export const APP_RECORDS_TOOLS: Record<string, ToolDefinition> = {
    read_app_activity: {
        name: "read_app_activity",
        idempotency: "read-safe",
        description: "Read persisted app-scoped telemetry with timestamps and provenance. Use the canonical mounted app slug. These app-reported events are app-wide, not room-specific or proof of completed operations; this does not read the organization-wide forensic feed.",
        parameters: z.object({ app: z.string().min(1), limit: z.number().int().min(1).max(100).default(10).describe("Requested page size; at most 10 events fit per response. Follow nextBeforeId for more."), beforeId: z.number().int().positive().optional() }),
        execute: async (params: any, context: ToolContext) => {
            const { readAppActivity } = await import("@domain/apps/core/app-activity-reader.service.js");
            return JSON.stringify(await readAppActivity({ organizationId: requireToolOrgId(context), userId: context.userId,
                agentName: typeof context.agentName === "string" ? context.agentName : undefined,
                isOrgAdmin: !!context.isOrgAdmin, isSuperAdmin: !!context.isSuperAdmin,
                roomProjectId: context.sessionKey ? ((context.projectId as number | null | undefined) ?? null) : undefined,
            }, String(params.app), params.limit, params.beforeId));
        },
    },
    read_app_records: {
        name: "read_app_records",
        idempotency: "read-safe",
        label: "Read App Records",
        group: "App Forge",
        description:
            "Read the records an installed app has stored for this organization (e.g. BudgetMaster transactions, " +
            "QA Workbench defects, Rescue Dispatch active rescues). Call with only `app` to list the app's collections " +
            "and record counts; then call again with a `collection` to read its rows, optionally filtered on one field. " +
            "For totals, averages or counts use `aggregate` instead of reading every row. Get the app slug from " +
            "list_installed_apps. The `summary` states exactly how many records were returned and the offset for the " +
            "next page — quote it, and never present a partial page as the whole collection.",
        parameters: z.object({
            app: z.string().min(1).describe("Canonical app slug from list_installed_apps or the server-resolved mounted app binding. A display name or local /app/<deployment> path also works; access remains organization and Project Space scoped."),
            collection: z.string().optional().describe("Collection to read; omit to list the app's collections"),
            recordId: z.string().min(1).max(150).optional().describe("Exact persisted recordId, for a handoff or source-evidence reference. Requires collection; does not match an arbitrary logical id field."),
            filterField: z.string().optional().describe("Top-level record field to filter on"),
            filterValue: z.string().optional().describe("Value that field must equal (case-insensitive)"),
            fields: z.array(z.string()).optional().describe("Only these top-level fields of each record — fits more records per call"),
            limit: z.number().optional().default(25).describe("Max rows to return (1-100); fewer come back if they do not fit"),
            offset: z.number().optional().default(0).describe("Start at this record; use nextOffset from the previous call"),
            aggregate: z.object({
                op: z.enum(["count", "sum", "avg", "min", "max"]),
                field: z.string().optional().describe("Numeric field; required except for count"),
                groupBy: z.string().optional().describe("Field to group by, e.g. 'payee_raw' or 'status'"),
            }).optional().describe("Compute over every matching record instead of returning rows"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const orgId = requireToolOrgId(context);
            const {
                resolveAppForRecords, listAppCollections, readAppRecords, aggregateAppRecords,
            } = await import("@domain/apps/core/app-records-reader.service.js");

            const ctx = {
                organizationId: orgId,
                userId: context.userId,
                agentName: typeof context.agentName === "string" ? context.agentName : undefined,
                isOrgAdmin: !!context.isOrgAdmin,
                isSuperAdmin: !!context.isSuperAdmin,
                // A CREW call speaks into a room; its reply is read by everyone there.
                roomProjectId: context.sessionKey ? ((context.projectId as number | null | undefined) ?? null) : undefined,
            };
            const app = await resolveAppForRecords(ctx, String(params.app));
            if (params.recordId && !params.collection) throw new Error('collection is required with recordId');

            if (!params.collection) {
                const collections = await listAppCollections(app.id, orgId);
                return JSON.stringify({
                    app,
                    collections,
                    note: collections.length === 0
                        ? "This app has stored no records for this organization."
                        : "Call read_app_records again with one of these collections. Collections marked quickbooks " +
                          "are mirrored from QuickBooks and need a finance role to read.",
                });
            }

            const filter = { recordId: params.recordId, filterField: params.filterField || undefined, filterValue: params.filterValue };
            if (params.aggregate) {
                const result = await aggregateAppRecords(ctx, app, {
                    collection: String(params.collection),
                    ...filter,
                    op: params.aggregate.op,
                    field: params.aggregate.field,
                    groupBy: params.aggregate.groupBy,
                });
                const skipped = result.matched - result.counted;
                const render = (groups: typeof result.groups) => {
                    const shown = groups?.length ?? 0;
                    const groupsNote = result.totalGroups && result.totalGroups > shown
                        ? ` Showing the top ${shown} of ${result.totalGroups} groups by value.`
                        : "";
                    return JSON.stringify({
                        summary:
                            `${result.op}${result.field ? ` of ${result.field}` : ""} over ${result.counted} of ${result.matched} matching record(s)` +
                            (skipped > 0 ? ` (${skipped} had no numeric ${result.field} and were skipped)` : "") + "." + groupsNote,
                        ...result,
                        ...(groups ? { groups } : {}),
                    });
                };
                let groups = result.groups;
                let out = render(groups);
                while (groups && groups.length > 0 && out.length > APP_RECORDS_OUTPUT_BUDGET) {
                    groups = groups.slice(0, groups.length - 1);
                    out = render(groups);
                }
                return out;
            }

            const requested = Math.min(Math.max(Number(params.limit) || 25, 1), 100);
            const page = await readAppRecords(ctx, app, {
                collection: String(params.collection),
                ...filter,
                limit: requested,
                offset: Math.max(Number(params.offset) || 0, 0),
            });
            return fitRecordPage(page, { fields: params.fields });
        },
    },
    propose_app_action: {
        name: "propose_app_action",
        idempotency: "idempotent",
        label: "Propose App Action",
        group: "App Forge",
        description:
            "Propose creating, updating, or deleting a record in an installed app's collection (e.g. logging a ticket, " +
            "adding an expense item, creating a dispatch incident). Renders a structured approval card in the room " +
            "so a human can review the proposed fields before any changes are written. Specify `app` (slug or name), " +
            "`action` ('create_record', 'update_record', or 'delete_record'), `collection`, optional `recordId`, " +
            "`data` (fields to set), and `reason`.",
        parameters: z.object({
            app: z.string().min(1).describe("App slug from list_installed_apps or read_app_records (e.g. 'budgetmaster-workbench', 'rescue-dispatch')"),
            action: z.enum(["create_record", "update_record", "delete_record"]).describe("Action to perform: 'create_record', 'update_record', or 'delete_record'"),
            collection: z.string().min(1).describe("Target collection name in the app (e.g. 'transactions', 'tickets', 'active_rescues')"),
            recordId: z.string().optional().describe("Record identifier; required for update_record and delete_record"),
            data: z.record(z.unknown()).optional().describe("Key-value record fields to write or update"),
            reason: z.string().min(1).describe("Why this action is proposed for human review"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const orgId = requireToolOrgId(context);
            const { resolveAppForRecords } = await import("@domain/apps/core/app-records-reader.service.js");
            const ctx = {
                organizationId: orgId,
                userId: context.userId,
                agentName: typeof context.agentName === "string" ? context.agentName : undefined,
                isOrgAdmin: !!context.isOrgAdmin,
                isSuperAdmin: !!context.isSuperAdmin,
                roomProjectId: context.sessionKey ? ((context.projectId as number | null | undefined) ?? null) : undefined,
            };
            const app = await resolveAppForRecords(ctx, String(params.app));

            if ((params.action === "update_record" || params.action === "delete_record") && !params.recordId) {
                throw new Error(`A recordId is required to ${params.action.replace("_", " ")}.`);
            }

            const { db } = await import("@server/database_service.js");
            const { approvalRequests } = await import("@shared/schema/index.js");
            const { and, eq } = await import("drizzle-orm");

            const meta = {
                type: "approval_request",
                kind: "app_record_action",
                action: params.action,
                app: { id: app.id, slug: app.slug, name: app.name },
                collection: String(params.collection),
                recordId: params.recordId ? String(params.recordId) : null,
                data: params.data ?? {},
                reason: String(params.reason),
                requestedBy: context.agentName || context.userId || "assistant",
                sessionKey: context.sessionKey ?? null,
                projectId: context.projectId ?? null,
                organizationId: orgId,
                status: "pending",
            };

            // Deduplicate if identical pending proposal exists in this room
            if (context.sessionKey) {
                const pending = await db
                    .select({ id: approvalRequests.id, toolArgs: approvalRequests.toolArgs })
                    .from(approvalRequests)
                    .where(and(
                        eq(approvalRequests.toolName, "propose_app_action"),
                        eq(approvalRequests.organizationId, orgId),
                        eq(approvalRequests.status, "pending"),
                    ))
                    .limit(30);

                const existing = pending.find((r) => {
                    const m = r.toolArgs as any;
                    return m?.kind === "app_record_action"
                        && m.sessionKey === context.sessionKey
                        && m.app?.id === app.id
                        && m.collection === params.collection
                        && m.action === params.action
                        && m.recordId === (params.recordId || null)
                        && JSON.stringify(m.data) === JSON.stringify(params.data ?? {});
                });
                if (existing) {
                    return JSON.stringify({
                        ...meta,
                        proposalId: existing.id,
                        message: "This action is already proposed and waiting for review on its approval card.",
                    });
                }
            }

            // The requesting person approves, as for the other CREW proposals
            // (google-calendar.ts, youtube.ts). approval_requests has no project
            // column; the project rides in toolArgs.
            const actor = String(context.userId ?? "crew");
            const [inserted] = await db
                .insert(approvalRequests)
                .values({
                    executionId: `app_action_${randomBytes(16).toString("hex")}`,
                    toolName: "propose_app_action",
                    toolArgs: meta as any,
                    approverType: "user",
                    approverEmail: actor,
                    ...(/^[0-9a-f-]{36}$/i.test(actor) ? { approverId: actor } : {}),
                    token: randomBytes(24).toString("hex"),
                    organizationId: orgId,
                    status: "pending",
                })
                .returning({ id: approvalRequests.id });

            return JSON.stringify({
                ...meta,
                proposalId: inserted.id,
                message: `Proposed ${params.action.replace("_", " ")} in '${params.collection}' of ${app.name}. Waiting for approval.`,
            });
        },
    },
};

