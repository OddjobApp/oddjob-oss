import "dotenv/config";
import { db } from "../database_service.js";
import { errorDiagnoses } from "@shared/schema/index.js";
import { desc } from "drizzle-orm";

async function main() {
    console.log("Fetching recent errors from error_diagnoses...");
    const results = await db.select().from(errorDiagnoses).orderBy(desc(errorDiagnoses.createdAt)).limit(10);

    results.forEach((r, i) => {
        console.log(`--- Error ${i + 1} ---`);
        console.log(`ID: ${r.id}`);
        console.log(`Timestamp: ${r.createdAt}`);
        console.log(`Message: ${r.errorMessage}`);
        console.log(`HTTP Status: ${r.httpStatus}`);
        console.log(`AI Diagnosis: ${JSON.stringify(r.aiDiagnosis, null, 2)}`);
        console.log(`--------------------\n`);
    });
}

main().catch(console.error);

