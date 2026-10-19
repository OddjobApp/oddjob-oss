
import "dotenv/config";
import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";

async function applyMigration() {
    const migrationPath = path.join(process.cwd(), "migrations", "0003_reporting_functions.sql");
    console.log(`Reading migration file: ${migrationPath}`);

    if (!fs.existsSync(migrationPath)) {
        console.error("Migration file not found!");
        process.exit(1);
    }

    const sqlContent = fs.readFileSync(migrationPath, "utf-8");
    const statements = sqlContent.split("--> statement-breakpoint");

    console.log(`Found ${statements.length} statements to execute.`);

    for (const statement of statements) {
        const trimmed = statement.trim();
        if (trimmed) {
            console.log(`Executing: ${trimmed.substring(0, 50)}...`);
            try {
                await db.execute(sql.raw(trimmed));
            } catch (err: any) {
                console.error("Error executing statement:", err.message);
                // Continue or exit?
                // If "relation already exists", we might want to skip.
                if (err.message.includes("already exists")) {
                    console.log("Skipping (already exists).");
                } else {
                    console.error("Critical error, aborting.");
                    process.exit(1);
                }
            }
        }
    }
    console.log("Migration applied successfully (with skips if any).");
}

applyMigration().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
