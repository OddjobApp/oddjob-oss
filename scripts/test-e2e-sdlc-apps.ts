import { db } from "../server/database_service.js";
import { orgs } from "@shared/schema/index.js";
import { orgForgeService } from "../server/domain/org/core/org-forge.service.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { eq } from "drizzle-orm";
import { resolveAndExecuteJob } from "../server/core/pipeline-step-runner.js";
import { SeleniumConfig } from "@shared/schema/index.js";
import { startRollingForgeWorker } from "../server/domain/apps/infrastructure/forge-queue.js";
import { jobExecutorRegistry } from "../server/domain/jobs/core/executors/index.js";

// Skip deep AI generation to avoid local LLM timeouts
process.env.E2E_FAST_MOCK = 'true';

startRollingForgeWorker();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function pollUrlUntilReady(url: string, maxAttempts = 300, intervalMs = 2000): Promise<{ready: boolean, elapsedMs: number}> {
    process.stdout.write(`Waiting for ${url} to boot...`);
    const startTime = Date.now();
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
            if (res.ok) {
                const text = await res.text();
                // If it's the offline error, keep polling
                if (!text.includes("All instances are currently offline") && !text.includes("App or Deployment not found")) {
                    const elapsedMs = Date.now() - startTime;
                    console.log(`\n✅ ${url} is ready in ${(elapsedMs / 1000).toFixed(1)}s!`);
                    return { ready: true, elapsedMs };
                }
            }
        } catch {
            // Connection refused or timeout, keep polling
        }
        process.stdout.write(".");
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    const elapsedMs = Date.now() - startTime;
    console.log(`\n❌ Timeout waiting for ${url} after ${(elapsedMs / 1000).toFixed(1)}s`);
    return { ready: false, elapsedMs };
}

async function verifyApps() {
    try {
        console.log("== 0. Registering Job Executors ==");
        await (jobExecutorRegistry as any).autoRegister();
        console.log("== 1. Seeding SDLC YAML ==");
        
        // Use a unique E2E org
        const orgName = `E2E-SDLC-${Date.now()}`;
        console.log(`Creating fresh org: ${orgName}...`);
        const [org] = await db.insert(orgs).values({ name: orgName }).returning();

        const yamlPath = path.resolve(__dirname, "../server/cycles/hybrid-sdlc.cycle.yaml");
        const yamlContent = await fs.readFile(yamlPath, "utf-8");

        console.log(`Installing Cycle App via Org Forge into Org ${org.id}...`);
        const installResult = await orgForgeService.installCycleApp(org.id, yamlContent);
        
        console.log("Provisioned Apps:");
        if (installResult && 'appsProvisioned' in installResult) {
            console.log(installResult.appsProvisioned);
        } else {
            console.log("No apps provisioned or install failed");
        }

        console.log("\n== 2. Waiting for Forge Containers to Boot ==");
        const appsToTest = [
            { slug: "pm-workbench", goal: "Navigate the workbench, draft a PRD for a new authentication feature, and submit the sign-off." },
            { slug: "scrum-master-workbench", goal: "Review the current sprint metrics, identify any blockers, and adjust the capacity plan accordingly." },
            { slug: "qa-workbench", goal: "Analyze the test coverage report, find any flaky tests, and verify the critical path." },
            { slug: "stakeholder-workbench", goal: "Review pending ITIL changes, calculate the ROI, and approve the release." },
            { slug: "ai-workforce-dashboard", goal: "Check the AI agent success rates, token budget, and trigger a PIP for any underperforming agents." }
        ];

        // Wait for all apps to boot before testing
        let totalSpinupMs = 0;
        for (const app of appsToTest) {
            const url = `http://localhost:5000/app/${app.slug}`;
            const { ready, elapsedMs } = await pollUrlUntilReady(url);
            if (!ready) {
                console.error(`App ${app.slug} failed to boot. Aborting tests.`);
                process.exit(1);
            }
            totalSpinupMs += elapsedMs;
        }
        console.log(`\nAll apps booted successfully in ${(totalSpinupMs / 1000).toFixed(1)}s total spin-up time!`);

        console.log("\n== 3. Executing E2E Selenium Auto-Pilot Tests ==");
        
        for (const app of appsToTest) {
            console.log(`\nTesting app: ${app.slug}`);
            const url = `http://localhost:5000/app/${app.slug}`;
            
            // Create a fake job config using Auto-Pilot mode!
            const config = {
                mode: "auto_pilot",
                startUrl: url,
                goal: app.goal
            } as any as SeleniumConfig;
            
            const fakeJob = {
                id: Math.floor(Math.random() * 1000000),
                name: `E2E ${app.slug}`,
                type: "selenium",
                config: config as any,
                organizationId: org.id,
                createdBy: "system",
                isActive: true
            };
            
            try {
                console.log(`Launching Auto-Pilot: "${app.goal}"...`);
                const result = await resolveAndExecuteJob(
                    fakeJob as any,
                    { id: 9999, organizationId: org.id, createdBy: "system" } as any,
                    { variables: {} } as any,
                    1
                );
                
                if (result.success) {
                    console.log(`✅ ${app.slug} E2E completed successfully!`);
                    const output = JSON.parse(result.output);
                    console.log(`Steps taken by AI: ${output.steps?.length || 0}`);
                    if (output.extracted) {
                        console.log(`Data Extracted:\n${JSON.stringify(output.extracted, null, 2).substring(0, 500)}...`);
                    }
                } else {
                    console.log(`❌ ${app.slug} E2E failed:`, result.error);
                }
            } catch (err) {
                 console.log(`❌ ${app.slug} E2E threw:`, err);
            }
        }
        
        process.exit(0);
    } catch (e) {
        console.error("Script failed:", e);
        process.exit(1);
    }
}

verifyApps();
