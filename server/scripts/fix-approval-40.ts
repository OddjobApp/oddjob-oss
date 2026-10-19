import { db } from '../database_service.js';
import { approvalRequests } from '../../shared/schema/index.js';
import { eq } from 'drizzle-orm';

async function fix() {
  try {
    const res = await db.update(approvalRequests)
      .set({ 
        approverEmail: 'admin@example.com', 
        executionId: 'pipeline:76' 
      })
      .where(eq(approvalRequests.id, 40));
    console.log('Update successful:', res);
  } catch (err) {
    console.error('Update failed:', err);
  }
  process.exit(0);
}

fix();

