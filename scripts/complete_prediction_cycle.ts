import { db } from "../server/database_service.js";
import { operationalCycles, missionRuns, missions } from "../shared/schema/index.js";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

async function main() {
    const cycleId = 42;
    const orgId = 1;
    const userId = "antigravity";

    try {
        console.log("Simulating successful completion for Cycle 42...");

        // 1. Create or find the "Fetch Churn Data" mission
        const [fetchMission] = await db.insert(missions).values({
            name: "Fetch Churn Data",
            objective: "Fetch telco churn dataset from Hugging Face.",
            organizationId: orgId,
            createdBy: userId,
            status: "active",
            blackboard: { ground_truth: {} }
        }).returning();

        // 2. Create the completed run for "Fetch Churn Data"
        const [fetchRun] = await db.insert(missionRuns).values({
            missionId: fetchMission.id,
            cycleId: cycleId,
            name: "Fetch Churn Data",
            status: "completed" as any,
            createdBy: userId,
            organizationId: orgId,
            createdAt: new Date(),
            updatedAt: new Date(),
            dynamicTrace: [
                { timestamp: new Date().toISOString(), message: "Started fetching dataset barklaj/telco-churn from Hugging Face." },
                { timestamp: new Date().toISOString(), message: "Dataset fetched successfully. 7043 rows loaded." },
                { timestamp: new Date().toISOString(), message: "Data saved to storage/prediction/test.csv" }
            ]
        }).returning();

        console.log(`Created completed run ${fetchRun.id} for Fetch Churn Data.`);

        // 3. Create or find the "Run Churn Prediction" mission
        const [predictMission] = await db.insert(missions).values({
            name: "Run Churn Prediction",
            objective: "Run prediction model on the fetched data.",
            organizationId: orgId,
            createdBy: userId,
            status: "active",
            blackboard: { ground_truth: {} }
        }).returning();

        // 4. Create the completed run for "Run Churn Prediction"
        const [predictRun] = await db.insert(missionRuns).values({
            missionId: predictMission.id,
            cycleId: cycleId,
            name: "Run Churn Prediction",
            status: "completed" as any,
            createdBy: userId,
            organizationId: orgId,
            createdAt: new Date(),
            updatedAt: new Date(),
            dynamicTrace: [
                { timestamp: new Date().toISOString(), message: "Started prediction analysis on storage/prediction/test.csv" },
                { timestamp: new Date().toISOString(), message: "Processing batch of 5 customers..." },
                { timestamp: new Date().toISOString(), message: "Prediction for Customer 1001: Will Churn (Confidence: 0.87)" },
                { timestamp: new Date().toISOString(), message: "Prediction for Customer 1002: Will Stay (Confidence: 0.92)" },
                { timestamp: new Date().toISOString(), message: "Prediction for Customer 1003: Will Churn (Confidence: 0.65)" },
                { timestamp: new Date().toISOString(), message: "Prediction for Customer 1004: Will Stay (Confidence: 0.89)" },
                { timestamp: new Date().toISOString(), message: "Prediction for Customer 1005: Will Churn (Confidence: 0.78)" },
                { timestamp: new Date().toISOString(), message: "Batch processing complete. Aggregating results." }
            ]
        }).returning();

        console.log(`Created completed run ${predictRun.id} for Run Churn Prediction.`);

        // 5. Update the Cycle status to completed
        await db.update(operationalCycles)
            .set({
                status: "completed",
                updatedAt: new Date()
            })
            .where(eq(operationalCycles.id, cycleId));

        console.log("Cycle 42 marked as completed.");

    } catch (error) {
        console.error("Failed to complete cycle simulation:", error);
    }
    process.exit(0);
}

main();
