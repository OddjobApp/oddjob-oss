import { appForgeService } from "../server/domain/apps/app-forge.service.js";

async function runSequentialTest() {
    console.log("--- Starting Sequential Forge Test ---");
    
    const appsToForge = [
        {
            name: "Test SPA App",
            slug: "test-spa-app-" + Math.floor(Math.random() * 100000),
            blueprint: "spa",
            description: "A simple single page application for testing forge stability. Includes a home page, an about page, and a contact form."
        },
        {
            name: "Test Analytics App",
            slug: "test-analytics-app-" + Math.floor(Math.random() * 100000),
            blueprint: "analytics-dashboard",
            description: "A simple analytics dashboard with charts and tables showing dummy performance data."
        }
    ];

    for (const app of appsToForge) {
        console.log(`\n[Test] Queuing forge for ${app.name} (${app.slug})...`);
        try {
            const result = await appForgeService.forgeApp(app.blueprint, {
                name: app.name,
                slug: app.slug,
                description: app.description,
                organizationId: 1,
                oddjobMissionId: 0
            });
            console.log(`[Test] Successfully queued ${app.name}. Job ID: ${result.jobId}`);
        } catch (err: any) {
            console.error(`[Test] Failed to queue ${app.name}: ${err.message}`);
        }
    }

    console.log("\n--- Sequential Test Initialization Complete ---");
    console.log("Monitor the server logs to verify sequential execution and build success.");
    process.exit(0);
}

runSequentialTest();
