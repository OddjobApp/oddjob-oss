import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    // Import crew orchestrator service
    const { crewOrchestratorService } = await import('./server/domain/crew/core/crew-orchestrator.service.js');
    const orgRes = await pool.query('SELECT id FROM orgs LIMIT 1');
    const orgId = orgRes.rows[0].id;
    const userRes = await pool.query('SELECT id FROM users LIMIT 1');
    const userId = userRes.rows[0].id;

    const testSessionKey = `test-sow-${Date.now()}`;
    console.log(`Running test turn in session: ${testSessionKey}...`);

    const result = await crewOrchestratorService.executeRound({
        orgId,
        sessionKey: testSessionKey,
        userId,
        userDisplayName: 'Admin Tester',
        message: 'Draft an SOW for logistics and transportation of Acme server assets.',
    });

    console.log('Turn result turns count:', result.turns?.length);
    for (const t of result.turns || []) {
        console.log(`\n--- TURN #${t.id} (${t.speakerName}) ---`);
        console.log('Content preview:', t.content?.slice(0, 150));
        console.log('Artifacts count:', t.artifacts?.length);
        if (t.artifacts && t.artifacts.length > 0) {
            console.log('Artifacts:', JSON.stringify(t.artifacts, null, 2));
        }
    }

    await pool.end();
}

main().catch(err => {
    console.error('Error during test execution:', err);
    process.exit(1);
});
