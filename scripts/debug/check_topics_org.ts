import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    try {
        const res = await pool.query('SELECT id, name, organization_id FROM knowledge_topics ORDER BY organization_id, name');
        console.log('All topics in DB:');
        res.rows.forEach((r: any) => console.log(`  ID: ${r.id} | Org: ${r.organization_id} | Name: ${r.name}`));

        console.log('\nTopics by org:');
        const byOrg = await pool.query('SELECT organization_id, COUNT(*) as count FROM knowledge_topics GROUP BY organization_id');
        byOrg.rows.forEach((r: any) => console.log(`  Org ${r.organization_id}: ${r.count} topics`));
    } finally {
        await pool.end();
    }
}
main();
