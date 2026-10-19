import "dotenv/config";
import pg from 'pg';

async function main() {
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log("=== Raw SQL Query ===");
        const result = await pool.query('SELECT id, name, organization_id, created_by FROM graph_schema_defs');
        console.log(`Found ${result.rows.length} rows.`);
        result.rows.forEach(row => {
            console.log(`- [${row.id}] Name: "${row.name}", Org: ${row.organization_id}, CreatedBy: ${row.created_by}`);
        });
    } catch (err) {
        console.error("Error:", err);
    } finally {
        await pool.end();
    }
}

main();
