
import { db } from "../server/database_service.js";
import { userPlatformIdentities } from "../shared/schema/index.js";

async function main() {
    const identities = await db.select().from(userPlatformIdentities);
    console.log('IDENTITIES:', JSON.stringify(identities, null, 2));
    process.exit(0);
}

main().catch(console.error);
