import { crewOrchestratorService } from "../domain/crew/core/crew-orchestrator.service.js";

async function main() {
    try {
        console.log("=== Debugging Crew Chat (Test 2) ===");
        const orgId = 1;

        const sessionKey = "test-crew-debug-" + Date.now();

        console.log("\n--- Sending: 'Open the Research & RFC Synthesis Portal' ---");
        const result1 = await crewOrchestratorService.runRound({
            orgId,
            sessionKey,
            message: "Open the Research & RFC Synthesis Portal",
        });

        console.log(`Turns returned: ${result1.turns.length}`);
        for (const t of result1.turns) {
            console.log(` - Turn [${t.speakerType}] ${t.speakerName}: "${t.content}" (tools: ${t.toolsUsed?.length}, artifacts: ${t.artifacts?.length})`);
            if (t.artifacts?.length) {
                console.log("   Artifacts:", JSON.stringify(t.artifacts, null, 2));
            }
        }

        console.log("\n--- Sending: 'Display an app' ---");
        const result2 = await crewOrchestratorService.runRound({
            orgId,
            sessionKey,
            message: "Display an app",
        });

        console.log(`Turns returned: ${result2.turns.length}`);
        for (const t of result2.turns) {
            console.log(` - Turn [${t.speakerType}] ${t.speakerName}: "${t.content}" (tools: ${t.toolsUsed?.length}, artifacts: ${t.artifacts?.length})`);
            if (t.artifacts?.length) {
                console.log("   Artifacts:", JSON.stringify(t.artifacts, null, 2));
            }
        }
    } catch (err) {
        console.error("CRITICAL ERROR IN RUNROUND:", err);
    }
    process.exit(0);
}

main();
