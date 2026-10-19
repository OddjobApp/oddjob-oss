import { db } from "../server/db/index.js";
import { users, adminRoles } from "../shared/schema/auth.js";
import { eq } from "drizzle-orm";

async function checkAdminUser() {
    const [result] = await db.select()
        .from(users)
        .leftJoin(adminRoles, eq(adminRoles.userId, users.id))
        .where(eq(users.username, "admin"))
        .limit(1);

    if (result) {
        const { users: user, admin_roles: role } = result;
        console.log(`User: ${user.username}`);
        console.log(`ID: ${user.id}`);
        console.log(`DefaultOrgId: ${user.defaultOrgId}`);
        console.log(`Role: ${role?.role || 'none'}`);
    } else {
        console.log("Admin user not found");
    }
    process.exit(0);
}

checkAdminUser().catch(err => {
    console.error(err);
    process.exit(1);
});
