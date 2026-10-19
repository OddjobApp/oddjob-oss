import "dotenv/config";
import { errorRecoveryService } from "../domain/core/error-recovery.service.js";
import "../domain/org/core/event-handlers.js";

async function main() {
    console.log("[TEST] Both modules loaded without error");
    const id = errorRecoveryService.addToDeadLetterQueue(
        "APP_PROVISIONED",
        { appId: 73, organizationId: 257 },
        "simulated failure",
        257
    );
    console.log(`[TEST] DLQ entry added: ${id}`);
    console.log(`[TEST] DLQ stats: ${JSON.stringify(errorRecoveryService.getRetryStats())}`);
    process.exit(0);
}
main().catch(e => { console.error("[FAIL]", e.message); process.exit(1); });
