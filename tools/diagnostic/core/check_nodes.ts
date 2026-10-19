import "dotenv/config";
import pg from 'pg';

async function check() {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

    const res = await pool.query("SELECT count(*) FROM knowledge_nodes WHERE label = 'Attachment'");
    console.log(`Current Attachment node count: ${res.rows[0].count}`);
    
    const res2 = await pool.query("SELECT count(*) FROM knowledge_nodes WHERE name ~* '\\.(png|jpg|jpeg|gif|webp|svg|bmp)$'");
    console.log(`Current image extension node count: ${res2.rows[0].count}`);

    await pool.end();
}

check().catch(console.error);
