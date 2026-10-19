import { db } from "../server/database_service.js";
import { operationalCycles } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    const cycleId = 42;
    
    const blueprints = [
        {
            name: "Fetch Churn Data",
            objective: "Fetch telco churn dataset from Hugging Face.",
            type: "mission",
            estimatedDays: 1,
            inputs: [],
            outputs: ["churn_dataset"]
        },
        {
            name: "Run Churn Prediction",
            objective: "Run prediction model on the fetched data.",
            type: "prediction",
            estimatedDays: 1,
            dependencies: [
                {
                    blueprintName: "Fetch Churn Data",
                    type: "finish_to_start"
                }
            ],
            inputs: ["churn_dataset"],
            outputs: ["churn_prediction"],
            // Custom settings for prediction
            hf_dataset: "barklaj/telco-churn",
            feature_mapping_string: JSON.stringify({
                "monthly_charge": "monthly_charge",
                "tenure": "tenure"
            })
        }
    ];

    try {
        await db.update(operationalCycles)
            .set({
                blueprintCount: blueprints.length,
                metadata: {
                    source: "Hugging Face",
                    dataset: "barklaj/telco-churn",
                    blueprints: blueprints
                }
            })
            .where(eq(operationalCycles.id, cycleId));
            
        console.log("Successfully updated Cycle 42 with blueprints and dependencies.");
    } catch (error) {
        console.error("Failed to update cycle:", error);
    }
    process.exit(0);
}

main();
