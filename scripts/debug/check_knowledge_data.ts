
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function run() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        const orgId = 2; // TechStart Inc
        console.log(`Checking knowledge documents for Org ${orgId}...`);

        const docsRes = await pool.query(
            "SELECT id, title, organization_id FROM knowledge_documents WHERE organization_id = $1",
            [orgId]
        );
        console.log(`Documents found: ${docsRes.rowCount ?? 0}`);
        if ((docsRes.rowCount ?? 0) > 0) {
            console.log("Sample documents:", docsRes.rows);
        }

        const topicsRes = await pool.query(
            "SELECT id, name, organization_id FROM knowledge_topics WHERE organization_id = $1",
            [orgId]
        );
        console.log(`Topics found: ${topicsRes.rowCount ?? 0}`);
        if ((topicsRes.rowCount ?? 0) > 0) {
            console.log("Sample topics:", topicsRes.rows);
        }

        const topicDocsRes = await pool.query(
            `SELECT ktd.topic_id, ktd.document_id 
             FROM knowledge_topic_documents ktd
             JOIN knowledge_topics kt ON kt.id = ktd.topic_id
             WHERE kt.organization_id = $1`,
            [orgId]
        );
        console.log(`Topic-Document associations found: ${topicDocsRes.rowCount}`);

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

run();
