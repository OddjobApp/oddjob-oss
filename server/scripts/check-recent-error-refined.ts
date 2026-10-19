
import "dotenv/config";
import { db } from "../database_service.js";
import { errorDiagnoses } from "@shared/schema/index.js";
import { desc } from "drizzle-orm";

async function main() {
    const [lastError] = await db.select().from(errorDiagnoses).orderBy(desc(errorDiagnoses.createdAt)).limit(1);
    if (!lastError) {
        console.log("No errors found.");
        return;
    }
    console.log("--- LATEST ERROR ---");
    console.dir(lastError, { depth: null });
}

main().catch(console.error);

