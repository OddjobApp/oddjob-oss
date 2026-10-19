
import "dotenv/config";
import { missionService } from "../domain/mission/core/mission.service.js";
import { db } from "../database_service.js";

async function resume() {
    try {
        const missionId = 69;
        const message = "Status verification. Please proceed.";

        console.log(`[Script] Updating Blackboard for Mission ${missionId}...`);

        await missionService.updateBlackboard(
            missionId,
            {
                lastUserGuidance: {
                    content: message,
                    timestamp: new Date().toISOString()
                }
            },
            "system-script",
            "manual_resume_test"
        );

        console.log("[Script] Blackboard updated. This should have triggered resumePipelineExecution.");

    } catch (e) {
        console.error("Error:", e);
    } finally {
        process.exit(0);
    }
}

resume();

