import "dotenv/config";
import { db } from "../db/index.js";
import { jobs } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, 66)).limit(1);
  console.log("PROMPT:");
  console.log((job.config as any)?.systemPrompt || (job.config as any)?.prompt || "No prompt in config");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

