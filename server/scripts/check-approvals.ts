import "dotenv/config";
import { db } from "../db/index.js";
import { approvalRequests, pipelineExecutions } from "../../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function main() {
  const missionId = 33;
  
  console.log("Fetching Executions...");
  const execs = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.missionId, missionId)).limit(5);
  console.log("Executions found:", execs.length);

  console.log("Fetching Approvals...");
  const approvals = await db.select().from(approvalRequests).where(eq(approvalRequests.status, "pending")).limit(5);
  console.log("Approvals found:", approvals.length);
  if (approvals.length > 0) {
      console.log("Latest Approval:", JSON.stringify(approvals[0], null, 2));
  }
}

main().catch(err => {
  console.error("DEBUG ERROR:");
  console.error(err);
  process.exit(1);
});

