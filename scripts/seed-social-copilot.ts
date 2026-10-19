import "dotenv/config";
import { db } from "../server/db/index.js";
import { apps, missionTemplates } from "@shared/schema";
import { eq } from "drizzle-orm";

async function seed() {
    console.log("Seeding Social Co-pilot...");

    // 1. Register the App
    let socialApp = await db.query.apps.findFirst({
        where: eq(apps.slug, "social-copilot")
    });

    if (!socialApp) {
        const result = await db.insert(apps).values({
            name: "Social Co-pilot (LinkedIn)",
            slug: "social-copilot",
            description: "Agent-guided LinkedIn scraper with stealth mechanics and privacy-first extraction.",
            icon: "ShieldCheck", // Lucide icon
            isPublic: true,
            isSystem: true,
            distribution: "standard",
        }).returning();
        socialApp = result[0];
        console.log(`App Registered: ${socialApp.name}`);
    } else {
        console.log(`App already registered: ${socialApp.name}`);
    }

    // 2. Create Mission Template
    const templateName = "LinkedIn: Account Discovery & Extraction";
    let template = await db.query.missionTemplates.findFirst({
        where: eq(missionTemplates.name, templateName)
    });

    if (!template) {
        const result = await db.insert(missionTemplates).values({
            name: templateName,
            description: "Scrape 100 contacts, select high-value interests, and extract business themes to the knowledge graph.",
            config: {
                steps: [
                    {
                        id: "discovery",
                        name: "Initial Discovery",
                        toolName: "discover_contacts",
                        jobType: "browser_mcp",
                        description: "Scrape initial 100 contacts from the search URL."
                    },
                    {
                        id: "selection",
                        name: "Human Interest Selection",
                        jobType: "human_in_the_loop",
                        description: "Select 10 contacts from the discovery list for deep-dive."
                    },
                    {
                        id: "extraction",
                        name: "Theme Extraction",
                        toolName: "extract_profile_themes",
                        jobType: "browser_mcp",
                        description: "Extract Company, Product, and Research themes from selected profiles."
                    }
                ]
            },
            createdBy: "system",
        }).returning();
        template = result[0];
        console.log(`Mission Template Created: ${template.name}`);
    } else {
        console.log(`Mission Template already exists: ${template.name}`);
    }

    process.exit(0);
}

seed().catch(err => {
    console.error("Seed failed:", err);
    process.exit(1);
});
