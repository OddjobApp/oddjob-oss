
import 'dotenv/config';
import { db } from "../server/db/index.js";
import { orgs } from "../shared/schema/index";

async function main() {
    console.log("Existing organizations:");
    const allOrgs = await db.select().from(orgs);
    console.log(JSON.stringify(allOrgs, null, 2));
    process.exit(0);
}

main().catch(console.error);
