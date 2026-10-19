import { db } from '../../server/database_service.js';
import { approvalRequests } from '../../shared/schema/index.js';
import { eq } from 'drizzle-orm';

async function checkPendingApprovals() {
    const pendings = await db.select().from(approvalRequests).where(eq(approvalRequests.status, 'pending'));
    console.log("=== PENDING APPROVAL REQUESTS ===");
    for (const p of pendings) {
        console.log(`ID: ${p.id}, JobID: ${p.jobId}, ExecutionID: ${p.executionId}, Status: ${p.status}`);
        console.log(`ModifiedOutput:`, JSON.stringify(p.modifiedOutput, null, 2));
        console.log("---");
    }
}

checkPendingApprovals().catch(console.error);
