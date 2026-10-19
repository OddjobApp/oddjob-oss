
import { db } from "../server/database_service.js";
import { users } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    const user = await db.select().from(users).where(eq(users.username, 'admin@example.com')).limit(1);
    console.log('USER_INFO:', JSON.stringify(user));
    process.exit(0);
}

main().catch(console.error);
