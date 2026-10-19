/**
 * Live smoke test for web push delivery bookkeeping and marketplace reviews,
 * against the configured DATABASE_URL. Creates its own rows and deletes them.
 *
 *   npx tsx server/scripts/smoke-push-and-reviews.ts
 *
 * Push: inserts a subscription pointing at an unreachable endpoint and a pending
 * approval for the same user, then runs the real sweep. The approval must be
 * selected, claimed exactly once (a second sweep sends nothing), and the dead
 * endpoint must be counted as a failure rather than crash the sweep.
 *
 * Reviews: a member of an org that installed the app can review it; a member of
 * another org cannot, even when they name the installing org.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { approvalRequests, appDeployments, userOrgs } from "@shared/schema/index.js";
import { pushDeliveries, pushSubscriptions } from "@shared/schema/push.js";
import { appReviews } from "@shared/schema/app-reviews.js";
import { selectApprovalsToPush, sweepApprovalPushes } from "@server/domain/core/notifications/push-approval-sweep.js";
import { appReviewsService } from "@server/domain/apps/core/app-reviews.service.js";

function check(label: string, ok: boolean, detail?: unknown) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ""}`);
    if (!ok) process.exitCode = 1;
}

async function smokePush() {
    const [member] = await db.select().from(userOrgs).limit(1);
    if (!member) throw new Error("No user_orgs row to test with");
    const endpoint = `https://push.invalid/smoke-${randomUUID()}`;
    let approvalId: number | undefined;
    try {
        await db.insert(pushSubscriptions).values({
            userId: member.userId, organizationId: member.orgId, endpoint, p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg",
        });
        const [approval] = await db.insert(approvalRequests).values({
            executionId: `smoke-push-${randomUUID()}`,
            approverType: "internal",
            approverId: member.userId,
            approverEmail: "smoke@push.invalid",
            token: randomUUID(),
            status: "pending",
            toolName: "smoke_push_tool",
            organizationId: member.orgId,
        } as any).returning({ id: approvalRequests.id });
        approvalId = approval.id;

        const due = await selectApprovalsToPush();
        const mine = due.find((d) => d.id === approvalId);
        check("sweep selects a new approval whose approver has a subscription", !!mine && mine.recipientId === member.userId);

        const first = await sweepApprovalPushes();
        const second = await sweepApprovalPushes();
        const claims = await db.select().from(pushDeliveries)
            .where(and(eq(pushDeliveries.source, "approval"), eq(pushDeliveries.sourceId, String(approvalId))));
        check("first sweep claims it, second sweep does not resend", first >= 1 && claims.length === 1 && second === 0, { first, second, claims: claims.length });

        const [sub] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
        check("an unreachable endpoint is counted as a failure, not a crash", !!sub && sub.failureCount >= 1, { failureCount: sub?.failureCount });

        const again = await selectApprovalsToPush();
        check("a delivered approval is no longer selected", !again.some((d) => d.id === approvalId));
    } finally {
        if (approvalId !== undefined) {
            await db.delete(pushDeliveries).where(and(eq(pushDeliveries.source, "approval"), eq(pushDeliveries.sourceId, String(approvalId))));
            await db.delete(approvalRequests).where(eq(approvalRequests.id, approvalId));
        }
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    }
}

async function smokeReviews() {
    const [install] = await db
        .select({ appId: appDeployments.appId, orgId: appDeployments.organizationId, userId: userOrgs.userId })
        .from(appDeployments)
        .innerJoin(userOrgs, eq(userOrgs.orgId, appDeployments.organizationId))
        .limit(1);
    if (!install) throw new Error("No installed app with a member to test with");
    const [outsider] = await db.select().from(userOrgs)
        .where(sql`${userOrgs.orgId} <> ${install.orgId} AND NOT EXISTS (
            SELECT 1 FROM user_orgs x WHERE x.user_id = ${userOrgs.userId} AND x.org_id = ${install.orgId})`)
        .limit(1);

    const [existing] = await db.select({ id: appReviews.id }).from(appReviews)
        .where(and(eq(appReviews.appId, install.appId), eq(appReviews.userId, install.userId)));
    if (existing) {
        console.log("SKIP  reviews: this user already has a real review of this app; not touching it");
        return;
    }
    try {
        check("a member of the installing org may review", await appReviewsService.canReview(install.appId, install.userId, install.orgId));
        await appReviewsService.upsert(install.appId, install.userId, install.orgId, { rating: 4, comment: "smoke" });
        await appReviewsService.upsert(install.appId, install.userId, install.orgId, { rating: 5, comment: "smoke 2" });
        const summary = (await appReviewsService.summaries([install.appId])).get(install.appId);
        const rows = await db.select().from(appReviews)
            .where(and(eq(appReviews.appId, install.appId), eq(appReviews.userId, install.userId)));
        check("a second review from the same person replaces the first", rows.length === 1 && rows[0].rating === 5, { summary });

        if (outsider) {
            let refused = false;
            try {
                await appReviewsService.upsert(install.appId, outsider.userId, install.orgId, { rating: 1 });
            } catch {
                refused = true;
            }
            check("someone outside the org cannot review by naming it", refused);
        }
    } finally {
        await appReviewsService.remove(install.appId, install.userId);
    }
}

async function main() {
    await smokePush();
    await smokeReviews();
    process.exit(process.exitCode ?? 0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
