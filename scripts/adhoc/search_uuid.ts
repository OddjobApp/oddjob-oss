import { db } from "../../server/database_service.js";
import { sql } from "drizzle-orm";

async function search() {
    const uuid = "1d5f5df9-7850-4dab-a406-ceb34000ce87";
    console.log(`\n--- Searching for UUID: ${uuid} in all tables ---`);

    try {
        const tablesRes = await db.execute(sql`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        const tables = tablesRes.rows.map((r: any) => r.table_name);

        for (const table of tables) {
            // Find columns that are text/varchar/uuid
            const columnsRes = await db.execute(sql`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = ${table} 
                AND (data_type LIKE '%char%' OR data_type = 'text' OR data_type = 'uuid')
            `);
            const columns = columnsRes.rows.map((r: any) => r.column_name);

            if (columns.length === 0) continue;

            const whereClause = columns.map((c: any) => `"${c}"::text = '${uuid}'`).join(" OR ");
            const query = `SELECT * FROM "${table}" WHERE ${whereClause} LIMIT 1`;
            
            try {
                const results = await db.execute(sql.raw(query));
                if (results.rows.length > 0) {
                    console.log(`\n[MATCH FOUND] Table: ${table}`);
                    console.log(JSON.stringify(results.rows[0], null, 2));
                }
            } catch (err) {
                // Skip tables with issues
            }
        }
    } catch (err) {
        console.error("Search failed:", err);
    } finally {
        process.exit(0);
    }
}

search();
