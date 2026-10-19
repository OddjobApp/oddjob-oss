import "dotenv/config";
import { db } from "../database_service.js";
import { sql } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    console.log("Starting manual migration...");
    const migrationPath = path.resolve(__dirname, "../../migrations/0008_wet_shocker.sql");
    const content = fs.readFileSync(migrationPath, "utf-8");
    const statements = content.split("--> statement-breakpoint");

    for (const stmt of statements) {
        const trimmed = stmt.trim();
        if (trimmed) {
            console.log("Executing:", trimmed.substring(0, 50) + "...");
            try {
                await db.execute(sql.raw(trimmed));
                console.log("Success.");
            } catch (e: any) {
                // Ignore "relation already exists" errors
                if (e.code === '42P07' || e.message.includes("already exists")) {
                    console.log("Skipping (already exists).");
                } else {
                    console.error("Error executing statement:", e);
                    throw e;
                }
            }
        }
    }
    console.log("Migration complete.");
}

main().catch(console.error).finally(() => process.exit(0));

