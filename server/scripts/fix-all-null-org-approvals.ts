import { db } from "../database_service.js";
import { approvalRequests } from "../../shared/schema/hil.js";
import { missions } from "../../shared/schema/missions/core.js";
import { isNull, eq, and } from "drizzle-orm";

async function main() {
    const nullOrgs = await db.select({
        approvalId: approvalRequests.id,
        missionId: approvalRequests.missionId,
        executionId: approvalRequests.executionId
    })
        .from(approvalRequests)
        .where(and(
            eq(approvalRequests.status, "pending"),
            isNull(approvalRequests.organizationId)
        ));

    console.log(`Found ${nullOrgs.length} pending approvals with null organizationId.`);

    let updatedCount = 0;
    for (const app of nullOrgs) {
        if (!app.missionId) {
            // If there's no missionId, let's see if we can default it or look it up.
            // But let's check if we can set it to 291 or another org.
            console.log(`Approval ID ${app.approvalId} has no missionId.`);
            continue;
        }

        const [mission] = await db.select({
            organizationId: missions.organizationId
        })
            .from(missions)
            .where(eq(missions.id, app.missionId))
            .limit(1);

        if (mission && mission.organizationId) {
            await db.update(approvalRequests)
                .set({ organizationId: mission.organizationId })
                .where(eq(approvalRequests.id, app.approvalId));
            console.log(`Updated Approval ID ${app.approvalId} (Mission ID ${app.missionId}) to Organization ID ${mission.organizationId}`);
            updatedCount++;
        } else {
            console.log(`Approval ID ${app.approvalId} has mission ${app.missionId} but no organizationId on the mission.`);
            // If the mission has no organizationId, let's default to 291 or check if we should set it.
            // Actually, let's check what org it should be.
        }
    }
    console.log(`Completed fixing null organizationIds. Total updated: ${updatedCount}`);
}

main().catch(console.error);
