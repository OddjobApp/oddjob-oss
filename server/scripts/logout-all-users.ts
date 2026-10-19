import { pool } from "../../server/database_service.js";

async function logoutAllUsers() {
  console.log("Truncating all session tokens from database...");
  try {
    const result = await pool.query('DELETE FROM "session";');
    console.log(`Successfully logged out everyone. Cleared ${result.rowCount} session records.`);
  } catch (err) {
    console.error("Error clearing sessions:", err);
  } finally {
    await pool.end();
  }
}

logoutAllUsers();
