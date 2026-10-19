// import { skillSynthesisService } from "@domain/agents/core/skill-synthesis.service.js";
import { createLogger } from "../server/utils/logger.js";

const logger = createLogger("TestSkillSynthesis");

async function runTest() {
    logger.info("Starting Skill Synthesis Test...");
    
    const url = "https://github.com/openai/skills";
    const orgId = 1;
    const userId = "1"; // Admin user

    // const result = await skillSynthesisService.ingestFromUrl(url, orgId, userId);
    // 
    // if (result.success) {
    //     if (result.hilId) {
    //         logger.info(`SUCCESS: HIL Request created for dependency installation. ID: ${result.hilId}`);
    //     } else if (result.skillId) {
    //         logger.info(`SUCCESS: Skill synthesized immediately. ID: ${result.skillId}`);
    //     }
    // } else {
    //     logger.error(`FAILED: ${result.error}`);
    // }
}

runTest().catch(console.error);
