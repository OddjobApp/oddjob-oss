import { db } from "../server/db/index.js";
import { credentials } from "../shared/schema/index.js";

async function findCred() {
  const creds = await db.select().from(credentials).limit(10);
  console.log(JSON.stringify(creds, null, 2));
  process.exit(0);
}

findCred().catch(err => {
  console.error(err);
  process.exit(1);
});
