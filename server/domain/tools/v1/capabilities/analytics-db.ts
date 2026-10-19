import { z } from "zod";
import type { ToolDefinition } from "./types.js";

async function getAnalyticsCredential(orgId: number | null | undefined, type: "snowflake" | "bigquery") {
    if (!orgId) return null;
    try {
        const { db } = await import("@server/database_service.js");
        const { credentials } = await import("@shared/schema/index.js");
        const { eq, and } = await import("drizzle-orm");
        const [cred] = await db
            .select()
            .from(credentials)
            .where(and(eq(credentials.organizationId, orgId), eq(credentials.type, type)))
            .limit(1);
        if (cred?.metadata) return cred.metadata as any;
    } catch {}
    return null;
}

export const ANALYTICS_DB_TOOLS: Record<string, ToolDefinition> = {
    snowflake_query: {
        name: "snowflake_query",

        idempotency: "read-safe",
        label: "Snowflake SQL Query",
        group: "Analytics Databases",
        description: "Execute a SQL query against a Snowflake data warehouse. Returns up to 500 rows. Use for large-scale analytics and reporting queries.",
        parameters: z.object({
            query: z.string().describe("SQL query to execute against Snowflake"),
            warehouse: z.string().optional().describe("Snowflake virtual warehouse to use (overrides default)"),
            database: z.string().optional().describe("Snowflake database (overrides credential default)"),
            schema: z.string().optional().describe("Snowflake schema (overrides credential default)"),
            limit_rows: z.number().min(1).max(500).default(100).optional().describe("Max rows to return"),
        }),
        execute: async (params, context) => {
            const cred = await getAnalyticsCredential(context?.organizationId, "snowflake");
            if (!cred) return "Snowflake is not configured. Add a Snowflake credential in Settings.";
            try {
                const snowflake = await import("snowflake-sdk");
                const connection = snowflake.createConnection({
                    account: cred.account,
                    username: cred.username,
                    password: cred.password,
                    warehouse: params.warehouse || cred.warehouse,
                    database: params.database || cred.database,
                    schema: params.schema || cred.schema,
                });
                await new Promise<void>((resolve, reject) => connection.connect((err: any) => err ? reject(err) : resolve()));
                const limitedQuery = params.query.trim().replace(/;$/, "") + ` LIMIT ${params.limit_rows || 100}`;
                const rows: any[] = await new Promise((resolve, reject) => {
                    connection.execute({
                        sqlText: limitedQuery,
                        complete: (err: any, stmt: any, rows: any) => err ? reject(err) : resolve(rows || []),
                    });
                });
                await new Promise<void>((resolve) => connection.destroy(() => resolve()));
                return JSON.stringify({ rowCount: rows.length, rows: rows.slice(0, params.limit_rows || 100) }, null, 2);
            } catch (err: any) {
                return `Snowflake query error: ${err.message}`;
            }
        },
    },

    bigquery_query: {
        name: "bigquery_query",

        idempotency: "read-safe",
        label: "BigQuery SQL Query",
        group: "Analytics Databases",
        description: "Execute a SQL query against Google BigQuery. Returns up to 500 rows. Use for large-scale analytics on GCP.",
        parameters: z.object({
            query: z.string().describe("Standard SQL query to run in BigQuery"),
            project_id: z.string().optional().describe("GCP project ID (overrides credential default)"),
            location: z.string().optional().default("US").describe("Dataset location (e.g. US, EU)"),
            limit_rows: z.number().min(1).max(500).default(100).optional(),
        }),
        execute: async (params, context) => {
            const cred = await getAnalyticsCredential(context?.organizationId, "bigquery");
            if (!cred) return "BigQuery is not configured. Add a BigQuery credential in Settings.";
            try {
                const { BigQuery } = await import("@google-cloud/bigquery");
                const bq = new BigQuery({
                    projectId: params.project_id || cred.project_id,
                    credentials: cred.service_account_key,
                    location: params.location || "US",
                });
                const [rows] = await bq.query({
                    query: params.query,
                    maximumBytesBilled: "5000000000",
                });
                const limited = rows.slice(0, params.limit_rows || 100);
                return JSON.stringify({ rowCount: rows.length, rows: limited }, null, 2);
            } catch (err: any) {
                return `BigQuery query error: ${err.message}`;
            }
        },
    },

    bigquery_list_datasets: {
        name: "bigquery_list_datasets",

        idempotency: "read-safe",
        label: "List BigQuery Datasets",
        group: "Analytics Databases",
        description: "List available datasets in a BigQuery project.",
        parameters: z.object({
            project_id: z.string().optional().describe("GCP project ID (overrides credential default)"),
        }),
        execute: async (params, context) => {
            const cred = await getAnalyticsCredential(context?.organizationId, "bigquery");
            if (!cred) return "BigQuery is not configured. Add a BigQuery credential in Settings.";
            try {
                const { BigQuery } = await import("@google-cloud/bigquery");
                const bq = new BigQuery({
                    projectId: params.project_id || cred.project_id,
                    credentials: cred.service_account_key,
                });
                const [datasets] = await bq.getDatasets();
                return JSON.stringify(datasets.map((d: any) => ({ id: d.id, location: d.metadata?.location })), null, 2);
            } catch (err: any) {
                return `BigQuery list error: ${err.message}`;
            }
        },
    },

    snowflake_list_tables: {
        name: "snowflake_list_tables",

        idempotency: "read-safe",
        label: "List Snowflake Tables",
        group: "Analytics Databases",
        description: "List tables in a Snowflake database/schema to discover available data.",
        parameters: z.object({
            database: z.string().optional().describe("Snowflake database (overrides credential default)"),
            schema: z.string().optional().describe("Snowflake schema (overrides credential default)"),
        }),
        execute: async (params, context) => {
            const cred = await getAnalyticsCredential(context?.organizationId, "snowflake");
            if (!cred) return "Snowflake is not configured. Add a Snowflake credential in Settings.";
            try {
                const snowflake = await import("snowflake-sdk");
                const connection = snowflake.createConnection({
                    account: cred.account,
                    username: cred.username,
                    password: cred.password,
                    warehouse: cred.warehouse,
                    database: params.database || cred.database,
                    schema: params.schema || cred.schema,
                });
                await new Promise<void>((resolve, reject) => connection.connect((err: any) => err ? reject(err) : resolve()));
                const rows: any[] = await new Promise((resolve, reject) => {
                    connection.execute({
                        sqlText: "SHOW TABLES",
                        complete: (err: any, stmt: any, rows: any) => err ? reject(err) : resolve(rows || []),
                    });
                });
                await new Promise<void>((resolve) => connection.destroy(() => resolve()));
                return JSON.stringify(rows.map((r: any) => ({ name: r.name, schema: r.schema_name, database: r.database_name, rows: r.rows })), null, 2);
            } catch (err: any) {
                return `Snowflake list tables error: ${err.message}`;
            }
        },
    },
};
