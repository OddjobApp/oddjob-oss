/**
 * Update organization mission concurrency limit
 *
 * Usage: tsx scripts/update-org-concurrency.ts <orgId> <concurrencyLimit>
 * Example: tsx scripts/update-org-concurrency.ts 1 5
 */

import { db } from "@server/database_service.js";
import { orgSettings } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function updateConcurrency() {
    const orgId = Number(process.argv[2]);
    const concurrencyLimit = Number(process.argv[3]);

    if (!orgId || !concurrencyLimit) {
        console.error("Usage: tsx scripts/update-org-concurrency.ts <orgId> <concurrencyLimit>");
        console.error("Example: tsx scripts/update-org-concurrency.ts 1 5");
        process.exit(1);
    }

    if (isNaN(orgId) || isNaN(concurrencyLimit)) {
        console.error("Error: Both orgId and concurrencyLimit must be numbers");
        process.exit(1);
    }

    if (concurrencyLimit < 1) {
        console.error("Error: concurrencyLimit must be at least 1");
        process.exit(1);
    }

    try {
        console.log(`Updating Org ${orgId} concurrency limit to ${concurrencyLimit}...`);

        const [existing] = await db
            .select()
            .from(orgSettings)
            .where(eq(orgSettings.organizationId, orgId))
            .limit(1);

        if (!existing) {
            console.error(`Error: Organization ${orgId} not found`);
            process.exit(1);
        }

        const [updated] = await db
            .update(orgSettings)
            .set({
                missionConcurrency: concurrencyLimit,
                updatedAt: new Date(),
            })
            .where(eq(orgSettings.organizationId, orgId))
            .returning();

        const { deploymentProfileService } = await import("@domain/ai/core/deployment-profile.service.js");
        await deploymentProfileService.invalidate(orgId);

        console.log(`✅ Successfully updated Org ${orgId}`);
        console.log(`   missionConcurrency: ${existing.missionConcurrency} → ${updated.missionConcurrency}`);
        process.exit(0);
    } catch (error) {
        console.error("Error updating organization settings:", error);
        process.exit(1);
    }
}

updateConcurrency();
