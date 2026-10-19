import { db } from "../database_service.js";
import { approvalRequests } from "../../shared/schema/hil.js";
import { eq } from "drizzle-orm";

async function main() {
    console.log("Updating approval request 963...");
    const result = await db.update(approvalRequests)
        .set({ organizationId: 291 })
        .where(eq(approvalRequests.id, 963));
    console.log("Update completed:", result);
}

main().catch(console.error);
