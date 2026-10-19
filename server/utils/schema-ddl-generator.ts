import pg from 'pg';
import { db } from "../database_service.js";
import { datasets as datasetsTable, datasetItems } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

export async function generatePostgresDdl(client: pg.Client | pg.PoolClient): Promise<string> {
    // 1. Fetch all tables in public schema
    const tablesRes = await client.query<{ table_name: string }>(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE'
        ORDER BY table_name;
    `);
    const tables = tablesRes.rows.map(r => r.table_name);

    if (tables.length === 0) return '';

    // 2. Fetch all columns in public schema
    const columnsRes = await client.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
        character_maximum_length: number | null;
    }>(`
        SELECT table_name, column_name, data_type, is_nullable, column_default, character_maximum_length
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position;
    `);

    // Group columns by table
    const columnsByTable: Record<string, typeof columnsRes.rows> = {};
    columnsRes.rows.forEach(col => {
        if (!columnsByTable[col.table_name]) {
            columnsByTable[col.table_name] = [];
        }
        columnsByTable[col.table_name].push(col);
    });

    // 3. Fetch primary keys
    const pkRes = await client.query<{ table_name: string; column_name: string }>(`
        SELECT 
            tc.table_name,
            kcu.column_name
        FROM 
            information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public';
    `);

    const pksByTable: Record<string, string[]> = {};
    pkRes.rows.forEach(r => {
        if (!pksByTable[r.table_name]) {
            pksByTable[r.table_name] = [];
        }
        pksByTable[r.table_name].push(r.column_name);
    });

    // 4. Fetch foreign keys
    const fkRes = await client.query<{
        constraint_name: string;
        source_table: string;
        source_column: string;
        target_table: string;
        target_column: string;
    }>(`
        SELECT
            tc.constraint_name,
            tc.table_name AS source_table, 
            kcu.column_name AS source_column, 
            ccu.table_name AS target_table,
            ccu.column_name AS target_column
        FROM 
            information_schema.table_constraints AS tc 
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';
    `);

    // Build the DDL script
    let ddl = '';

    // Write CREATE TABLE statements
    for (const table of tables) {
        const cols = columnsByTable[table] || [];
        const pks = pksByTable[table] || [];

        ddl += `CREATE TABLE ${table} (\n`;
        
        const colDefinitions = cols.map(col => {
            let def = `  ${col.column_name} ${col.data_type.toUpperCase()}`;
            if (col.character_maximum_length) {
                def += `(${col.character_maximum_length})`;
            }
            if (col.is_nullable === 'NO') {
                def += ' NOT NULL';
            }
            if (col.column_default) {
                let cleanedDefault = col.column_default;
                if (cleanedDefault.includes('::') && cleanedDefault.startsWith("'")) {
                    cleanedDefault = cleanedDefault.split('::')[0];
                }
                def += ` DEFAULT ${cleanedDefault}`;
            }
            return def;
        });

        if (pks.length > 0) {
            colDefinitions.push(`  PRIMARY KEY (${pks.join(', ')})`);
        }

        ddl += colDefinitions.join(',\n');
        ddl += `\n);\n\n`;
    }

    // Write ALTER TABLE ADD CONSTRAINT statements
    fkRes.rows.forEach(fk => {
        ddl += `ALTER TABLE ${fk.source_table} ADD CONSTRAINT ${fk.constraint_name} FOREIGN KEY (${fk.source_column}) REFERENCES ${fk.target_table} (${fk.target_column});\n`;
    });

    return ddl;
}

export async function generateMysqlDdl(connection: any): Promise<string> {
    const [tablesRows]: any[] = await connection.query('SHOW TABLES');
    if (!tablesRows || tablesRows.length === 0) return '';
    
    const key = Object.keys(tablesRows[0])[0];
    const tables: string[] = tablesRows.map((r: any) => r[key]);

    let ddl = '';
    for (const table of tables) {
        const [showCreateRow]: any[] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
        if (showCreateRow && showCreateRow[0]) {
            const createSql = showCreateRow[0]['Create Table'] || showCreateRow[0]['CREATE TABLE'];
            ddl += `${createSql};\n\n`;
        }
    }
    return ddl;
}

export async function generateDatasetsDdl(orgId: number): Promise<string> {
    const datasets = await db.select().from(datasetsTable).where(eq(datasetsTable.organizationId, orgId));
    if (datasets.length === 0) return '';

    let ddl = '';

    for (const ds of datasets) {
        const tableName = `dataset_${ds.name.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
        
        const items = await db.select().from(datasetItems)
            .where(eq(datasetItems.datasetId, ds.id))
            .limit(5);

        const columns: Record<string, string> = {};

        items.forEach(item => {
            const dataObj = item.data as Record<string, any>;
            if (dataObj && typeof dataObj === 'object') {
                Object.entries(dataObj).forEach(([key, val]) => {
                    const cleanKey = key.replace(/[^a-zA-Z0-9_]/g, '_');
                    if (columns[cleanKey]) return;
                    
                    if (typeof val === 'number') {
                        columns[cleanKey] = 'NUMERIC';
                    } else if (typeof val === 'boolean') {
                        columns[cleanKey] = 'BOOLEAN';
                    } else if (typeof val === 'string') {
                        const isDate = !isNaN(Date.parse(val)) && val.includes('-') && val.length > 8;
                        columns[cleanKey] = isDate ? 'TIMESTAMP' : 'VARCHAR(255)';
                    } else {
                        columns[cleanKey] = 'JSONB';
                    }
                });
            }
        });

        if (Object.keys(columns).length === 0) {
            columns['name'] = 'VARCHAR(255)';
            columns['value'] = 'TEXT';
        }

        ddl += `CREATE TABLE ${tableName} (\n`;
        ddl += `  id SERIAL PRIMARY KEY`;
        
        Object.entries(columns).forEach(([col, type]) => {
            ddl += `,\n  ${col} ${type}`;
        });
        
        ddl += `\n);\n\n`;
    }

    return ddl;
}
