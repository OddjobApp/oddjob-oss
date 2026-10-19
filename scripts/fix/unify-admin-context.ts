
import { db } from "../../server/database_service.js";
import { users, adminRoles } from "../../shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function unifyAdmin() {
    console.log("Starting Identity Stabilization...");
    
    const adminEmail = "admin@example.com";
    const targetOrgId = 1;

    // 1. Find the admin user
    const [user] = await db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
    
    if (!user) {
        console.error(`User ${adminEmail} not found!`);
        process.exit(1);
    }

    console.log(`Found User: ${user.id}`);

    // 2. Set DefaultOrgId
    await db.update(users)
        .set({ defaultOrgId: targetOrgId })
        .where(eq(users.id, user.id));
    
    console.log(`Set DefaultOrgId to ${targetOrgId} for ${adminEmail}`);

    // 3. Ensure AdminRole exists for Org 1
    const [existingRole] = await db.select()
        .from(adminRoles)
        .where(and(
            eq(adminRoles.userId, user.id),
            eq(adminRoles.organizationId, targetOrgId)
        ))
        .limit(1);

    // 4. Update Admin Roles/Metadata
    console.log("Setting Admin role to super_admin...");
    await db.insert(adminRoles).values({
        organizationId: 1,
        userId: user.id,
        role: "super_admin",
        permissions: ["*"]
    } as any).onConflictDoUpdate({
        target: [adminRoles.userId, adminRoles.organizationId],
        set: { role: "super_admin", permissions: ["*"] } as any
    });

    console.log(`Ensured super_admin role for ${adminEmail} in Org ${targetOrgId}`);

    console.log("Identity Stabilization Complete.");
    process.exit(0);
}

unifyAdmin().catch(err => {
    console.error(err);
    process.exit(1);
});
