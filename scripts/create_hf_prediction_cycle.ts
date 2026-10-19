import { db } from "../server/database_service.js";
import { operationalCycles, cycleBlueprints } from "../shared/schema/operational-cycles.js";
import { randomUUID } from "crypto";

async function main() {
    console.log("Setting up Hugging Face Prediction Cycle in Default Org...");

    const orgId = 1; // Default Org

    try {
        // 1. Create the Operational Cycle
        const [cycle] = await db.insert(operationalCycles).values({
            name: "Hugging Face Churn Prediction",
            description: "Cycle to fetch data from Hugging Face and predict customer churn.",
            objective: "Demonstrate automated prediction pipeline using Hugging Face datasets.",
            status: "pending_approval",
            priority: 3,
            budgetLimitUsd: "50.00",
            organizationId: orgId,
            createdBy: "antigravity",
            metadata: {
                source: "Hugging Face",
                dataset: "barklaj/telco-churn"
            }
        }).returning();

        console.log(`Cycle created: ${cycle.name} (ID: ${cycle.id})`);

        // 2. Create the Blueprint (The action step)
        const [blueprint] = await db.insert(cycleBlueprints).values({
            cycleId: cycle.id,
            name: "Fetch & Predict",
            objective: "Fetch rows from HF and run Prediction Pod",
            type: "mission",
            config: {
                hf_dataset: "barklaj/telco-churn",
                limit: 5
            }
        }).returning();

        console.log(`Blueprint created: ${blueprint.name} (ID: ${blueprint.id})`);
        console.log("Cycle setup complete! View it in the dashboard under 'Pending'.");

    } catch (error) {
        console.error("Failed to create cycle:", error);
    }
}

main();
