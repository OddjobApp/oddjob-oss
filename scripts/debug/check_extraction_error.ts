
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function run() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log("Searching for 'errorcodes' document...");
        const docRes = await pool.query(
            "SELECT id, title, organization_id FROM knowledge_documents WHERE title ILIKE '%errorcodes%'"
        );

        if (docRes.rowCount === 0) {
            console.log("No document found with title matching 'errorcodes'.");
            return;
        }

        const doc = docRes.rows[0];
        console.log(`Found document: ${doc.title} (ID: ${doc.id}, Org: ${doc.organization_id})`);

        console.log("Checking extraction status...");
        const extractionRes = await pool.query(
            "SELECT * FROM knowledge_document_extractions WHERE document_id = $1 ORDER BY queued_at DESC",
            [doc.id]
        );

        if (extractionRes.rowCount === 0) {
            console.log("No extraction data found for this document.");
        } else {
            console.log("Extraction runs found:", extractionRes.rowCount);
            extractionRes.rows.forEach((row, i) => {
                console.log(`\nRun ${i + 1}:`);
                console.log(`Status: ${row.status}`);
                console.log(`Error: ${row.error}`);
                console.log(`Error Details: ${JSON.stringify(row.error_details, null, 2)}`);
                console.log(`Started At: ${row.started_at}`);
                console.log(`Completed At: ${row.completed_at}`);
            });
        }

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

run();
