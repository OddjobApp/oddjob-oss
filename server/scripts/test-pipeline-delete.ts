import "dotenv/config";
import { pipelineService } from "../domain/pipeline/core/pipeline.service.js";
import { db } from "../database_service.js";
import { pipelines, missionRuns } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    const PIPELINE_ID = 214;
    const ORG_ID = 2;

    const before = await db.select({ id: pipelines.id, name: pipelines.name }).from(pipelines).where(eq(pipelines.id, PIPELINE_ID));
    console.log(`Before: pipeline ${PIPELINE_ID} exists =`, before.length > 0 ? `yes (${before[0].name})` : "no");

    const refsBefore = await db.select({ id: missionRuns.id }).from(missionRuns).where(eq(missionRuns.currentPipelineId, PIPELINE_ID));
    console.log(`Mission runs referencing it: ${refsBefore.length}`);

    await pipelineService.delete(PIPELINE_ID, { userId: "test", organizationId: ORG_ID, isAdmin: true, isSuperAdmin: true, isOrgAdmin: false } as any);
    console.log("Delete call returned without throwing");

    const after = await db.select({ id: pipelines.id }).from(pipelines).where(eq(pipelines.id, PIPELINE_ID));
    console.log(`After: pipeline ${PIPELINE_ID} exists =`, after.length > 0 ? "yes (FAIL)" : "no (PASS)");

    const refsAfter = await db.select({ id: missionRuns.id, current: missionRuns.currentPipelineId }).from(missionRuns).where(eq(missionRuns.id, refsBefore[0]?.id ?? -1));
    console.log(`Mission run that referenced it: currentPipelineId now =`, refsAfter[0]?.current ?? "(not found)");

    process.exit(0);
}
main().catch(e => { console.error("[FAIL]", e.message); process.exit(1); });
