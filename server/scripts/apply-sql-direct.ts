import 'dotenv/config';
import pg from 'pg';
import fs from 'fs';
import path from 'path';

async function main() {
    const sqlFile = process.argv[2];
    if (!sqlFile) {
        console.error("Usage: npx tsx apply-sql-direct.ts <path-to-sql-file>");
        process.exit(1);
    }

    const absolutePath = path.resolve(sqlFile);
    if (!fs.existsSync(absolutePath)) {
        console.error(`File not found: ${absolutePath}`);
        process.exit(1);
    }

    const sql = fs.readFileSync(absolutePath, 'utf8');
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    try {
        console.log(`Applying SQL from ${absolutePath}...`);
        // We split by semicolon to execute separate statements if needed, 
        // but PG client can often handle multiple statements.
        // For safety with complex migrations, we'll try it as one block first.
        await pool.query(sql);
        console.log("SQL applied successfully!");
    } catch (e: any) {
        console.error("Failed to apply SQL:", e.message);
        process.exit(1);
    } finally {
        await pool.end();
        process.exit(0);
    }
}

main();

