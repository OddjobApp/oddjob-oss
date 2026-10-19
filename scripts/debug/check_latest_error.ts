
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function run() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log("Finding latest document...");
        const docRes = await pool.query(
            "SELECT id, title, created_at FROM knowledge_documents ORDER BY id DESC LIMIT 1"
        );

        if (docRes.rowCount === 0) {
            console.log("No documents found.");
            return;
        }

        const doc = docRes.rows[0];
        console.log(`Latest Document: ${doc.title} (ID: ${doc.id}) Created At: ${doc.created_at}`);

        console.log(`Checking extraction for Doc ID ${doc.id}...`);
        const extractionRes = await pool.query(
            "SELECT id, status, error, error_details FROM knowledge_document_extractions WHERE document_id = $1 ORDER BY id DESC LIMIT 1",
            [doc.id]
        );

        if (extractionRes.rowCount === 0) {
            console.log("No extraction run found for this document.");
        } else {
            const row = extractionRes.rows[0];
            console.log(`Extraction ID: ${row.id}`);
            console.log(`Status: ${row.status}`);
            console.log(`Error: ${row.error}`);
            console.log(`Error Details: ${JSON.stringify(row.error_details, null, 2)}`);
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

run();
