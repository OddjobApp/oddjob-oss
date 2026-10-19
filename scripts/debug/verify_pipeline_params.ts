/**
 * Chain of Verification Diagnostic Script
 * 
 * This script traces why the agent might not be asking for VIN
 */

import { db } from "@server/database_service.js";
import { pipelines, pipelineSteps, jobs, pipelineInputParams } from "../../shared/schema";
import { eq, asc } from "drizzle-orm";
import { extractAllVariables } from "../../shared/utils/variableDiscovery";

async function runDiagnostic() {
    const PIPELINE_ID = 2; // Provision Vehicle

    console.log("=== CHAIN OF VERIFICATION ===\n");

    // Step 1: Check explicit input params
    console.log("STEP 1: Check explicit input params in pipeline_input_params table");
    const explicitParams = await db.select().from(pipelineInputParams)
        .where(eq(pipelineInputParams.pipelineId, PIPELINE_ID));
    console.log(`  Found ${explicitParams.length} explicit params:`);
    explicitParams.forEach((p: any) => console.log(`    - ${p.name} (${p.dataType}, required=${p.isRequired})`));

    // Step 2: Check pipeline exists
    console.log("\nSTEP 2: Verify pipeline exists");
    const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, PIPELINE_ID)).limit(1);
    if (!pipeline) {
        console.log(`  ERROR: Pipeline ${PIPELINE_ID} not found!`);
        process.exit(1);
    }
    console.log(`  Pipeline: "${pipeline.name}" (ID: ${pipeline.id})`);

    // Step 3: Check pipeline steps
    console.log("\nSTEP 3: Check pipeline steps and their job configs");
    const steps = await db.select({
        stepId: pipelineSteps.id,
        stepOrder: pipelineSteps.order,
        outputName: pipelineSteps.outputName,
        jobId: pipelineSteps.jobId,
        jobName: jobs.name,
        jobConfig: jobs.config
    })
        .from(pipelineSteps)
        .leftJoin(jobs, eq(pipelineSteps.jobId, jobs.id))
        .where(eq(pipelineSteps.pipelineId, PIPELINE_ID))
        .orderBy(asc(pipelineSteps.order));

    console.log(`  Found ${steps.length} steps:`);

    const implicitParams: string[] = [];
    const availableOutputs = new Set<string>();

    for (const step of steps) {
        console.log(`\n  Step ${step.stepOrder}: ${step.jobName} (Job ID: ${step.jobId})`);
        console.log(`    Output Name: ${step.outputName || 'none'}`);

        if (step.jobConfig) {
            console.log(`    Config: ${JSON.stringify(step.jobConfig).substring(0, 200)}...`);

            // Extract variables
            const variables = extractAllVariables(step.jobConfig);
            console.log(`    Extracted variables: ${JSON.stringify(variables)}`);

            for (const varName of variables) {
                // Check if it's a reserved prefix
                if (varName.startsWith('step.') || varName.startsWith('pipeline.') ||
                    varName.startsWith('data.') || varName.startsWith('env.') ||
                    varName.startsWith('item.')) {
                    console.log(`      Skipping reserved: ${varName}`);
                    continue;
                }

                // Check if it's from a previous step output
                if (availableOutputs.has(varName)) {
                    console.log(`      Skipping (available from step output): ${varName}`);
                    continue;
                }

                console.log(`      -> IMPLICIT PARAM: ${varName}`);
                implicitParams.push(varName);
            }
        } else {
            console.log(`    No config!`);
        }

        if (step.outputName) {
            availableOutputs.add(step.outputName);
        }
    }

    console.log("\n=== VERIFICATION RESULT ===");
    console.log(`Explicit params: ${explicitParams.length}`);
    console.log(`Implicit params discovered: ${implicitParams.length} - ${JSON.stringify(implicitParams)}`);

    if (implicitParams.length === 0 && explicitParams.length === 0) {
        console.log("\n⚠️  PROBLEM IDENTIFIED: No input params found!");
        console.log("   The agent has no way to know it needs to ask for VIN.");
        console.log("   Check if job configs use {{vin}} or similar variable syntax.");
    }

    process.exit(0);
}

runDiagnostic().catch(console.error);
