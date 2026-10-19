
import { db } from "../server/database_service.js";
import { users } from "../shared/schema/index.js";

async function main() {
    const allUsers = await db.select().from(users);
    console.log('USERS:', JSON.stringify(allUsers, null, 2));
    process.exit(0);
}

main().catch(console.error);
