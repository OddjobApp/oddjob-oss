import "dotenv/config";
import { errorRecoveryService } from "../../server/domain/core/error-recovery.service.js";

async function main() {
    console.log("─── DLQ retry smoke test ───\n");

    // Test 1: APP_PROVISIONED retry (valid appId + orgId should succeed)
    const id1 = errorRecoveryService.addToDeadLetterQueue(
        "APP_PROVISIONED",
        { appId: 73, organizationId: 257 },
        "simulated original failure",
        257
    );
    console.log(`[Test 1] Added APP_PROVISIONED entry: ${id1}`);

    // Test 2: APP_PROVISIONED retry with missing appId (should leave in queue)
    const id2 = errorRecoveryService.addToDeadLetterQueue(
        "APP_PROVISIONED",
        { organizationId: 257 },
        "simulated original failure",
        257
    );
    console.log(`[Test 2] Added incomplete APP_PROVISIONED entry: ${id2}`);

    // Test 3: BLUEPRINT_INSTALLED retry with valid slug
    const id3 = errorRecoveryService.addToDeadLetterQueue(
        "BLUEPRINT_INSTALLED",
        { appSlug: "hybrid-sdlc", organizationId: 257 },
        "simulated original failure",
        257
    );
    console.log(`[Test 3] Added BLUEPRINT_INSTALLED entry: ${id3}`);

    console.log(`\nBefore retry: ${JSON.stringify(errorRecoveryService.getRetryStats())}`);

    // Force a retry cycle by calling the private method via reflection
    console.log("\nTriggering retry cycle...");
    await (errorRecoveryService as any).processDeadLetterQueue();
    await new Promise(r => setTimeout(r, 1500));

    const after = errorRecoveryService.getRetryStats();
    console.log(`\nAfter retry: ${JSON.stringify(after)}`);

    // Expect:
    // - id1 succeeded → removed from DLQ
    // - id2 failed (missing appId) → retryCount bumped (still in DLQ)
    // - id3 may have failed if org 257 is in odd state but cleanupFailedInstall runs
    const remaining = after.deadLetterQueueSize;
    console.log(`\nRemaining entries: ${remaining} (expected: 1 or 2, depending on org 257 install state)`);
    process.exit(0);
}
main().catch(e => { console.error("[FAIL]", e.message); process.exit(1); });
