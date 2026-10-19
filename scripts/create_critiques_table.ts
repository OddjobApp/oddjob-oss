
import "dotenv/config";
import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function createTable() {
    console.log("Creating table agent_critiques...");
    await db.execute(sql`
        CREATE TABLE IF NOT EXISTS agent_critiques (
            id SERIAL PRIMARY KEY,
            interaction_id INTEGER NOT NULL,
            criticism TEXT NOT NULL,
            score DECIMAL(3, 2) NOT NULL,
            issues JSONB DEFAULT '[]',
            correction TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);
    console.log("Table created.");
    process.exit(0);
}

createTable().catch(console.error);
