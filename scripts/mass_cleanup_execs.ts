
import { db } from "../server/db/index.js";
import { pipelineExecutions, pipelineStepExecutions } from "../shared/schema/index";
import { eq, or, lt, isNull } from "drizzle-orm";

async function cleanup() {
  console.log("=== Mass Cleanup of Stale Executions ===");
  
  const now = new Date();
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

  // Find running executions started > 10 mins ago OR with no heartbeat > 10 mins ago
  const staleExecs = await db.select().from(pipelineExecutions).where(
    or(
      and(eq(pipelineExecutions.status, "running"), lt(pipelineExecutions.startedAt, tenMinutesAgo)),
      and(eq(pipelineExecutions.status, "running"), lt(pipelineExecutions.lastHeartbeat, tenMinutesAgo))
    )
  );

  console.log(`Found ${staleExecs.length} stale executions.`);

  for (const exec of staleExecs) {
    console.log(`Failing Execution ${exec.id} (Started: ${exec.startedAt})`);
    
    // Fail the execution
    await db.update(pipelineExecutions)
      .set({ 
        status: "failed", 
        completedAt: now, 
        error: "Mass cleanup of stale executions (deadlock prevention)" 
      })
      .where(eq(pipelineExecutions.id, exec.id));

    // Fail pending steps
    await db.update(pipelineStepExecutions)
      .set({ 
        status: "failure", 
        completedAt: now, 
        error: "Execution terminated by mass cleanup" 
      })
      .where(
        and(
          eq(pipelineStepExecutions.pipelineExecutionId, exec.id),
          eq(pipelineStepExecutions.status, "pending")
        )
      );
  }

  console.log("Cleanup complete.");
  process.exit(0);
}

// Help with and() import if drizzle-orm version is weird
import { and } from "drizzle-orm";

cleanup().catch(err => {
  console.error(err);
  process.exit(1);
});
