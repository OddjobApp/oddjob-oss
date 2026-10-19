
import "dotenv/config";
import { supervisorService } from "@domain/integrations/core/supervisor.service.js";
import { db } from "@server/database_service.js";
import { credentials } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    console.log("Starting Glass-Box Observability Test...");

    // 1. Mock Credentials (if needed, or verify existing)
    const [cred] = await db.select().from(credentials).where(eq(credentials.type, "ai_provider")).limit(1);
    if (!cred) {
        console.error("No AI Credential found. Please configure .env or DB.");
        return;
    }
    console.log(`Using credential: ${cred.name} (${cred.id})`);

    // 2. Execute Planning
    const intent = "Calculate the square root of 144 and then find the current price of Bitcoin.";
    console.log(`Planning for intent: ${intent}`);

    try {
        const plan = await supervisorService.plan(
            intent,
            "gpt-4-turbo", // Or gemini-1.5-pro if configured
            cred.id
        );

        console.log("Plan generated successfully!");

        // 3. Verify Thought Capture
        const thoughtEvent = plan.history.find(h => h.type === "thought");

        if (thoughtEvent) {
            console.log("\n[SUCCESS] Thought Process Captured:");
            console.log("-----------------------------------");
            console.log(thoughtEvent.thought);
            console.log("-----------------------------------");
        } else {
            console.error("\n[FAILURE] No 'thought' event found in history.");
            console.log("History:", JSON.stringify(plan.history, null, 2));
        }

        // 4. Verify Task Structure
        console.log("\nGenerated Tasks:");
        plan.tasks.forEach(t => {
            console.log(`- [${t.type}] ${t.name}: ${t.description}`);
        });

    } catch (error) {
        console.error("Test Failed:", error);
    }
}

main().catch(console.error);

