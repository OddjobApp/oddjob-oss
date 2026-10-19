
import 'dotenv/config';
import { db } from "../server/db/index.js";
import { jobs } from "@shared/schema";
import { eq, or } from "drizzle-orm";

async function main() {
    const results = await db.select().from(jobs).where(or(eq(jobs.id, 18), eq(jobs.id, 20)));

    const job18 = results.find(j => j.id === 18);
    const job20 = results.find(j => j.id === 20);

    if (!job18) console.log("Job 18 missing");
    if (!job20) console.log("Job 20 missing");

    if (job18 && job20) {
        console.log("=== Job 18 (Reference) ===");
        console.log(JSON.stringify(job18.config, null, 2));
        console.log("\n=== Job 20 (Target) ===");
        console.log(JSON.stringify(job20.config, null, 2));

        // Deep compare key fields
        const c18 = job18.config as any;
        const c20 = job20.config as any;

        console.log("\n=== Comparison ===");
        console.log(`Methods: 18=${c18.method}, 20=${c20.method}`);
        console.log(`URL 18 matches Relative: ${c18.url.startsWith('/')}`);
        console.log(`URL 20 matches Relative: ${c20.url.startsWith('/')}`);
        console.log(`CredentialIDs MATCH: ${c18.credentialId === c20.credentialId}`);
    }
    process.exit(0);
}

main();
