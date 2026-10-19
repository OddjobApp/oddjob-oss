import { db } from "@server/database_service.js";
import { sql } from "drizzle-orm";

async function main() {
    const args = process.argv.slice(2);
    const query = args[0] || '91';
    
    console.log(`Searching for "${query}"...`);
    const tables = ['missions', 'mission_runs', 'jobs', 'agent_run_steps'];
    
    for (const table of tables) {
        try {
            const isId = !isNaN(parseInt(query));
            let sqlQuery;
            if (isId) {
                sqlQuery = sql.raw(`SELECT * FROM ${table} WHERE id = ${parseInt(query)}`);
            } else {
                sqlQuery = sql.raw(`SELECT * FROM ${table} WHERE name ILIKE '%${query}%'`);
            }
            
            const result = await db.execute(sqlQuery);
            if (result.rows.length > 0) {
                console.log(`Found ${result.rows.length} record(s) in table ${table}:`);
                result.rows.forEach(r => console.log(JSON.stringify(r, null, 2)));
            } else {
                console.log(`Not found in table ${table}`);
            }
        } catch (e) {
            console.error(`Error searching table ${table}:`, (e as any).message);
        }
    }
}

main().catch(console.error).finally(() => process.exit(0));

