
import 'dotenv/config';
import { promptService } from "../domain/ai/core/prompt-service.js";

async function verifyPersonality() {
    console.log("Starting Personality Injection Verification...");

    const mockUserContext = {
        organizationId: 1,
        userId: "test-user",
        isAdmin: true,
        isSuperAdmin: false,
        isOrgAdmin: false
    };

    const hatIds = ['hat-pirate', 'hat-grad', 'hat-helmet', 'hat-crown'];

    for (const hatId of hatIds) {
        console.log(`\nTesting Hat: ${hatId}`);
        const mockContext = {
            branding: { iconId: hatId },
            page: "dashboard"
        };

        const { prompt: systemPrompt } = await promptService.buildSystemPrompt(
            mockContext,
            mockUserContext,
            [], // allowedTools
            'google',
            'gemini-1.5-flash'
        );

        if (systemPrompt.includes("IMPORTANT PERSONA:")) {
            console.log("✅ Personality Injected");
            // Find the persona string
            const personaMatch = systemPrompt.match(/IMPORTANT PERSONA: (.*)/);
            if (personaMatch) {
                console.log(`Prompt: ${personaMatch[1]}`);
            }
        } else {
            console.log("❌ Personality NOT Injected");
        }
    }
}

verifyPersonality().catch(console.error);

