import "dotenv/config";
import { db } from "../database_service.js";
import { missionTemplates } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "url";

async function seedRescue() {
    console.log("🌱 Seeding Rescue Mission Template...");

    const rescueTemplate = {
        name: "Rescue Service",
        description: "Standard mission for coordinating emergency help, helper discovery, and real-time tracking.",
        config: {
            type: "rescue",
            objective: "Provide emergency assistance by discovering and dispatching the nearest qualified helper.",
            members: [
                {
                    role: "Dispatcher",
                    entityType: "job",
                    description: "Supervisor agent for geospatial queues and routing orchestration."
                }
            ],
            // Default parameters for the Rescue Shadow
            initialStatus: "REQUESTED",
            arrivalProtocol: {
                mode: "PIN_VERIFICATION",
                timeoutSeconds: 300
            }
        },
        organizationId: null, // Global template
        createdBy: "system"
    };

    // Check if it already exists
    const [existing] = await db.select()
        .from(missionTemplates)
        .where(eq(missionTemplates.name, "Rescue Service"))
        .limit(1);

    if (existing) {
        console.log("♻️ Updating existing Rescue Mission Template...");
        await db.update(missionTemplates)
            .set(rescueTemplate)
            .where(eq(missionTemplates.id, existing.id));
    } else {
        console.log("✨ Creating new Rescue Mission Template...");
        await db.insert(missionTemplates).values(rescueTemplate);
    }

    console.log("✅ Rescue Seeding Complete!");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === (process.argv[1].endsWith(".ts") ? process.argv[1] : process.argv[1] + ".ts");
// Simple check for tsx execution
if (process.argv[1]?.includes('rescue-app.ts')) {
    seedRescue().catch(err => {
        console.error("❌ Rescue seeding failed:", err);
        process.exit(1);
    });
}

export { seedRescue };

