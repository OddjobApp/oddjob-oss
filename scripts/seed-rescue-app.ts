
import "dotenv/config";
import { db } from "../server/db/index.js";
import { apps, missionTemplates } from "@shared/schema";
import { eq } from "drizzle-orm";

async function seed() {
    console.log("🚀 Seeding Emergency Rescue Mini-App...");

    // 1. Register/Update the App
    let rescueApp = await db.query.apps.findFirst({
        where: eq(apps.slug, "service-dispatch")
    });

    if (!rescueApp) {
        // Double check for old slug to rename it
        rescueApp = await db.query.apps.findFirst({
            where: eq(apps.slug, "emergency-rescue")
        });

        if (rescueApp) {
            console.log("ℹ️ Renaming 'emergency-rescue' to 'service-dispatch'...");
            const result = await db.update(apps).set({
                name: "Service Dispatch",
                slug: "service-dispatch",
                description: "Generalized mission coordination and geospatial dispatch. Features real-time Mapbox tracking and secure provider verification.",
                icon: "MapPin"
            }).where(eq(apps.id, rescueApp.id)).returning();
            rescueApp = result[0];
            console.log(`✅ App Renamed: ${rescueApp.name}`);
        } else {
            const result = await db.insert(apps).values({
                name: "Service Dispatch",
                slug: "service-dispatch",
                description: "Generalized mission coordination and geospatial dispatch. Features real-time Mapbox tracking and secure provider verification.",
                icon: "MapPin",
                isPublic: true,
                isSystem: true,
                distribution: "standard",
                version: "1.0.0"
            }).returning();
            rescueApp = result[0];
            console.log(`✅ App Registered: ${rescueApp.name}`);
        }
    } else {
        console.log(`ℹ️ App already registered: ${rescueApp.name}`);
    }

    // 2. Create Mission Template
    const templateName = "On-Demand Service Dispatch";
    let template = await db.query.missionTemplates.findFirst({
        where: eq(missionTemplates.name, templateName)
    });

    if (!template) {
        const result = await db.insert(missionTemplates).values({
            name: templateName,
            description: "Automated dispatch of a service provider with dual-ended telemetry and secure arrival handshake.",
            config: {
                steps: [
                    {
                        id: "geo_resolution",
                        name: "Location Resolution",
                        toolName: "geolocate_user",
                        jobType: "system",
                        description: "Convert user GPS to street address."
                    },
                    {
                        id: "triage",
                        name: "Incident Triage",
                        jobType: "human_in_the_loop",
                        description: "Confirm vehicle type and dispatch urgency."
                    },
                    {
                        id: "dispatch",
                        name: "Provider Dispatch",
                        toolName: "initiate_rescue",
                        jobType: "partner_gateway",
                        description: "Broadcast request to the partner network."
                    },
                    {
                        id: "recovery",
                        name: "Handshake & Recovery",
                        toolName: "verify_handshake",
                        jobType: "system",
                        description: "Verify arrival and complete mission."
                    }
                ]
            },
            createdBy: "system",
        }).returning();
        template = result[0];
        console.log(`✅ Mission Template Created: ${template.name}`);
    } else {
        console.log(`ℹ️ Mission Template already exists: ${template.name}`);
    }

    // 3. Create Demo Simulator Template
    const simulatorName = "Service Dispatch: High-Fidelity Simulator";
    let simulator = await db.query.missionTemplates.findFirst({
        where: eq(missionTemplates.name, simulatorName)
    });

    if (!simulator) {
        const result = await db.insert(missionTemplates).values({
            name: simulatorName,
            description: "A sandbox environment to test geospatial dispatch logic without requiring real-world provider location updates.",
            config: {
                steps: [
                    {
                        id: "geo_resolution",
                        name: "Location Resolution",
                        toolName: "geolocate_user",
                        jobType: "system"
                    },
                    {
                        id: "dispatch",
                        name: "Simulated Dispatch",
                        toolName: "rescue_dispatch",
                        jobType: "partner_gateway",
                        params: { isDemoMode: true, serviceType: "simulation" }
                    },
                    {
                        id: "recovery",
                        name: "Handshake & Recovery",
                        toolName: "verify_handshake",
                        jobType: "system"
                    }
                ]
            },
            createdBy: "system",
        }).returning();
        simulator = result[0];
        console.log(`✅ Simulator Template Created: ${simulator.name}`);
    } else {
        console.log(`ℹ️ Simulator Template already exists: ${simulator.name}`);
    }

    process.exit(0);
}

seed().catch(err => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
});
