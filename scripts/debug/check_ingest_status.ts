
import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

async function run() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log("Checking Document 12...");
        const docRes = await pool.query(
            "SELECT * FROM knowledge_documents WHERE id = 12"
        );
        if (docRes.rowCount === 0) {
            console.log("Doc 12 not found.");
        } else {
            console.log("Doc 12 found:", docRes.rows[0].title);
        }

        console.log("Checking Linkage...");
        const linkRes = await pool.query(
            "SELECT * FROM knowledge_topic_documents WHERE document_id = 12"
        );
        console.log("Links found:", linkRes.rows.length);

        console.log("Checking Extraction...");
        const extRes = await pool.query(
            "SELECT * FROM knowledge_document_extractions WHERE document_id = 12 ORDER BY id DESC"
        );
        if (extRes.rowCount && extRes.rowCount && extRes.rowCount > 0) {
            const ext = extRes.rows[0];
            console.log(`Extraction ID: ${ext.id}, Status: ${ext.status}`);
            console.log(`Error: ${ext.error || 'None'}`);
        } else {
            console.log("No extraction found.");
        }

        console.log("Checking Nodes...");
        const nodesRes = await pool.query(
            "SELECT COUNT(*) FROM knowledge_nodes WHERE knowledge_document_id = 12"
        );
        console.log("Nodes created:", nodesRes.rows[0].count);

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

run();
