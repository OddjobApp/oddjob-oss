import pg from 'pg';
const { Client } = pg;

const client = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:5433/oddjob'
});

async function fixSequence() {
    try {
        await client.connect();
        // Fix the sequence for agent_chat_messages
        const res = await client.query(`
      SELECT setval('agent_chat_messages_id_seq', COALESCE((SELECT MAX(id)+1 FROM agent_chat_messages), 1), false);
    `);
        console.log('Sequence fixed:', res.rows);
    } catch (err) {
        console.error('Error fixing sequence', err.stack);
    } finally {
        await client.end();
    }
}

fixSequence();
