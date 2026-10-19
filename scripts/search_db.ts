
import 'dotenv/config';
import { db } from "../server/db/index.js";
import { sql } from 'drizzle-orm';

async function search() {
    console.log('Starting simplified database search for "gemini-pro"...');
    try {
        const res = await db.execute(sql`SELECT * FROM credentials WHERE CAST(metadata AS TEXT) ILIKE '%gemini-pro%'`);
        if ((res as any).rows?.length > 0) {
            console.log('\n[FOUND] in credentials metadata:');
            console.dir((res as any).rows, { depth: null });
        }
    } catch (e: any) {
        console.error('Credentials check failed:', e.message);
    }

    try {
        const res = await db.execute(sql`SELECT * FROM system_settings WHERE CAST(settings_data AS TEXT) ILIKE '%gemini-pro%'`);
        if ((res as any).rows?.length > 0) {
            console.log('\n[FOUND] in system_settings:');
            console.dir((res as any).rows, { depth: null });
        }
    } catch (e: any) {
        console.error('System settings check failed:', e.message);
    }

    try {
        const res = await db.execute(sql`SELECT * FROM graph_schema_defs WHERE CAST(mappings AS TEXT) ILIKE '%gemini-pro%'`);
        if ((res as any).rows?.length > 0) {
            console.log('\n[FOUND] in graph_schema_defs:');
            console.dir((res as any).rows, { depth: null });
        }
    } catch (e: any) {
        console.error('Graph schema defs check failed:', e.message);
    }

    console.log('\nSearch complete.');
}

search().catch(console.error).finally(() => process.exit(0));
