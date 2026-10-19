import { db } from "../database_service.js";
import { orgs, jobs, agentDeployments } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { SPATIAL_TRAINING_PLANS } from "../domain/agents/training-plans/spatial-plans.js";

async function applySpatialTrainingPlans() {
    try {
        // 1. Resolve Target Org (Org 1)
        let [org] = await db.select().from(orgs).where(eq(orgs.name, "TECHHEAD7")).limit(1);
        if (!org) [org] = await db.select().from(orgs).limit(1);
        if (!org) throw new Error("No organization found.");
        const orgId = org.id;

        console.log(`\n🗺️ Applying Spatial Control Training Plans (TM-SPATIAL-01..05) to "${org.name}" (ID: ${orgId})...\n`);

        const orgJobs = await db.select().from(jobs).where(eq(jobs.organizationId, orgId));
        console.log(`Found ${orgJobs.length} active jobs in org ${orgId}.\n`);

        let applied = 0;

        for (const plan of SPATIAL_TRAINING_PLANS) {
            console.log(`\n${"═".repeat(60)}`);
            console.log(`📋 ${plan.id}: ${plan.name}`);
            console.log(`   Target Slug: ${plan.targetAgentSlug}`);

            // Find matching job or fallback to best match
            const matchingJob = orgJobs.find(j =>
                j.name.toLowerCase().includes("analyst") ||
                j.name.toLowerCase().includes("developer") ||
                j.name.toLowerCase().includes("planner") ||
                j.name.toLowerCase().includes("scrum") ||
                j.name.toLowerCase().includes("database")
            ) || orgJobs[0];

            if (matchingJob) {
                const currentConfig = (matchingJob.config as any) || {};
                const currentPrompt = currentConfig.systemPrompt || currentConfig.prompt || "";

                if (!currentPrompt.includes(plan.id)) {
                    const updatedPrompt = `${currentPrompt}${plan.systemPromptAddition}`;
                    const updatedConfig = { ...currentConfig, systemPrompt: updatedPrompt, systemIdentity: plan.legendAddition };

                    await db.update(jobs)
                        .set({ config: updatedConfig })
                        .where(eq(jobs.id, matchingJob.id));

                    console.log(`   ✅ Appended behavioral rules to Job ID ${matchingJob.id} ("${matchingJob.name}")`);
                    applied++;
                } else {
                    console.log(`   ℹ️ Training rules for ${plan.id} already applied to Job ID ${matchingJob.id}`);
                    applied++;
                }
            }
        }

        console.log(`\n${"═".repeat(60)}`);
        console.log(`✅ Spatial Training Plans Applied: ${applied}/${SPATIAL_TRAINING_PLANS.length} successful!`);
        console.log(`${"═".repeat(60)}\n`);
        process.exit(0);
    } catch (err: any) {
        console.error(`❌ Failed to apply Spatial Training Plans: ${err.message}`);
        process.exit(1);
    }
}

applySpatialTrainingPlans();
