import { db } from "@server/database_service.js";
import { approvalRequests, missionRuns, pipelineExecutions } from "@shared/schema/index.js";
import { eq, and, or, sql } from "drizzle-orm";
import { generateExternalToken } from "@domain/core/auth/jwt.service.js";

async function run() {
  const missionId = 33;
  const runId = 76;
  const adminEmail = 'admin@example.com';
  const adminId = '53e36eea-f2e6-4f46-ba81-9bdf0f26c964';

  console.log(`\n--- Reconciling Approvals for Mission ${missionId} Run ${runId} ---`);

  try {
    // 1. Find the run
    const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
    if (!run) {
      console.error(`Run ${runId} not found.`);
      process.exit(1);
    }
    console.log(`Run Status: ${run.status}, Resume Condition: ${run.resumeCondition}`);

    // 2. Check for existing approvals
    const existing = await db.select().from(approvalRequests).where(
      or(
        eq(approvalRequests.executionId, '76'),
        eq(approvalRequests.executionId, 'pipeline:76')
      )
    );
    console.log(`Found ${existing.length} existing requests.`);
    for (const req of existing) {
      console.log(`ID: ${req.id}, Email: ${req.approverEmail}, Status: ${req.status}, ExecID: ${req.executionId}`);
    }

    if (existing.length === 0 || existing.every(r => r.status !== 'pending')) {
      console.log('No pending requests found. Creating a new one...');
      
      const sessionId = 'pipeline:76';
      const proposalId = 'proposal-' + Date.now();
      
      const token = generateExternalToken({
        executionId: sessionId,
        email: adminEmail,
        role: 'internal',
        context: { sessionId, proposalId, command: 'Continue Mission' }
      });

      const [newReq] = await db.insert(approvalRequests).values({
        executionId: sessionId,
        jobId: 0,
        approverType: 'internal',
        approverId: adminId,
        approverEmail: adminEmail,
        organizationId: 1,
        status: 'pending',
        token,
        modifiedOutput: {
          moltSessionId: sessionId,
          proposalId,
          command: 'Continue Mission: Verified Policy Bounds',
          context: { missionId, runId }
        }
      }).returning();

      console.log(`Created new approval request ID: ${newReq.id}`);
    } else {
      console.log('Updating existing request...');
      const req = existing.find(r => r.status === 'pending') || existing[0];
      await db.update(approvalRequests)
        .set({ 
          approverEmail: adminEmail, 
          approverId: adminId,
          status: 'pending',
          executionId: 'pipeline:76'
        })
        .where(eq(approvalRequests.id, req.id));
      console.log(`Updated request ID: ${req.id}`);
    }

  } catch (err) {
    console.error('Failed:', err);
  }
  process.exit(0);
}

run();

