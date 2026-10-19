import { db } from "../../server/database_service.js";
import { sql } from "drizzle-orm";

async function checkApps() {
    try {
        console.log("Checking for duplicate Apps (Name/Slug)...");
        const apps = await db.execute(sql`
            SELECT name, slug, COUNT(*) 
            FROM apps 
            GROUP BY name, slug 
            HAVING COUNT(*) > 1;
        `);
        console.table(apps.rows);

        console.log("\nChecking 'apps' for PK constraint...");
        const constraints = await db.execute(sql`
            SELECT conname, contype, a.attname
            FROM pg_constraint c
            JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
            WHERE c.conrelid = 'apps'::regclass;
        `);
        console.table(constraints.rows);

        process.exit(0);
    } catch (err) {
        console.error("Failed to check apps:", err);
        process.exit(1);
    }
}

checkApps();
