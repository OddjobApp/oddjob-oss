import { and, desc, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { saasConnectors, saasSchemaSnapshots } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import { hasSchemaDrift } from "./saas-sync.service.js";
import {
    getServiceNowConfig,
    snRequest,
    type ServiceNowConfig,
} from "@domain/tools/v1/capabilities/servicenow.js";

const logger = createLogger("ServiceNowSchema");

/**
 * Capturing a ServiceNow table's schema, the way Jira's is captured on sync.
 *
 * `saas_schema_snapshots` was always platform-agnostic — a `platform` column and
 * a `fields` blob — and `routes/saas/sync.ts` versions whatever it is handed.
 * What was missing was a capture: the only automatic one built a JiraClient and
 * called getFields(), so a connected ServiceNow instance could never produce a
 * snapshot, and the adapter surface reported "No schema captured" forever.
 *
 * ServiceNow keeps field definitions in `sys_dictionary`, one row per column,
 * which is the equivalent of Jira's /field endpoint.
 */

/** ServiceNow marks customer-added fields with a `u_` (or `x_` for scoped app) prefix. */
function isCustomField(element: string): boolean {
    return /^(u_|x_)/i.test(element);
}

/**
 * Normalised to the shape `hasSchemaDrift` already compares — id, name, custom,
 * schema — so drift detection is shared with Jira rather than reimplemented per
 * platform. The mapping is real rather than cosmetic: ServiceNow's `u_` prefix
 * is its customer-field convention, which is what Jira's `custom` flag means.
 */
export interface NormalisedSchemaField {
    id: string;
    name: string;
    custom: boolean;
    schema: {
        type: string | null;
        maxLength: number | null;
        mandatory: boolean;
        readOnly: boolean;
    };
}

/** The dictionary rows for one table, normalised. */
export async function fetchServiceNowSchemaFields(
    config: ServiceNowConfig,
    tableName: string,
): Promise<NormalisedSchemaField[]> {
    // Display values so `internal_type` reads as "String" rather than a sys_id:
    // it is a reference field, and the raw value is meaningless in a snapshot.
    const query = [
        `sysparm_query=${encodeURIComponent(`name=${tableName}^elementISNOTEMPTY^ORDERBYelement`)}`,
        `sysparm_fields=${encodeURIComponent("element,column_label,internal_type,max_length,mandatory,read_only")}`,
        "sysparm_display_value=true",
        "sysparm_limit=2000",
    ].join("&");

    const response = await snRequest(config, `/table/sys_dictionary?${query}`);
    const rows: any[] = Array.isArray(response?.result) ? response.result : [];

    return rows
        // A dictionary row with no `element` describes the table itself, not a
        // column. ServiceNow returns one per table and it is not a field.
        .filter((row) => typeof row?.element === "string" && row.element.trim())
        .map((row) => {
            const element = String(row.element).trim();
            const maxLength = Number(row.max_length);
            return {
                id: element,
                name: String(row.column_label || element),
                custom: isCustomField(element),
                schema: {
                    type: row.internal_type ? String(row.internal_type) : null,
                    maxLength: Number.isFinite(maxLength) && maxLength > 0 ? maxLength : null,
                    // ServiceNow returns booleans as the strings "true"/"false".
                    mandatory: String(row.mandatory) === "true",
                    readOnly: String(row.read_only) === "true",
                },
            };
        });
}

export interface SchemaCaptureResult {
    captured: boolean;
    reason: "drift" | "first_capture" | "unchanged";
    version: number;
    fieldCount: number;
    tableName: string;
}

/**
 * Captures a versioned snapshot, writing only when the schema actually changed.
 *
 * Same rule Jira's capture follows: an unchanged schema must not mint a new
 * version, or the version number stops meaning "the schema changed here" and
 * becomes a count of how often sync ran.
 */
export async function captureServiceNowSchema(
    orgId: number,
    tableName = "incident",
): Promise<SchemaCaptureResult> {
    const config = await getServiceNowConfig(orgId);
    if (!config) {
        throw new Error(
            `No ServiceNow connection for organization ${orgId}. Connect ServiceNow before capturing a schema.`,
        );
    }

    const [connector] = await db
        .select({ id: saasConnectors.id })
        .from(saasConnectors)
        .where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.platform, "servicenow")))
        .limit(1);

    if (!connector) {
        throw new Error(
            `ServiceNow is configured for organization ${orgId} but has no saas_connectors row to attach a snapshot to.`,
        );
    }

    const fields = await fetchServiceNowSchemaFields(config, tableName);

    // Snapshots are per connector, and one instance has many tables — so compare
    // against the latest snapshot FOR THIS TABLE. Without the name filter,
    // capturing `incident` then `change_request` would read as constant drift.
    const [lastSnapshot] = await db
        .select()
        .from(saasSchemaSnapshots)
        .where(and(
            eq(saasSchemaSnapshots.connectorId, connector.id),
            eq(saasSchemaSnapshots.name, snapshotName(tableName)),
        ))
        .orderBy(desc(saasSchemaSnapshots.version))
        .limit(1);

    if (lastSnapshot && !hasSchemaDrift(fields, (lastSnapshot.fields as any[]) || [])) {
        return {
            captured: false,
            reason: "unchanged",
            version: lastSnapshot.version,
            fieldCount: fields.length,
            tableName,
        };
    }

    const version = (lastSnapshot?.version || 0) + 1;
    await db.insert(saasSchemaSnapshots).values({
        connectorId: connector.id,
        platform: "servicenow",
        name: snapshotName(tableName),
        fields,
        version,
        createdAt: new Date(),
    });

    logger.info(
        `Captured ServiceNow schema for ${tableName} (org ${orgId}): v${version}, ${fields.length} fields`,
    );

    return {
        captured: true,
        reason: lastSnapshot ? "drift" : "first_capture",
        version,
        fieldCount: fields.length,
        tableName,
    };
}

/** Stable per table, so versions of the same table form one series. */
function snapshotName(tableName: string): string {
    return `ServiceNow ${tableName} schema`;
}
