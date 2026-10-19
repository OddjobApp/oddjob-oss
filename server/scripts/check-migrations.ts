
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sql } from "drizzle-orm";

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is not set");
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 1,
    });

    const db = drizzle(pool);

    console.log("🔍 Checking __drizzle_migrations table...");

    try {
        const result = await db.execute(sql`SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC`);
        console.log("Applied Migrations:");
        result.rows.forEach(r => {
            // The id usually corresponds to the migration file prefix or hash
            console.log(` - ${r.id} (at ${r.created_at})`);
        });
    } catch (err: any) {
        if (err.code === '42P01') {
            console.log("❌ __drizzle_migrations table does not exist. No migrations applied via Drizzle.");
        } else {
            console.error("❌ Failed to query migrations table");
            console.error(err);
        }
    } finally {
        await pool.end();
    }
}

main();

