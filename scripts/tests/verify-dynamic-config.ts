import { db } from "../../server/db/index.js";
import { jobs, pipelineSteps, pipelines } from '@shared/schema';
import { eq, and, like, or } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

async function verifyConfig() {
  try {
    // Check Step 2
    const step2 = await db
      .select({
        id: jobs.id,
        name: jobs.name,
        userPrompt: sql<string>`${jobs.config}->>'userPrompt'`,
      })
      .from(jobs)
      .innerJoin(pipelineSteps, eq(pipelineSteps.jobId, jobs.id))
      .innerJoin(pipelines, eq(pipelines.id, pipelineSteps.pipelineId))
      .where(
        and(
          or(like(pipelines.name, '%Update Feature%'), like(pipelines.name, '%Update JIRA%')),
          eq(pipelineSteps.order, 1),
          eq(jobs.type, 'ai_api_call')
        )
      )
      .limit(1);

    // Check Step 3
    const step3 = await db
      .select({
        id: jobs.id,
        name: jobs.name,
        body: sql<string>`${jobs.config}->'nestedJobConfig'->>'body'`,
      })
      .from(jobs)
      .where(like(jobs.name, '%Update JIRA%'))
      .limit(1);

    console.log('Step 2 Configuration:');
    if (step2.length > 0) {
      console.log(`  Job: ${step2[0].name} (id: ${step2[0].id})`);
      console.log(`  Prompt contains "fieldId": ${step2[0].userPrompt?.includes('fieldId') ? 'YES' : 'NO'}`);
      console.log(`  Prompt contains "fieldValue": ${step2[0].userPrompt?.includes('fieldValue') ? 'YES' : 'NO'}`);
    }

    console.log('\nStep 3 Configuration:');
    if (step3.length > 0) {
      console.log(`  Job: ${step3[0].name} (id: ${step3[0].id})`);
      console.log(`  Body: ${step3[0].body}`);
      console.log(`  Uses fieldId: ${step3[0].body?.includes('fieldId') ? 'YES' : 'NO'}`);
      console.log(`  Uses fieldValue: ${step3[0].body?.includes('fieldValue') ? 'YES' : 'NO'}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

verifyConfig();
