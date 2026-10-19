import dotenv from "dotenv";
dotenv.config();
import { describeMigrationError, redactDatabaseUrl, runMigrations } from "./migration-runner.js";

async function main() {
    if (!process.env.DATABASE_URL) {
        throw new Error("DATABASE_URL is not set");
    }
    const dbUrl = process.env.DATABASE_URL || '';
    console.log(`[Migration] Using connection string: ${redactDatabaseUrl(dbUrl)} (length: ${dbUrl.length})`);

    console.log("⏳ Running migrations...");
    const start = Date.now();
    try {
        await runMigrations(dbUrl);
        console.log(`✅ Migrations completed in ${Date.now() - start}ms`);
    } catch (err: any) {
        for (const line of describeMigrationError(err)) console.error(line);
        process.exit(1);
    }
}

main();
