import { db } from "../server/database_service.js";
import { orgs } from "@shared/schema/index.js";
import { orgForgeService } from "../server/domain/org/core/org-forge.service.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { eq } from "drizzle-orm";
import { resolveAndExecuteJob } from "../server/core/pipeline-step-runner.js";
import { SeleniumConfig } from "@shared/schema/index.js";
import { jobExecutorRegistry } from "../server/domain/jobs/core/executors/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function verifyApps() {
    try {
        console.log("== 0. Registering Job Executors ==");
        await (jobExecutorRegistry as any).autoRegister();
        console.log("== 1. Seeding SDLC YAML ==");
        
        // Use TECHHEAD6 org
        const orgName = "TECHHEAD6";
        let [org] = await db.select().from(orgs).where(eq(orgs.name, orgName)).limit(1);
        
        if (!org) {
            console.log("Creating fresh org...");
            [org] = await db.insert(orgs).values({ name: orgName }).returning();
        }

        const yamlPath = path.resolve(__dirname, "../server/cycles/hybrid-sdlc.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");

        console.log(`Installing Cycle App via Org Forge into Org ${org.id}...`);
        const installResult = await orgForgeService.installCycleApp(org.id, yamlContent);
        
        console.log("Provisioned Apps:");
        if ('installedApp' in installResult) {
            console.log(installResult.appsProvisioned);
        } else {
            console.log("(validation-only result, no install data)");
        }

        console.log("\n== 2. Verifying Apps via Selenium Executor ==");
        
        // Define the app slugs to check
        const apps = [
            "pm-workbench",
            "scrum-master-workbench",
            "qa-workbench",
            "stakeholder-workbench",
            "ai-workforce-dashboard"
        ];
        
        for (const appSlug of apps) {
            console.log(`\nVerifying app: ${appSlug}`);
            // The URL structure for the rendered apps. Usually /app/:slug or /apps/:slug.
            // Let's try both or just /app/:slug
            const url = `http://localhost:5000/app/${appSlug}`;
            
            // Create a fake job config
            const config = {
                mode: "local",
                browserType: "chromium",
                headless: true,
                timeout: 30000,
                steps: [
                    { action: "goto", value: url, optional: false },
                    // Wait a second for React to render
                    { action: "wait", waitMs: 2000, optional: false },
                    // Extract the text of the body to verify it loaded
                    { action: "extract", selector: "body", extractAs: "bodyText", format: "text", optional: false },
                    // Take a screenshot
                    { action: "screenshot", extractAs: "screenshot", optional: false }
                ]
            } as any as SeleniumConfig;
            
            const fakeJob = {
                id: 9999,
                name: `Verify ${appSlug}`,
                type: "selenium",
                config: config as any,
                organizationId: org.id,
                createdBy: "system",
                isActive: true
            };
            
            try {
                const result = await resolveAndExecuteJob(
                    fakeJob as any,
                    { id: 9999, organizationId: org.id, createdBy: "system" } as any,
                    { variables: {} } as any,
                    1
                );
                
                if (result.success) {
                    console.log(`✅ ${appSlug} verified successfully!`);
                    const output = JSON.parse(result.output);
                    const text = output.extracted?.bodyText?.substring(0, 100).replace(/\s+/g, ' ');
                    console.log(`Preview: "${text}..."`);
                } else {
                    console.log(`❌ ${appSlug} verification failed:`, result.error);
                }
            } catch (err) {
                 console.log(`❌ ${appSlug} verification threw:`, err);
            }
        }
        
        process.exit(0);
    } catch (e) {
        console.error("Script failed:", e);
        process.exit(1);
    }
}

verifyApps();
