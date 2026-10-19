// @ts-nocheck

import 'dotenv/config';
import { db } from "@server/db/index.js";
import { pipelines, orgs, pipelineExecutions } from "@shared/schema/index.js";
import { eq, desc } from "drizzle-orm";

async function checkOrgFeature() {
    try {
        const executions = await db.select().from(pipelineExecutions).orderBy(desc(pipelineExecutions.startedAt)).limit(1);
        if (executions.length === 0) {
            console.log("No executions found.");
            return;
        }
        const execution = executions[0];

        const pipe = await db.select().from(pipelines).where(eq(pipelines.id, execution.pipelineId)).limit(1);
        const p = pipe[0];

        console.log("Pipeline organizationId:", p.organizationId);

        if (p.organizationId) {
            const org = await db.select().from(orgs).where(eq(orgs.id, p.organizationId)).limit(1);
            if (org.length > 0) {
                console.log("Organization:", org[0].name);
                console.log("Features:", (org[0] as any).features);
            } else {
                console.log("Organization not found!");
            }
        } else {
            console.log("❌ Pipeline has NO organizationId - KG extraction will be skipped!");
        }

    } catch (err) {
        console.error("Error:", err);
    }
    process.exit(0);
}

checkOrgFeature();
