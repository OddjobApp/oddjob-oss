
import { db } from "../../server/database_service.js";
import { jobCollections } from "../../shared/schema/index.js";
import { isNull, eq } from "drizzle-orm";

async function unifyCollections() {
    console.log("Unifying Job Collections into Organization 1...");
    
    const result = await db.update(jobCollections)
        .set({ organizationId: 1 })
        .where(isNull(jobCollections.organizationId));
    
    console.log(`Success! Updated ${result.rowCount} collections.`);
    process.exit(0);
}

unifyCollections().catch(err => {
    console.error(err);
    process.exit(1);
});
