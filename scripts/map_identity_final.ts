
import { db } from "../server/database_service.js";
import { userPlatformIdentities, users } from "../shared/schema/index.js";
import { eq, and } from "drizzle-orm";

async function main() {
    const internalUserId = "a4633e43-4be0-4844-bcc0-aec618eaccf4";
    const slackUserId = "U0AEAMWHRHS";
    const orgId = 1;

    console.log(`Mapping Slack User ${slackUserId} to Oddjob User ${internalUserId}...`);

    // Check if mapping already exists
    const [existing] = await db.select()
        .from(userPlatformIdentities)
        .where(and(
            eq(userPlatformIdentities.platform, 'slack'),
            eq(userPlatformIdentities.platformUserId, slackUserId)
        ))
        .limit(1);

    if (existing) {
        console.log("Mapping already exists. Updating internal user ID...");
        await db.update(userPlatformIdentities)
            .set({ 
                userId: internalUserId,
                organizationId: orgId,
                updatedAt: new Date()
            })
            .where(eq(userPlatformIdentities.id, existing.id));
    } else {
        console.log("Creating new mapping...");
        await db.insert(userPlatformIdentities).values({
            userId: internalUserId,
            organizationId: orgId,
            platform: 'slack',
            platformUserId: slackUserId,
        } as any);
    }

    console.log("✅ Identity Mapping Complete!");
    process.exit(0);
}

main().catch(console.error);
