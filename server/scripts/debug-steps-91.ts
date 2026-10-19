import { db } from "../db/index.js";
import { agentRunSteps } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function debugSteps() {
  const steps = await db.select().from(agentRunSteps).where(eq(agentRunSteps.jobId, 91));
  console.log(JSON.stringify(steps, null, 2));
}

debugSteps().catch(console.error);

