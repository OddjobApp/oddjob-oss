
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function run() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log("Checking extractions for document ID 8...");
        const extractionRes = await pool.query(
            "SELECT id, status, error, error_details, started_at, completed_at FROM knowledge_document_extractions WHERE document_id = 8 ORDER BY id DESC"
        );

        if (extractionRes.rowCount === 0) {
            console.log("No extraction data found for doc 8.");
        } else {
            const row = extractionRes.rows[0];
            console.log(`Status: ${row.status}`);
            console.log(`Error: ${row.error}`);
            console.log(`Error Details: ${JSON.stringify(row.error_details)}`);
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

run();
