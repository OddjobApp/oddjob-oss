
import { db } from "../server/db/index.js";
import { jobs } from "../shared/schema/index";
import { eq } from "drizzle-orm";

async function updateJob(jobId: number) {
  console.log(`=== Updating Job ${jobId} ===`);

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) {
    console.error("Job not found");
    return;
  }

  const newConfig = {
    ...(job.config as any),
    credentialId: 7
  };

  await db.update(jobs)
    .set({ config: newConfig })
    .where(eq(jobs.id, jobId));

  console.log(`Job ${jobId} updated successfully with credentialId: 7`);
  process.exit(0);
}

updateJob(210).catch(err => {
  console.error(err);
  process.exit(1);
});
