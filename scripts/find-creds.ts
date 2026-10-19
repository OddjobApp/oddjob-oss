// @ts-nocheck
import { db } from "../server/db/index.js";
import { credentials } from "../shared/schema/index.js";

async function findCreds() {
  console.log("--- Searching for Credentials ---");
  const creds = await db.select().from(credentials).limit(20);
  for (const c of creds) {
    console.log(`ID: ${c.id} | Name: ${c.name} | Type: ${c.type} | SecretPrefix: ${c.secret ? c.secret.substring(0, 5) + '...' : 'null'}`);
  }
  process.exit(0);
}

findCreds().catch(err => {
  console.error(err);
  process.exit(1);
});
