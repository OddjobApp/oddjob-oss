import { db } from '../database_service.js';
import { pipelineExecutions } from '../../shared/schema/index.js';
import { eq } from 'drizzle-orm';

async function check() {
  const missionId = 33;
  try {
    const execs = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.missionId, missionId));
    console.log(`\n--- Pipeline Executions for Mission ${missionId} ---`);
    console.table(execs.map(e => ({ 
      id: e.id, 
      pipelineId: e.pipelineId, 
      status: e.status, 
      startedAt: e.startedAt?.toLocaleString() 
    })));
  } catch (err) {
    console.error('Check failed:', err);
  }
  process.exit(0);
}

check();

