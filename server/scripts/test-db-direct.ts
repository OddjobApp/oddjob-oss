
import "dotenv/config";
import pg from "pg";

async function testConnection() {
    console.log("--- Testing Database Connection Directly ---");
    console.log("DATABASE_URL:", process.env.DATABASE_URL ? "SET" : "NOT SET");

    if (!process.env.DATABASE_URL) {
        process.exit(1);
    }

    const client = new pg.Client({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        await client.connect();
        console.log("✅ Successfully connected to Postgres!");
        const res = await client.query("SELECT id, username, email FROM users");
        console.log(`Total Users Found: ${res.rows.length}`);
        res.rows.forEach(u => {
            console.log(`- ${u.id}: ${u.username} (${u.email})`);
        });
        await client.end();
    } catch (err: any) {
        console.error("❌ Connection failed:", err.message);
        process.exit(1);
    }
}

testConnection();

