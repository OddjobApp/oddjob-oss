import { db } from "../../server/database_service.js";
import { promptVersions } from "../../shared/schema/learning/index.js";
import { UI_ARCHITECT_PROMPT, UI_DESIGNER_PROMPT, UI_CRITIQUE_PROMPT } from "../../server/domain/apps/core/forge-design-specialists.js";

async function seed() {
    console.log("Seeding prompt evolution system...");
    const prompts = [
        { type: "ui-design", prompt: UI_DESIGNER_PROMPT, name: "UI Designer v1" },
        { type: "code-generation", prompt: UI_ARCHITECT_PROMPT, name: "UI Architect v1" },
        { type: "testing", prompt: UI_CRITIQUE_PROMPT, name: "UI Critique v1" }
    ];

    try {
        for (const p of prompts) {
            // Check if already seeded
            const existing = await db.query.promptVersions.findFirst({
                where: (table: any, { and, eq }: any) => and(
                    eq(table.organizationId, 1),
                    eq(table.promptType, p.type),
                    eq(table.versionId, `seed-${p.type}-v1`)
                )
            });

            if (existing) {
                console.log(`Prompt ${p.type} already seeded.`);
                continue;
            }

            await db.insert(promptVersions).values({
                organizationId: 1,
                promptType: p.type,
                versionId: `seed-${p.type}-v1`,
                systemPrompt: p.prompt,
                generationMethod: "manual",
                status: "active",
                usageCount: 0,
                fitnessScore: "85",
                createdBy: "system"
            } as any);
            console.log(`Seeded ${p.type}.`);
        }
    } catch (err) {
        console.error("Seeding failed:", err);
    } finally {
        process.exit(0);
    }
}

seed();
