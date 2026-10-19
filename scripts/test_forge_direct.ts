import { appForgeService } from "../server/domain/apps/app-forge.service.js";

async function runDirectTest() {
    console.log("--- Starting Direct Forge Test (Synchronous) ---");
    
    try {
        const result = await appForgeService.forgeAppInternal('spa', {
            name: "Direct Test App",
            slug: "test-direct-app-" + Math.floor(Math.random() * 10000),
            description: "Business Intelligence Dashboard with Glassmorphic UI, sidebar navigation, and 3 key data widgets (Sales, Traffic, Conversion).",
            organizationId: 1,
            oddjobMissionId: 0
        });
        console.log("Forge Result:", JSON.stringify(result, null, 2));
    } catch (err: any) {
        console.error("Forge Failed:", err.message);
        console.error(err.stack);
    }
    process.exit(0);
}

runDirectTest();
