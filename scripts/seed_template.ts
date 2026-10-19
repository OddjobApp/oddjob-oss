
import 'dotenv/config';
import { db } from "../server/db/index.js";
import { pipelineTemplates } from "../shared/schema/index";

async function main() {
    console.log("Seeding sample template...");

    const [template] = await db.insert(pipelineTemplates).values({
        name: "Daily Data Sync",
        description: "A starter template that syncs data from an API to a file every morning.",
        category: "Data Engineering",
        isFeatured: true,
        config: {
            steps: [
                {
                    moduleType: "job",
                    jobConfig: {
                        name: "Fetch Data",
                        type: "curl",
                        config: { url: "https://api.example.com/data", method: "GET" }
                    }
                },
                {
                    moduleType: "job",
                    jobConfig: {
                        name: "Save to File",
                        type: "file_export",
                        config: { destinationPath: "data/daily_sync.json", content: "{{steps.0.output}}" }
                    }
                }
            ]
        }
    }).returning();

    console.log(`Created template: ${template.name} (ID: ${template.id})`);
    process.exit(0);
}

main().catch(console.error);
