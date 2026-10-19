import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    const targetSessionKey = 'crew-1787940005968-nxvuja3';
    console.log('Checking session:', targetSessionKey);
    const sessionRes = await pool.query('SELECT * FROM crew_sessions WHERE session_key = $1', [targetSessionKey]);
    console.log('Session count:', sessionRes.rows.length);

    if (sessionRes.rows.length > 0) {
        const session = sessionRes.rows[0];
        console.log('Session details:', { id: session.id, key: session.session_key, orgId: session.organization_id, title: session.title, mode: session.mode, createdAt: session.created_at });
        const sessionId = session.id;
        const turnsRes = await pool.query('SELECT id, speaker_name, speaker_type, created_at, content, artifacts FROM crew_turns WHERE session_id = $1 ORDER BY id ASC', [sessionId]);
        console.log('Turns count:', turnsRes.rows.length);
        for (const t of turnsRes.rows) {
            console.log(`\n--- TURN #${t.id} (${t.speaker_type}: ${t.speaker_name}) ---`);
            console.log('Content:', t.content);
            console.log('Artifacts:', JSON.stringify(t.artifacts, null, 2));
        }
    }
    await pool.end();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
