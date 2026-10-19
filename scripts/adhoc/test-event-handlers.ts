import "dotenv/config";
import { registerCrossAppEventHandlers } from "../../server/domain/org/core/event-handlers.js";
import { crossAppEventBus, CrossAppEventType } from "../../server/domain/org/core/event-bus.service.js";
registerCrossAppEventHandlers();
import { db } from "../../server/database_service.js";
import { forensicEventLog } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";

async function main() {
    const ORG = 2;
    // Clean prior cross_app events for this org so we get a clean count
    await db.delete(forensicEventLog).where(and(
        eq(forensicEventLog.organizationId, ORG),
        sql`job_type LIKE 'cross_app:%'`
    ));

    // Publish a representative event for each handler type
    const events = [
        { type: CrossAppEventType.TEST_FAILED, payload: { testName: "auth.test.ts", requirementId: "REQ-101", severity: "high" } },
        { type: CrossAppEventType.STORY_BLOCKED, payload: { storyId: "STORY-42", agentId: "ai-backend-dev", reason: "missing API" } },
        { type: CrossAppEventType.AGENT_PIP_TRIGGERED, payload: { agentId: "ai-qa-engineer", reason: "3 thrashing incidents" } },
        { type: CrossAppEventType.BLOCKER_ESCALATED, payload: { blockerId: "BLK-99", ageMinutes: 240, escalatedTo: "lead@x.io" } },
        { type: CrossAppEventType.SPRINT_VELOCITY_CHANGED, payload: { sprintId: "SP-7", previousVelocity: 40, velocity: 28 } },
        { type: CrossAppEventType.DEPLOYMENT_FAILED, payload: { deploymentId: "DEP-100", environment: "production", rootCause: "DB conn" } },
        { type: CrossAppEventType.REQUIREMENT_UPDATED, payload: { requirementId: "REQ-202", changeType: "major" } },
        { type: CrossAppEventType.STORY_MOVED, payload: { storyId: "STORY-43", previousStatus: "in_progress", newStatus: "in_qa" } },
        { type: CrossAppEventType.DEPLOYMENT_COMPLETED, payload: { deploymentId: "DEP-101", environment: "production", durationMinutes: 8 } },
        { type: CrossAppEventType.AGENT_TOKEN_BUDGET_EXCEEDED, payload: { agentId: "ai-ux-designer", budgetUsd: 50, spentUsd: 67 } },
        { type: CrossAppEventType.FLAKY_TEST_DETECTED, payload: { testName: "smoke.spec.ts", failureRate: 0.35 } },
        { type: CrossAppEventType.BUDGET_EXCEEDED, payload: { amount: 1500, budget: 1000 } },
        { type: CrossAppEventType.SPRINT_COMPLETED, payload: { sprintId: "SP-7", completedPoints: 35, plannedPoints: 40 } },
    ];

    for (const e of events) {
        await crossAppEventBus.publish({
            type: e.type as any,
            organizationId: ORG,
            sourceApp: "test_harness",
            payload: e.payload,
        });
    }

    // Allow any async handlers to flush
    await new Promise(r => setTimeout(r, 1000));

    const recorded = await db.select({
        jobType: forensicEventLog.jobType,
        status: forensicEventLog.status,
        attrs: forensicEventLog.attributes,
    }).from(forensicEventLog).where(and(
        eq(forensicEventLog.organizationId, ORG),
        sql`job_type LIKE 'cross_app:%'`
    ));

    console.log(`\nPublished: ${events.length} events`);
    console.log(`Recorded:  ${recorded.length} forensic rows`);
    const byEvent: Record<string, number> = {};
    recorded.forEach(r => {
        const wb = (r.attrs as any)?.workbench ?? "?";
        const key = `${(r.jobType ?? "").replace("cross_app:", "")} [${wb}]`;
        byEvent[key] = (byEvent[key] ?? 0) + 1;
    });
    Object.entries(byEvent).sort().forEach(([k, n]) => console.log(`  ${n}× ${k}`));

    const pass = recorded.length >= events.length;
    console.log(`\n${pass ? "✅ PASS" : "❌ FAIL"} — handlers wrote ${recorded.length}/${events.length}+ entries (some events have multiple handlers)`);
    process.exit(pass ? 0 : 1);
}
main().catch(e => { console.error("[FAIL]", e.message); process.exit(1); });
