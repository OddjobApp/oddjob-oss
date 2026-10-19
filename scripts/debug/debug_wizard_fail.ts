import 'dotenv/config';
import { db } from "@server/database_service.js";
import { pipelineTemplates, pipelines } from "@shared/schema/index.js";
import { eq, ilike } from "drizzle-orm";
import * as fs from 'fs';

function log(msg: string) {
    console.log(msg);
    fs.appendFileSync('debug_log.txt', msg + '\n');
}

async function main() {
    fs.writeFileSync('debug_log.txt', ''); // Clear log
    const templateName = "File IO Verification Template"; // Adjust if partial match needed
    log(`Searching for template: "${templateName}"...`);

    const [template] = await db
        .select()
        .from(pipelineTemplates)
        .where(ilike(pipelineTemplates.name, `%${templateName}%`))
        .limit(1);

    if (!template) {
        log("❌ Template NOT FOUND.");
        const all = await db.select({ name: pipelineTemplates.name }).from(pipelineTemplates);
        log("Available templates: " + all.map((t: any) => t.name).join(", "));
        process.exit(1);
    }

    log(`✅ Found template: ${template.name} (ID: ${template.id})`);
    log("Config: " + JSON.stringify(template.config, null, 2));

    // Simulate Wizard Session Logic
    log("Attempting to create draft pipeline...");

    try {
        const config = template.config as any;
        const pipelineData = {
            name: `${template.name} (Draft)`,
            description: template.description || "No description",
            triggerType: config.triggerType || "manual",
            isActive: false, // Inactive while drafting
            lifecycleStatus: 'draft',
            organizationId: 1, // System/Default
            createdBy: "debug-script",
        };

        log("Insert payload: " + JSON.stringify(pipelineData));

        const [draftPipeline] = await db.insert(pipelines).values(pipelineData).returning();
        log(`✅ SUCCESS: Draft pipeline created (ID: ${draftPipeline.id})`);

    } catch (err) {
        log("❌ FAILED to create draft pipeline: " + err);
    }

    process.exit(0);
}

main().catch(console.error);
