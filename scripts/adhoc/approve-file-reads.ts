import { db } from '../../server/database_service.js';
import { approvalRequests } from '../../shared/schema/index.js';
import { eq } from 'drizzle-orm';
import { decisionRouter } from '../../server/domain/governor/core/decision-router.js';

async function approveFileReads() {
    const pendings = await db.select().from(approvalRequests).where(eq(approvalRequests.status, 'pending'));
    console.log(`Found ${pendings.length} total pending requests.`);

    let approvedCount = 0;
    for (const p of pendings) {
        const modifiedOutput = p.modifiedOutput as any;
        const tool = modifiedOutput?.tool;
        const isFileRead = tool === 'file_read' || tool === 'view_file' || tool === 'read_file';
        
        if (isFileRead) {
            console.log(`Approving request ID: ${p.id}, Tool: ${tool}, ExecutionID: ${p.executionId}`);
            
            await db.update(approvalRequests)
                .set({
                    status: 'approved',
                    comments: `Auto-approved pending read tool: ${tool}`,
                    decisionAt: new Date()
                })
                .where(eq(approvalRequests.id, p.id));
                
            // Trigger Redis notification to wake up any active blocking wait loops
            await decisionRouter.notifyDecision(p.id);
            approvedCount++;
        }
    }
    console.log(`Successfully approved and notified ${approvedCount} pending file read requests.`);
}

approveFileReads()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
