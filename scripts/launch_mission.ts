
import { missionService } from "../server/domain/mission/core/mission.service.js";
import { createLogger } from "../server/utils/logger.js";
import { db } from "../server/database_service.js";
import { users, orgs } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

const logger = createLogger("MissionLauncher");

async function launch() {
    const args = process.argv.slice(2);
    const name = args[args.indexOf("--name") + 1];
    const objective = args[args.indexOf("--objective") + 1];
    let strategy = args[args.indexOf("--strategy") + 1] || "pre_planned";
    
    // Strategy mapping
    if (strategy === "dynamic") strategy = "dynamic_autonomous";
    if (strategy === "rolling") strategy = "rolling_wave";

    logger.info(`Starting mission: ${name} with strategy: ${strategy}`);

    // Get a default user and org for the mission
    const [user] = await db.select().from(users).limit(1);
    const [org] = await db.select().from(orgs).limit(1);

    if (!user || !org) {
        throw new Error("No user or organization found in database.");
    }

    const mission = await missionService.createMission({
        name,
        objective,
        executionStrategy: strategy as any,
        organizationId: org.id,
        createdBy: user.id,
        type: "collaborative",
        blackboard: {}
    }, user.id, []);

    logger.info(`Mission created with ID: ${mission.id}`);

    const result = await missionService.launchMission(mission.id, user.id, org.id);

    if (result.success) {
        logger.info(`✅ Mission launched successfully. Run ID: ${(result as any).missionRunId}`);
        process.exit(0);
    } else {
        logger.error(`❌ Mission launch failed: ${result.error}`);
        process.exit(1);
    }
}

launch().catch(err => {
    console.error(err);
    process.exit(1);
});
