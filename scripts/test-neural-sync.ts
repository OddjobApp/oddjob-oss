import { AdminService } from "../server/domain/admin/admin.service.js";
import { SentinelService } from "../server/domain/agents/core/sentinel.service.js";
import { autoresearchService } from "../server/domain/mission/core/autoresearch.service.js";
import { createLogger } from "../server/utils/logger.js";

const logger = createLogger("TestSync");

async function testSync() {
    console.log("--- NEURAL CORE SYNC TEST ---");
    
    const adminService = new AdminService();
    const orgId = 1; // Default org for testing

    try {
        console.log(`[Test] Triggering Sync for Org ${orgId}...`);
        const result = await adminService.syncNeuralCore(orgId);
        
        console.log("[Test] Result:", JSON.stringify(result, null, 2));
        
        if (result.candidatesTriggered > 0) {
            console.log("SUCCESS: Sync identified candidates and triggered evolution.");
        } else if (result.candidatesTriggered === 0) {
            console.log("PASS: Sync completed but no candidates met criteria (or already active).");
        } else {
            console.log("FAILURE: Sync returned unexpected result.");
        }
    } catch (err: any) {
        console.error("ERROR during sync test:", err.message);
        process.exit(1);
    }
}

testSync().then(() => {
    console.log("Test sequence complete.");
    process.exit(0);
});
