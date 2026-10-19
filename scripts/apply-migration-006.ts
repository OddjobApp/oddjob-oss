import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not defined in env");
    process.exit(1);
  }

  const sqlFilePath = path.resolve("server/migrations/006_add_approval_request_tool_fields.sql");
  console.log(`Reading SQL file: ${sqlFilePath}`);
  const sql = await fs.readFile(sqlFilePath, "utf8");

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  console.log("Connecting to PostgreSQL...");
  const client = await pool.connect();
  
  try {
    console.log("Running migration SQL statements...");
    await client.query(sql);
    console.log("Migration executed successfully!");
  } catch (error: any) {
    console.error("Migration execution failed:", error);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
