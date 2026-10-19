
import { forgeQueue } from '../../server/domain/apps/infrastructure/forge-queue.js';

async function main() {
  const jobId = "461880da-2b16-4ea5-9db3-1d0594c358cf";
  
  console.log("Checking Queue Stats...");
  const counts = await forgeQueue.getJobCounts();
  console.log("Job Counts:", JSON.stringify(counts, null, 2));
  
  const job = await forgeQueue.getJob(`forge-${jobId}`);
  if (job) {
    console.log(`Job forge-${jobId} found in BullMQ:`);
    console.log("State:", await job.getState());
    console.log("Data:", JSON.stringify(job.data, null, 2));
    console.log("Attempts Made:", job.attemptsMade);
    console.log("Failed Reason:", job.failedReason);
  } else {
    console.log(`Job forge-${jobId} NOT found in BullMQ.`);
  }

  const workers = await forgeQueue.getWorkers();
  console.log(`Active Workers: ${workers.length}`);
}

main().catch(console.error).finally(() => process.exit(0));
