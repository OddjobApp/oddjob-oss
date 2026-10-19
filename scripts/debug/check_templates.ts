
import { db } from "@server/database_service.js";
import { pipelineTemplates, orgSettings } from "../../shared/schema";
import { eq } from "drizzle-orm";

async function main() {
    console.log("Checking pipelineTemplates table...");
    try {
        const templates = await db.select().from(pipelineTemplates).limit(5);
        console.log("Templates found:", templates.length);
        if (templates.length > 0) {
            console.log("First template:", templates[0]);
        }
    } catch (error) {
        console.error("Error fetching templates:", error);
    }

    console.log("\nChecking orgSettings table...");
    try {
        const settings = await db.select().from(orgSettings).limit(5);
        console.log("OrgSettings found:", settings.length);
    } catch (error) {
        console.error("Error fetching orgSettings:", error);
    }
}

main().catch(console.error).then(() => process.exit(0));
