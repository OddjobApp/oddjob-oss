
import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function inspectOutcomes() {
    const missionId = 45;
    console.log(`--- Quick Inspect for Mission ${missionId} ---`);

    // Use raw SQL to avoid schema import issues in this environment
    const runs = await db.execute(sql`SELECT id, status, pipeline_execution_id FROM mission_runs WHERE mission_id = ${missionId}`);

    for (const r of (runs.rows as any[])) {
        console.log(`\nMISSION RUN ${r.id} [${r.status}]`);
        const execId = r.pipeline_execution_id;

        if (execId) {
            const steps = await db.execute(sql`SELECT step_order, status, output FROM pipeline_step_executions WHERE pipeline_execution_id = ${execId} ORDER BY step_order`);
            console.log(`Steps Found: ${steps.rows.length}`);
            for (const s of (steps.rows as any[])) {
                console.log(`- Step ${s.step_order}: ${s.status}`);
                if (s.output) {
                    try {
                        const out = JSON.parse(s.output);
                        console.log(`  Output Snippet: ${JSON.stringify(out).substring(0, 150)}...`);
                    } catch (e) {
                        console.log(`  Output (Raw): ${String(s.output).substring(0, 150)}...`);
                    }
                }
            }
        }
    }
}

inspectOutcomes().catch(console.error);

