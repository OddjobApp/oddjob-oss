/**
 * Run SQL Migration Script
 * Usage: npx tsx scripts/run-migration.ts [migration-file.sql]
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { db } from "../server/db/index.js";
import { sql } from 'drizzle-orm';

// Split SQL into individual statements, handling functions/procedures correctly
function splitSqlStatements(sqlContent: string): string[] {
    const statements: string[] = [];
    let current = '';
    let inDollarQuote = false;
    let dollarTag = '';

    const lines = sqlContent.split('\n');

    for (const line of lines) {
        const trimmedLine = line.trim();

        // Skip empty lines and comments at statement boundaries
        if (!inDollarQuote && current === '' && (trimmedLine === '' || trimmedLine.startsWith('--'))) {
            continue;
        }

        current += line + '\n';

        // Check for dollar quoting (used in functions)
        const dollarMatch = line.match(/\$([a-zA-Z_]*)\$/g);
        if (dollarMatch) {
            for (const match of dollarMatch) {
                if (!inDollarQuote) {
                    inDollarQuote = true;
                    dollarTag = match;
                } else if (match === dollarTag) {
                    inDollarQuote = false;
                    dollarTag = '';
                }
            }
        }

        // End of statement (semicolon not inside dollar quote)
        if (!inDollarQuote && trimmedLine.endsWith(';')) {
            const stmt = current.trim();
            if (stmt && !stmt.startsWith('--')) {
                statements.push(stmt);
            }
            current = '';
        }
    }

    // Handle any remaining content
    if (current.trim()) {
        statements.push(current.trim());
    }

    return statements;
}

async function runMigration(filePath: string) {
    console.log(`\n=== Running migration: ${filePath} ===\n`);

    const sqlContent = readFileSync(filePath, 'utf-8');
    const statements = splitSqlStatements(sqlContent);

    console.log(`Found ${statements.length} statements to execute\n`);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        const preview = stmt.substring(0, 60).replace(/\n/g, ' ').trim();

        try {
            await db.execute(sql.raw(stmt));
            successCount++;
            console.log(`  [${i + 1}/${statements.length}] ✅ ${preview}...`);
        } catch (error: any) {
            errorCount++;
            // Some errors are OK (like "already exists")
            if (error.message.includes('already exists') ||
                error.message.includes('does not exist') ||
                error.message.includes('duplicate key')) {
                console.log(`  [${i + 1}/${statements.length}] ⚠️  ${preview}... (${error.message.split('\n')[0]})`);
            } else {
                console.log(`  [${i + 1}/${statements.length}] ❌ ${preview}...`);
                console.log(`      Error: ${error.message.split('\n')[0]}`);
            }
        }
    }

    console.log(`\n=== Migration summary: ${successCount} succeeded, ${errorCount} had issues ===`);
    return errorCount === 0;
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        // Run all reporting migrations in order
        const migrations = [
            'migrations/add_reporting_schema.sql',
            'migrations/add_materialized_kpi_views.sql',
            'migrations/add_forensic_log_partitioning.sql'
        ];

        console.log('Running all reporting schema migrations...\n');

        for (const migration of migrations) {
            await runMigration(migration);
        }

        console.log('\n✅ All migrations attempted!');
    } else {
        // Run specific migration
        await runMigration(args[0]);
    }

    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
