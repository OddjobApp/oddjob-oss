
import { Job, Pipeline, SqlQueryConfig, DatabaseMetadata, Credential } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { credentialsService } from "../../../auth/core/credentials-service.js";
import { CredentialNotFoundError, AppError, ErrorCode, NotFoundError } from "@server/utils/errors.js";
import pg from 'pg';
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";
const { Client } = pg;

export class SqlExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "sql_query";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as SqlQueryConfig;
        let credential;
        try {
            credential = await credentialsService.getForExecution(config.credentialId, pipeline.organizationId);
        } catch (err) {
            if (err instanceof NotFoundError) throw new CredentialNotFoundError(config.credentialId);
            throw err;
        }

        const metadata = credential.metadata as DatabaseMetadata;
        const engine = metadata.engine || 'postgres';
        const password = (await resolveCredentialSecret(credential));

        if (!password) throw new AppError("Database password not found in environment", 500, ErrorCode.INTERNAL_ERROR);

        switch (engine) {
            case 'postgres':
                return this.executePostgres(config, metadata, password);
            case 'mysql':
                return this.executeMysql(config, metadata, password);
            case 'mssql':
                return this.executeMssql(config, metadata, password);
            case 'snowflake':
                return this.executeSnowflake(config, metadata, password);
            default:
                throw new AppError(`Unsupported database engine: ${engine}`, 400, ErrorCode.INVALID_INPUT);
        }
    }

    // New Inspection Method
    async inspectSchema(credential: Credential): Promise<{ tables: { name: string, columns?: string[] }[] }> {
        const metadata = credential.metadata as DatabaseMetadata;
        const engine = metadata.engine || 'postgres';
        const password = (await resolveCredentialSecret(credential));
        if (!password) throw new Error("Database password not found");

        if (engine === 'postgres') {
            const client = new Client({
                host: metadata.host,
                port: metadata.port,
                database: metadata.database,
                user: metadata.user,
                password: password,
                ssl: metadata.ssl ?? false
            });
            await client.connect();
            try {
                // Fetch tables
                const res = await client.query(`
                    SELECT table_name 
                    FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                      AND table_type = 'BASE TABLE'
                    ORDER BY table_name;
                `);

                const tables = res.rows.map(r => ({ name: r.table_name }));

                // Fetch columns for these tables (simplified)
                // We could iterate but that's slow. fetch all cols.
                const colsRes = await client.query(`
                    SELECT table_name, column_name, data_type
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                    ORDER BY table_name, ordinal_position;
                `);

                // Merge
                const colsByTable: Record<string, string[]> = {};
                colsRes.rows.forEach(r => {
                    if (!colsByTable[r.table_name]) colsByTable[r.table_name] = [];
                    colsByTable[r.table_name].push(r.column_name);
                });

                return {
                    tables: tables.map(t => ({
                        name: t.name,
                        columns: colsByTable[t.name] || []
                    }))
                };
            } finally {
                await client.end();
            }
        }

        if (engine === 'mysql') {
            const mysql = await import('mysql2/promise');
            const connection = await mysql.createConnection({
                host: metadata.host,
                port: metadata.port,
                user: metadata.user,
                password: password,
                database: metadata.database,
                ssl: metadata.ssl ? { rejectUnauthorized: false } : undefined
            });
            try {
                const [rows]: any[] = await connection.execute(`
                    SELECT table_name, column_name 
                    FROM information_schema.columns 
                    WHERE table_schema = ? 
                    ORDER BY table_name, ordinal_position
                `, [metadata.database]);

                const tableMap: Record<string, string[]> = {};
                rows.forEach((r: any) => {
                    const t = r.table_name || r.TABLE_NAME;
                    const c = r.column_name || r.COLUMN_NAME;
                    if (!tableMap[t]) tableMap[t] = [];
                    tableMap[t].push(c);
                });

                return {
                    tables: Object.entries(tableMap).map(([name, columns]) => ({ name, columns }))
                };
            } finally {
                await connection.end();
            }
        }

        // Implement MSSQL and Snowflake similarly if needed, or return empty
        if (engine === 'mssql') {
            // simplified
            return { tables: [] };
        }

        return { tables: [] };
    }


    private prepareQuery(query: string, parameters: Record<string, string> | undefined, dialect: 'postgres' | 'mysql' | 'mssql' | 'snowflake'): { text: string, values: any } {
        if (!parameters || Object.keys(parameters).length === 0) {
            return { text: query, values: dialect === 'mssql' ? {} : [] };
        }

        let text = query;

        if (dialect === 'postgres') {
            const values: any[] = [];
            const paramToIndex: Record<string, number> = {};
            let i = 1;

            text = text.replace(/([^:]|^):([a-zA-Z0-9_]+)/g, (match, prefix, name) => {
                if (parameters[name] === undefined) return match;

                if (!paramToIndex[name]) {
                    paramToIndex[name] = i++;
                    values.push(parameters[name]);
                }
                return `${prefix}$${paramToIndex[name]}`;
            });
            return { text, values };
        }

        if (dialect === 'mysql') {
            const values: any[] = [];

            text = text.replace(/([^:]|^):([a-zA-Z0-9_]+)/g, (match, prefix, name) => {
                if (parameters[name] === undefined) return match;
                values.push(parameters[name]);
                return `${prefix}?`;
            });
            return { text, values };
        }

        if (dialect === 'mssql') {
            const values: Record<string, any> = {};
            text = text.replace(/([^:]|^):([a-zA-Z0-9_]+)/g, (match, prefix, name) => {
                if (parameters[name] === undefined) return match;
                values[name] = parameters[name];
                return `${prefix}@${name}`;
            });
            return { text, values };
        }

        if (dialect === 'snowflake') {
            const values: any[] = [];
            text = text.replace(/([^:]|^):([a-zA-Z0-9_]+)/g, (match, prefix, name) => {
                if (parameters[name] === undefined) return match;
                values.push(parameters[name]);
                return `${prefix}?`;
            });
            return { text, values };
        }

        return { text: query, values: [] };
    }

    private async executePostgres(config: SqlQueryConfig, metadata: DatabaseMetadata, password: string): Promise<StepExecutionResult> {
        const client = new Client({
            host: metadata.host,
            port: metadata.port,
            database: metadata.database,
            user: metadata.user,
            password: password,
            ssl: metadata.ssl ?? false
        });

        const { text, values } = this.prepareQuery(config.query, config.parameters, 'postgres');

        await client.connect();
        try {
            const res = await client.query(text, values as any[]);
            return {
                success: true,
                output: JSON.stringify(res.rows, null, 2),
                status: "success"
            };
        } finally {
            await client.end();
        }
    }

    private async executeMysql(config: SqlQueryConfig, metadata: DatabaseMetadata, password: string): Promise<StepExecutionResult> {
        const mysql = await import('mysql2/promise');
        const connection = await mysql.createConnection({
            host: metadata.host,
            port: metadata.port,
            user: metadata.user,
            password: password,
            database: metadata.database,
            ssl: metadata.ssl ? { rejectUnauthorized: false } : undefined
        });

        const { text, values } = this.prepareQuery(config.query, config.parameters, 'mysql');

        try {
            const [rows] = await connection.execute(text, values as any[]);
            return {
                success: true,
                output: JSON.stringify(rows, null, 2),
                status: "success"
            };
        } finally {
            await connection.end();
        }
    }

    private async executeMssql(config: SqlQueryConfig, metadata: DatabaseMetadata, password: string): Promise<StepExecutionResult> {
        const mssql = await import('mssql');

        const sqlConfig = {
            user: metadata.user,
            password: password,
            database: metadata.database,
            server: metadata.host,
            port: metadata.port,
            options: {
                encrypt: metadata.ssl ?? true,
                trustServerCertificate: true
            }
        };

        const { text, values } = this.prepareQuery(config.query, config.parameters, 'mssql');

        const pool = await mssql.connect(sqlConfig);
        try {
            const request = pool.request();
            const valRecord = values as Record<string, any>;
            for (const [key, val] of Object.entries(valRecord)) {
                request.input(key, val);
            }

            const result = await request.query(text);
            return {
                success: true,
                output: JSON.stringify(result.recordset, null, 2),
                status: "success"
            };
        } finally {
            await pool.close();
        }
    }

    private async executeSnowflake(config: SqlQueryConfig, metadata: DatabaseMetadata, password: string): Promise<StepExecutionResult> {
        const snowflake = await import('snowflake-sdk');

        const connection = snowflake.createConnection({
            account: metadata.host,
            username: metadata.user,
            password: password,
            database: metadata.database,
        });

        const { text, values } = this.prepareQuery(config.query, config.parameters, 'snowflake');

        await new Promise<void>((resolve, reject) => {
            connection.connect((err: any, conn: any) => {
                if (err) reject(err);
                else resolve();
            });
        });

        try {
            const rows = await new Promise<any[]>((resolve, reject) => {
                connection.execute({
                    sqlText: text,
                    binds: values as any[],
                    complete: (err: any, stmt: any, rows: any) => {
                        if (err) reject(err);
                        else resolve(rows || []);
                    }
                });
            });

            return {
                success: true,
                output: JSON.stringify(rows, null, 2),
                status: "success"
            };
        } finally {
            // Snowflake uses sync destroy usually?
        }
    }
}


