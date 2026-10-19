import { agentService } from "../domain/agents/agent.service.js";

async function main() {
    console.log("Starting chat simulation...");
    try {
        const start = Date.now();
        const result = await agentService.chat({
            message: `Can you send me a deeplink to missions?`,
            context: {
                urlParams: {
                    assetId: "AST-001"
                },
                sessionId: "test-sim-session-12345"
            },
            userContext: {
                organizationId: 291,
                userId: "test-sim-user",
                isAdmin: false,
                isSuperAdmin: false,
                isOrgAdmin: false
            }
        });
        console.log(`Simulation finished in ${((Date.now() - start) / 1000).toFixed(2)}s`);
        console.log("Result:", JSON.stringify(result, null, 2));
    } catch (e: any) {
        console.error("Simulation failed:", e);
    }
}

main().catch(console.error).finally(() => process.exit(0));
