
import "dotenv/config";
import { db } from "../../server/db/index.js";
import { credentials, users } from "@shared/schema";
import { eq } from "drizzle-orm";

async function setupAirflow() {
    console.log("🌪️ Setting up Airflow credential...");

    const adminUser = await db.query.users.findFirst({
        where: eq(users.username, "admin"),
    });

    if (!adminUser) {
        console.error("❌ Admin user not found. Please seed the database first.");
        process.exit(1);
    }

    // Check if credential already exists
    const existing = await db.query.credentials.findFirst({
        where: eq(credentials.name, "Airflow Local"),
    });

    if (existing) {
        console.log("✅ Airflow credential already exists.");
        process.exit(0);
    }

    try {
        await db.insert(credentials).values({
            name: "Airflow Local",
            type: "api_key", // Using api_key type as generic holder
            envVarName: "AIRFLOW_PASSWORD",
            metadata: {
                baseUrl: process.env.AIRFLOW_BASE_URL || "http://localhost:8080",
                username: process.env.AIRFLOW_USERNAME || "admin",
                authType: "basic"
            },
            createdBy: adminUser.username,
        });
        console.log("✅ Airflow credential created successfully!");
        console.log("   URL: " + (process.env.AIRFLOW_BASE_URL || "http://localhost:8080"));
        console.log("   User: " + (process.env.AIRFLOW_USERNAME || "admin"));
    } catch (error) {
        console.error("❌ Failed to create credential:", error);
        process.exit(1);
    }

    process.exit(0);
}

setupAirflow();
