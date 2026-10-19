
import 'dotenv/config';
import { db } from "@server/database_service.js";
import { pipelines, pipelineExecutions, pipelineStepExecutions, knowledgeNodes } from "../../shared/schema/index.js";
import { eq, desc } from "drizzle-orm";
import { count } from "drizzle-orm";

async function checkKGDebug() {
    try {
        console.log("=== Knowledge Graph Debug ===\n");

        // 1. Check KG nodes count
        const nodeCount = await db.select({ count: count() }).from(knowledgeNodes);
        console.log(`1. Knowledge Nodes in DB: ${nodeCount[0].count}`);

        // 2. Get latest execution
        const executions = await db.select().from(pipelineExecutions).orderBy(desc(pipelineExecutions.startedAt)).limit(1);
        if (executions.length === 0) {
            console.log("\n2. No executions found.");
            return;
        }
        const execution = executions[0];
        console.log(`\n2. Latest Execution:`);
        console.log(`   ID: ${execution.id}`);
        console.log(`   Pipeline ID: ${execution.pipelineId}`);
        console.log(`   Status: ${execution.status}`);
        console.log(`   Started: ${execution.startedAt}`);
        console.log(`   Completed: ${execution.completedAt}`);

        // 3. Get pipeline config
        const pipe = await db.select().from(pipelines).where(eq(pipelines.id, execution.pipelineId)).limit(1);
        if (pipe.length > 0) {
            const p = pipe[0];
            console.log(`\n3. Pipeline Config:`);
            console.log(`   Name: ${p.name}`);
            console.log(`   KG Enabled: ${p.enableKnowledgeGraph}`);
            console.log(`   KG Config:`, JSON.stringify(p.knowledgeGraphConfig, null, 2));
        }

        // 4. Get step executions
        const stepExecs = await db
            .select()
            .from(pipelineStepExecutions)
            .where(eq(pipelineStepExecutions.pipelineExecutionId, execution.id))
            .orderBy(pipelineStepExecutions.stepOrder);

        console.log(`\n4. Step Executions (${stepExecs.length} total):`);
        for (const step of stepExecs) {
            console.log(`   Step ${step.stepOrder + 1}: ${step.status}`);
            if (step.output) {
                try {
                    const output = JSON.parse(step.output);
                    console.log(`      Output keys: ${Object.keys(output).join(', ')}`);
                    if (output.issues && Array.isArray(output.issues)) {
                        console.log(`      Issues array length: ${output.issues.length}`);
                    }
                } catch {
                    console.log(`      Output (not JSON): ${step.output.substring(0, 50)}...`);
                }
            }
        }

    } catch (err) {
        console.error("Error:", err);
    }
    process.exit(0);
}

checkKGDebug();
