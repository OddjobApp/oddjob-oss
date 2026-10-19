import { db } from '../database_service.js';
import { approvalRequests } from '../../shared/schema/index.js';
import { eq, and, like } from 'drizzle-orm';

async function run() {
    // Identify evolutionary pitches that are pending
    const pendingPitches = await db.select().from(approvalRequests).where(and(
        eq(approvalRequests.status, 'pending'),
        eq(approvalRequests.isEvolutionary, true)
    ));

    console.log(`Found ${pendingPitches.length} pending evolutionary pitches.`);

    for (const pitch of pendingPitches) {
        const context = pitch.modifiedOutput as any;
        const isHallucination = pitch.executionId?.startsWith('evo_') || (context?.type === 'EVOLUTIONARY_PITCH');
        
        if (isHallucination) {
            console.log(`Clearing hallucinated pitch: ${pitch.id} (${pitch.executionId})`);
            await db.update(approvalRequests)
                .set({ 
                    status: 'rejected', 
                    comments: 'System Auto-Clear: Hallucinated evolutionary pitch based on low-fidelity source.',
                    decisionAt: new Date()
                } as any)
                .where(eq(approvalRequests.id, pitch.id));
        }
    }
    
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
