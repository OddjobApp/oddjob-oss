import "dotenv/config";
import { db } from "../db/index.js";
import { jobs } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, 66)).limit(1);
  console.log("CONFIG:");
  console.log(JSON.stringify(job.config, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

