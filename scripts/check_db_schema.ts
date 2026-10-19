import "dotenv/config";
import pg from "pg";

async function main() {
    const client = new pg.Client({
        connectionString: process.env.DATABASE_URL,
    });
    await client.connect();

    console.log("--- TABLES ---");
    const tables = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
    `);
    console.log(tables.rows.map(r => r.table_name).join(", "));
    await client.end();
}

main().catch(console.error);
