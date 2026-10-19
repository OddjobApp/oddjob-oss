import { db } from "../../server/database_service.js";
import { errorDiagnoses } from "../../shared/schema/index.js";
import { desc, like } from "drizzle-orm";

async function checkDetails() {
    try {
        const jobId = "225661fc-6e3c-4cda-bd32-15793a3525d1";
        console.log(`--- Error Diagnoses for job ${jobId} ---`);
        const result = await db.select().from(errorDiagnoses).where(like(errorDiagnoses.errorMessage, `%${jobId}%`)).orderBy(desc(errorDiagnoses.createdAt)).limit(5);
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkDetails();
