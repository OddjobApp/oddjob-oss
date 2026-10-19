import 'dotenv/config';
import { db } from "../database_service.js";
import { errorDiagnoses } from "@shared/schema/index.js";
import { desc } from "drizzle-orm";

async function verify() {
    console.log("Checking for recent error diagnoses...");

    try {
        const diagnoses = await db.select().from(errorDiagnoses).orderBy(desc(errorDiagnoses.createdAt)).limit(1);

        if (diagnoses.length === 0) {
            console.log("No diagnoses found.");
            process.exit(1);
        }

        const latest = diagnoses[0];
        console.log("Latest Diagnosis Found:");
        console.log("ID:", latest.diagnosisId);
        console.log("Error:", latest.errorMessage);
        console.log("Context:", {
            httpStatus: latest.httpStatus,
            jobType: latest.jobType
        });
        console.log("AI Diagnosis:", JSON.stringify(latest.aiDiagnosis, null, 2));
        console.log("Recommendations:", JSON.stringify(latest.recommendations, null, 2));

        process.exit(0);
    } catch (error) {
        console.error("Failed to query diagnoses:", error);
        process.exit(1);
    }
}

verify();

