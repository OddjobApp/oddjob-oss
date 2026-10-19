import { MISSION_TOOLS } from "../server/domain/tools/v1/capabilities/missions.js";

async function run() {
    const missionId = 92;
    console.log(`Verifying get_blackboard pruning for Mission ${missionId}...`);

    // Context for tool execution
    const context = { missionId, userId: "verify-script" } as any;

    try {
        // 1. Test Default Retrieval (should prune)
        console.log("\n--- Testing Default Retrieval (Pruning Mode) ---");
        const defaultResult = await MISSION_TOOLS.get_blackboard.execute({ includeLarge: false }, context);
        console.log("Result length:", defaultResult.length);
        
        if (defaultResult.includes("[TRUNCATED:")) {
            console.log("✅ Success: Large keys were truncated.");
            // Log some truncated keys
            const parsed = JSON.parse(defaultResult);
            const truncated = Object.keys(parsed).filter(k => String(parsed[k]).includes("[TRUNCATED:"));
            console.log("Truncated keys found:", truncated.length);
            console.log("Sample truncated key:", truncated[0], "->", parsed[truncated[0]]);
        } else {
            console.warn("⚠️ Warning: No truncated keys found. (Maybe none were large enough?)");
        }

        // 2. Test Large Key Retrieval (explicit)
        console.log("\n--- Testing Specific Large Key Retrieval ---");
        // Get one of the truncated keys
        const parsed = JSON.parse(defaultResult);
        const largeKey = Object.keys(parsed).find(k => k.startsWith('tool_output_'));
        
        if (largeKey) {
            console.log(`Requesting full content for key: ${largeKey}`);
            const specificResult = await MISSION_TOOLS.get_blackboard.execute({ keys: [largeKey] }, context);
            const specificParsed = JSON.parse(specificResult);
            console.log(`✅ Received ${String(specificParsed[largeKey]).length} characters for ${largeKey}.`);
        } else {
            console.log("Skipping specific key test: No tool_output keys found.");
        }

    } catch (e: any) {
        console.error("❌ Verification failed:", e.message);
        process.exit(1);
    }
    process.exit(0);
}

run();
