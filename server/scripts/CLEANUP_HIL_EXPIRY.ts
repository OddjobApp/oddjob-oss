
import { approvalService } from "../domain/integrations/core/approval.service.js";
import { db } from "../../server/db/index.js";

async function runCleanup() {
    console.log("🚀 Starting manual HIL cleanup...");
    
    try {
        // We'll use the service's newly added internal helper
        if (typeof (approvalService as any)._cleanupExpiredRequests === 'function') {
            await (approvalService as any)._cleanupExpiredRequests();
            console.log("✅ Cleanup completed via ApprovalService helper.");
        } else {
            console.error("❌ Could not find _cleanupExpiredRequests on approvalService.");
        }
    } catch (err: any) {
        console.error("❌ Cleanup failed:", err.message);
    } finally {
        process.exit(0);
    }
}

runCleanup();

