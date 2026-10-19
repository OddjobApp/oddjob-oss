import { config } from "dotenv";
config();

import { Pool } from "pg";

async function migrate() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS mission_file_attachments (
                id SERIAL PRIMARY KEY,
                mission_id INTEGER NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
                file_name TEXT NOT NULL,
                content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
                file_size INTEGER,
                file_data TEXT,
                text_content TEXT,
                purpose TEXT NOT NULL DEFAULT 'reference',
                added_by TEXT,
                created_at TIMESTAMP DEFAULT NOW() NOT NULL
            );
        `);
        console.log("✅ mission_file_attachments table created");
    } catch (err: any) {
        if (err.message?.includes("already exists")) {
            console.log("Table already exists, skipping.");
        } else {
            console.error("Migration error:", err.message);
        }
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();
