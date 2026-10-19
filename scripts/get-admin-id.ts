
import { db } from "../server/db/index.js";
import { users } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function getAdminId() {
    const [admin] = await db.select().from(users).where(eq(users.username, "admin")).limit(1);
    console.log(admin?.id);
    process.exit(0);
}

getAdminId().catch(err => {
    console.error(err);
    process.exit(1);
});
