import { db } from "../database_service.js";
import { approvalRequests } from "../../shared/schema/hil.js";
import { isNull, eq, and } from "drizzle-orm";

async function main() {
    const nullOrgs = await db.select()
        .from(approvalRequests)
        .where(and(
            eq(approvalRequests.status, "pending"),
            isNull(approvalRequests.organizationId)
        ));
    console.log("Pending approvals with null organizationId:", nullOrgs.length);
    for (const app of nullOrgs) {
        console.log(`Approval ID: ${app.id}, Execution ID: ${app.executionId}, Mission ID: ${app.missionId}`);
    }
}

main().catch(console.error);
