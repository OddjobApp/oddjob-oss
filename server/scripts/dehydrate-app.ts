import { db } from "../database_service.js";
import { apps, appDeployments } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function dehydrateApp() {
    const appIdStr = process.argv[2];
    if (!appIdStr) {
        console.error("Usage: npx tsx server/scripts/dehydrate-app.ts <appId>");
        process.exit(1);
    }

    const appId = parseInt(appIdStr, 10);
    if (isNaN(appId)) {
        console.error("Invalid appId");
        process.exit(1);
    }

    console.log(`Dehydrating App Forge App ID: ${appId}`);

    try {
        const [app] = await db.select().from(apps).where(eq(apps.id, appId));
        if (!app) {
            console.error(`App with ID ${appId} not found.`);
            process.exit(1);
        }

        const [deployment] = await db.select().from(appDeployments).where(eq(appDeployments.appId, appId));

        // Scrub specific IDs and sensitive data
        const scrubbedApp = { ...app } as any;
        delete scrubbedApp.id;
        delete scrubbedApp.organizationId;
        delete scrubbedApp.developerOrgId;
        delete scrubbedApp.createdAt;
        delete scrubbedApp.updatedAt;
        delete scrubbedApp.oddjobMissionId; // will be resolved via template

        const scrubbedDeployment = deployment ? { ...deployment } as any : null;
        if (scrubbedDeployment) {
            delete scrubbedDeployment.id;
            delete scrubbedDeployment.appId;
            delete scrubbedDeployment.organizationId;
            delete scrubbedDeployment.installedAt;
            delete scrubbedDeployment.updatedAt;
            delete scrubbedDeployment.expertiseJobId;
            delete scrubbedDeployment.oddjobMissionId;
            delete scrubbedDeployment.nextPipelineId;
            delete scrubbedDeployment.appTokenHash;
            delete scrubbedDeployment.appTokenEncrypted;
            delete scrubbedDeployment.accessPasswordHash;
        }

        const dehydratedPayload = {
            id: scrubbedApp.slug,
            name: scrubbedApp.name,
            app: scrubbedApp,
            deployment: scrubbedDeployment
        };

        const jsonContent = JSON.stringify(dehydratedPayload, null, 2);
        
        // Write to output file
        const outputPath = path.resolve(__dirname, `../../storage/dehydrated-apps/${scrubbedApp.slug}.forgeapp.json`);
        
        // Ensure directory exists
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        
        await fs.writeFile(outputPath, jsonContent, "utf-8");
        
        console.log(`✅ App successfully dehydrated to: ${outputPath}`);
        process.exit(0);

    } catch (e) {
        console.error("Failed to dehydrate app:", e);
        process.exit(1);
    }
}

dehydrateApp();
