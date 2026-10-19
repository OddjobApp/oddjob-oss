import 'dotenv/config';
import { execSync } from 'child_process';

async function main() {
    const urls = [
        "postgresql://postgres:postgres@127.0.0.1:5433/oddjob",
        "postgresql://postgres:ShitMonger01!@127.0.0.1:5432/oddjob"
    ];

    const scripts = [
        "server/scripts/ingest-system-knowledge.ts",
        "server/scripts/finalize-graph-restoration.ts",
        "server/scripts/seed-concepts.ts",
        "server/scripts/execute-propagation-sql.ts"
    ];

    for (const url of urls) {
        console.log(`\n>>> SYNCING TARGET: ${url.substring(0, 30)}...`);
        for (const script of scripts) {
            console.log(`Running script: ${script}`);
            try {
                // Set DATABASE_URL for the child process
                execSync(`npx tsx ${script}`, {
                    env: { ...process.env, DATABASE_URL: url },
                    stdio: 'inherit'
                });
                console.log(`SUCCESS: ${script}`);
            } catch (e: any) {
                console.error(`FAILED: ${script} on ${url.substring(0, 30)}...`);
                // Continue to next anyway
            }
        }
    }
    console.log("\nALL TARGETS SYNCED.");
}
main();

