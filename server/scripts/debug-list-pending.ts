import { db } from '../database_service.js';
import { approvalRequests, pipelineStepExecutions, pipelineExecutions, pipelines, jobs } from '../../shared/schema/index.js';
import { eq, and, or, sql } from 'drizzle-orm';

async function debug() {
  const userId = '1'; // Assuming admin is 1
  const userEmail = 'admin@example.com';

  console.log(`\n--- Debugging listPending for ${userEmail} ---`);

  try {
    const allRequests = await db.select().from(approvalRequests).where(eq(approvalRequests.id, 40));
    console.log('Record 40:', JSON.stringify(allRequests, null, 2));

    const query = db
      .select({
        id: approvalRequests.id,
        executionId: approvalRequests.executionId,
        approverEmail: approvalRequests.approverEmail,
        status: approvalRequests.status,
        stepStatus: pipelineStepExecutions.status,
      })
      .from(approvalRequests)
      .leftJoin(
        pipelineStepExecutions,
        sql`CASE 
            WHEN ${approvalRequests.executionId} ~ '^[0-9]+$' THEN CAST(${approvalRequests.executionId} AS INTEGER)
            ELSE -1 
        END = ${pipelineStepExecutions.id}`
      )
      .where(
        and(
          eq(approvalRequests.id, 40),
          or(
            eq(approvalRequests.approverEmail, userEmail)
          ),
          eq(approvalRequests.status, "pending")
        )
      );

    const res = await query;
    console.log('Query Result (simple):', JSON.stringify(res, null, 2));

    const fullQuery = db
      .select({
        id: approvalRequests.id,
      })
      .from(approvalRequests)
      .leftJoin(pipelineStepExecutions, sql`CASE WHEN ${approvalRequests.executionId} ~ '^[0-9]+$' THEN CAST(${approvalRequests.executionId} AS INTEGER) ELSE -1 END = ${pipelineStepExecutions.id}`)
      .where(
        and(
          eq(approvalRequests.id, 40),
          or(
            eq(approvalRequests.approverEmail, userEmail)
          ),
          eq(approvalRequests.status, "pending"),
          or(
            eq(pipelineStepExecutions.status, "waiting_external_input"),
            sql`${approvalRequests.executionId} LIKE 'pipeline:%'`,
            sql`${approvalRequests.executionId} LIKE 'session:%'`
          )
        )
      );
    
    const fullRes = await fullQuery;
    console.log('Query Result (full):', JSON.stringify(fullRes, null, 2));

  } catch (err) {
    console.error('Debug failed:', err);
  }
  process.exit(0);
}

debug();

