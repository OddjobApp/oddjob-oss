
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function run() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log("Fetching content_type for document ID 7...");
        const docRes = await pool.query(
            "SELECT id, title, content_type, source_type FROM knowledge_documents WHERE id = 7"
        );

        if (docRes.rowCount === 0) {
            console.log("Document 7 not found.");
            return;
        }

        const doc = docRes.rows[0];
        console.log("Document Details:", doc);

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

run();
