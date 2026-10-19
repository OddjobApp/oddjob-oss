import { db } from '../database_service.js';
import { approvalRequests } from '../../shared/schema/index.js';
import { eq } from 'drizzle-orm';

async function run() {
    const pending = await db.select().from(approvalRequests).where(eq(approvalRequests.status, 'pending'));
    console.log(JSON.stringify(pending.map(r => ({
        id: r.id, 
        executionId: r.executionId, 
        status: r.status, 
        isEvolutionary: r.isEvolutionary,
        context: r.modifiedOutput
    })), null, 2));
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
