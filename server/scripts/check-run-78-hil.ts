import "dotenv/config";
import { db } from "@server/database_service.js";
import { missionRuns, approvalRequests, hilForms } from "@shared/schema/index.js";
import { eq, or } from "drizzle-orm";

async function main() {
  const runId = 78;
  const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, runId)).limit(1);
  if (!run) {
    console.error(`Run ${runId} not found`);
    return;
  }

  console.log(`Run 78 Status: ${run.status}`);
  console.log(`Resume Condition: ${JSON.stringify(run.resumeCondition, null, 2)}`);

  const approvals = await db.select().from(approvalRequests).where(eq(approvalRequests.missionId, run.missionId!));
  console.log(`Approvals for Mission ${run.missionId}:`, JSON.stringify(approvals, null, 2));

  const forms = await db.select().from(hilForms).where(eq(hilForms.organizationId, run.organizationId!));
  console.log(`HIL Forms for Mission ${run.missionId}:`, JSON.stringify(forms, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

