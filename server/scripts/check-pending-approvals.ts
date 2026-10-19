import { db } from "../database_service.js";
import { approvalRequests } from "../../shared/schema/index.js";
import { desc } from "drizzle-orm";

async function main() {
    console.log("Fetching latest approval requests...");
    const approvals = await db.select()
        .from(approvalRequests)
        .orderBy(desc(approvalRequests.id))
        .limit(10);

    console.log(`\n--- Latest Approvals (${approvals.length}) ---`);
    for (const app of approvals) {
        console.log(`ID: ${app.id}, OrgID: ${app.organizationId}, executionId: ${app.executionId}, status: ${app.status}, approverEmail: ${app.approverEmail}, approverId: ${app.approverId}`);
        console.log(`Created: ${app.createdAt}, DecisionAt: ${app.decisionAt}`);
        console.log(`ModifiedOutput keys: ${app.modifiedOutput ? Object.keys(app.modifiedOutput as object).join(", ") : "null"}`);
        console.log("---------------------------------------");
    }
    process.exit(0);
}

main().catch(err => {
    console.error("Error:", err);
    process.exit(1);
});
