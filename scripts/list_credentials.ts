
import { db } from "../server/db/index.js";
import { credentials } from "../shared/schema/index";

async function list() {
  const allCredentials = await db.select().from(credentials);
  console.log("=== All Credentials ===");
  console.table(allCredentials.map(c => ({
    id: c.id,
    name: c.name,
    type: c.type,
    envVarName: c.envVarName
  })));
  process.exit(0);
}

list().catch(err => {
  console.error(err);
  process.exit(1);
});
