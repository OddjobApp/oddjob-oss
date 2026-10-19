
import "dotenv/config";
import { missionService } from "../domain/mission/core/mission.service.js";
import { db } from "../database_service.js";
import { orgs, credentials } from "../../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function verify() {
    console.log("--- Starting Mission Planning Verification ---");

    // 1. Setup mock org
    const uniqueId = Math.random().toString(36).substring(7);
    const [org] = await db.insert(orgs).values({
        name: `Planning Test Org ${uniqueId}`,
    }).returning();

    // 2. Setup a credential so planning can talk to AI
    await db.insert(credentials).values({
        name: "Test AI",
        type: "ai_provider",
        organizationId: org.id,
        createdBy: "system",
        envVarName: "GEMINI_API_KEY"
    });

    // 3. Trigger planMission
    console.log("Planning mission: 'Market Research Team'...");
    const prompt = "Assemble a team for a market research project for a new sustainable energy product.";

    try {
        const plan = await missionService.planMission(prompt, "system", org.id);

        console.log("\n--- Planning Result ---");
        console.log(`Mission Name: ${plan.name}`);
        console.log(`Objective: ${plan.objective}`);

        if (!plan.members || plan.members.length === 0) {
            console.error("FAILED: No members suggested");
        } else {
            console.log(`Suggested ${plan.members.length} members.`);
            plan.members.forEach((m: any, i: number) => {
                console.log(`\nMember ${i + 1}: ${m.role}`);
                if (!m.entityId && m.suggestedConfig) {
                    console.log("SUCCESS: Suggested new agent with config:");
                    console.log(JSON.stringify(m.suggestedConfig, null, 2));

                    if (!m.suggestedConfig.systemPrompt) console.error("FAILED: Missing systemPrompt in suggestedConfig");
                    if (!m.suggestedConfig.goal) console.error("FAILED: Missing goal in suggestedConfig");
                } else if (m.entityId) {
                    console.log(`Linked to existing job: ${m.entityId}`);
                } else {
                    console.warn("Role suggested without entityId OR suggestedConfig");
                }
            });
        }
    } catch (error) {
        console.error("Planning FAILED with error:", error);
    }

    // Cleanup omitted for inspection
    console.log("\n--- Verification Complete ---");
    process.exit(0);
}

verify();

