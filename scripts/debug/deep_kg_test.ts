// @ts-nocheck

import 'dotenv/config';
import { db } from "@server/db/index.js";
import { pipelines, pipelineExecutions, pipelineStepExecutions, knowledgeNodes } from "@shared/schema/index.js";
import { eq, desc } from "drizzle-orm";
import { count } from "drizzle-orm";
import { extractEntities } from "@domain/knowledge/core/extraction/knowledge-graph-extractor.js";

async function deepDebug() {
    try {
        console.log("=== DEEP KG DIAGNOSTIC ===\n");

        // Get latest execution
        const executions = await db.select().from(pipelineExecutions).orderBy(desc(pipelineExecutions.startedAt)).limit(1);
        if (executions.length === 0) {
            console.log("No executions found.");
            return;
        }
        const execution = executions[0];

        // Get pipeline config
        const pipe = await db.select().from(pipelines).where(eq(pipelines.id, execution.pipelineId)).limit(1);
        const p = pipe[0];

        console.log("CURRENT CONFIG:");
        console.log(JSON.stringify(p.knowledgeGraphConfig, null, 2));

        // Get step execution
        const stepExecs = await db
            .select()
            .from(pipelineStepExecutions)
            .where(eq(pipelineStepExecutions.pipelineExecutionId, execution.id))
            .orderBy(pipelineStepExecutions.stepOrder);

        if (stepExecs.length > 0) {
            const step1 = stepExecs[0];
            const output = JSON.parse(step1.output);

            console.log("\nACTUAL DATA STRUCTURE:");
            console.log("Keys:", Object.keys(output));
            console.log("Has 'issues'?", 'issues' in output);
            console.log("Has 'Issues'?", 'Issues' in output);

            if (output.issues) {
                console.log("issues[0] structure:");
                console.log(JSON.stringify(output.issues[0], null, 2).substring(0, 500));
            }

            // Test extraction manually
            const config = p.knowledgeGraphConfig as any;
            if (config?.entityRules) {
                console.log("\n=== TESTING EXTRACTION ===");
                const entities = extractEntities(output, config.entityRules);
                console.log(`Extracted ${entities.length} entities`);
                if (entities.length > 0) {
                    console.log("First entity:", entities[0]);
                }
            }
        }

        // Check nodes
        const nodeCount = await db.select({ count: count() }).from(knowledgeNodes);
        console.log(`\nNodes in DB: ${nodeCount[0].count}`);

    } catch (err) {
        console.error("Error:", err);
    }
    process.exit(0);
}

deepDebug();
