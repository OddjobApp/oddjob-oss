import { db } from '../database_service.js';
import { missionRuns, approvalRequests } from '../../shared/schema/index.js';
import { eq } from 'drizzle-orm';

async function check() {
  const runId = 76;
  try {
    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId));
    console.log(`\n--- Run ${runId} ---`);
    if (run) {
      console.log(`Status: ${run.status}`);
      console.log(`Resume Condition: ${JSON.stringify(run.resumeCondition, null, 2)}`);
      
      const condition = run.resumeCondition as any;
      if (condition && condition.type === 'human_approval' && condition.approvalRequestIds) {
        console.log(`\nFetching Approvals: ${condition.approvalRequestIds}`);
        for (const id of condition.approvalRequestIds) {
          const [appr] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id));
          if (appr) {
            console.log(`- [#${appr.id}] Status: ${appr.status}, Email: ${appr.approverEmail}`);
          }
        }
      } else {
        // Search by execution_id if possible
        console.log("\nSearching for approvals by executionId pattern...");
        const allApprovals = await db.select().from(approvalRequests).limit(20);
        allApprovals.forEach(a => {
           if (a.executionId.includes(runId.toString()) || (a as any).missionRunId === runId) {
             console.log(`- FOUND: [#${a.id}] execId: ${a.executionId}, status: ${a.status}`);
           }
        });
      }
    }
  } catch (err) {
    console.error('Debug failed:', err);
  }
  process.exit(0);
}

check();

