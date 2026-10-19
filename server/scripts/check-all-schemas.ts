import 'dotenv/config';
import pg from 'pg';

async function main() {
    console.log("Checking schemas and column existence...");
    const pool = new pg.Pool({ connectionString: "postgresql://postgres:postgres@127.0.0.1:5433/oddjob" });

    try {
        const schemasRes = await pool.query("SELECT schema_name FROM information_schema.schemata");
        console.log("Schemas:", schemasRes.rows.map(r => r.schema_name).join(', '));

        const res = await pool.query(`
            SELECT table_schema, table_name, column_name 
            FROM information_schema.columns 
            WHERE column_name = 'mission_id'
        `);
        console.log("mission_id column found in:");
        res.rows.forEach(r => {
            console.log(` - ${r.table_schema}.${r.table_name}`);
        });

        const res2 = await pool.query(`
            SELECT table_schema, table_name, column_name 
            FROM information_schema.columns 
            WHERE column_name = 'modified_output'
        `);
        console.log("modified_output column found in:");
        res2.rows.forEach(r => {
            console.log(` - ${r.table_schema}.${r.table_name}`);
        });

    } finally {
        await pool.end();
        process.exit(0);
    }
}
main();

