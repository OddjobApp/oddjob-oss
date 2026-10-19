
import "dotenv/config";
import { db } from "../server/db/index.js";
import { apps, missionTemplates } from "@shared/schema";
import { eq } from "drizzle-orm";

async function seed() {
    console.log("🚀 Seeding Field Service Verticals (HVAC & Plumbing)...");

    // 1. Resolve the Rescue App (The base infrastructure)
    const rescueApp = await db.query.apps.findFirst({
        where: eq(apps.slug, "emergency-rescue")
    });

    if (!rescueApp) {
        console.error("❌ Rescue App not found. Please run seed-rescue-app.ts first.");
        process.exit(1);
    }

    // 2. Create HVAC Mission Template
    const hvacTemplateName = "HVAC: Urgent Service Dispatch";
    let hvacTemplate = await db.query.missionTemplates.findFirst({
        where: eq(missionTemplates.name, hvacTemplateName)
    });

    if (!hvacTemplate) {
        const result = await db.insert(missionTemplates).values({
            name: hvacTemplateName,
            description: "On-demand dispatch for heating, ventilation, and air conditioning repair. Includes diagnostic triage and arrival verification.",
            config: {
                vertical: "hvac",
                steps: [
                    {
                        id: "geo",
                        name: "Location Pin",
                        toolName: "geolocate_user",
                        jobType: "system"
                    },
                    {
                        id: "assessment",
                        name: "System Assessment",
                        jobType: "human_in_the_loop",
                        description: "Describe the HVAC issue (e.g. leaking, won't turn on)."
                    },
                    {
                        id: "dispatch",
                        name: "Technician Dispatch",
                        toolName: "initiate_rescue",
                        jobType: "partner_gateway",
                        params: { serviceType: "HVAC" }
                    },
                    {
                        id: "resolution",
                        name: "Service Completion",
                        toolName: "verify_handshake",
                        jobType: "system"
                    }
                ]
            },
            createdBy: "system",
        }).returning();
        hvacTemplate = result[0];
        console.log(`✅ HVAC Template Created: ${hvacTemplate.name}`);
    }

    // 3. Create Plumbing Mission Template
    const plumbingTemplateName = "Plumbing: Emergency Leak Response";
    let plumbingTemplate = await db.query.missionTemplates.findFirst({
        where: eq(missionTemplates.name, plumbingTemplateName)
    });

    if (!plumbingTemplate) {
        const result = await db.insert(missionTemplates).values({
            name: plumbingTemplateName,
            description: "Rapid response for water leaks, blockages, and shut-off assistance. Connects you to the nearest licensed plumber.",
            config: {
                vertical: "plumbing",
                steps: [
                    {
                        id: "geo",
                        name: "Location Pin",
                        toolName: "geolocate_user",
                        jobType: "system"
                    },
                    {
                        id: "triage",
                        name: "Leak Triage",
                        jobType: "human_in_the_loop",
                        description: "Confirm if water is active and location of shut-off valve."
                    },
                    {
                        id: "dispatch",
                        name: "Plumber Dispatch",
                        toolName: "initiate_rescue",
                        jobType: "partner_gateway",
                        params: { serviceType: "PLUMBING" }
                    },
                    {
                        id: "resolution",
                        name: "Handshake & Fix",
                        toolName: "verify_handshake",
                        jobType: "system"
                    }
                ]
            },
            createdBy: "system",
        }).returning();
        plumbingTemplate = result[0];
        console.log(`✅ Plumbing Template Created: ${plumbingTemplate.name}`);
    }

    process.exit(0);
}

seed().catch(err => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
});
