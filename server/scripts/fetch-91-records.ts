import { db } from "../database_service.js";
import { sql } from "drizzle-orm";

async function find91() {
  console.log("Searching for 91 in agent_run_steps...");
  const res1 = await db.execute(sql.raw(`SELECT * FROM agent_run_steps WHERE mission_id = 91 OR job_id = 91`));
  console.log("agent_run_steps results:", JSON.stringify(res1.rows, null, 2));

  console.log("Searching for 91 in agent_chat_messages...");
  const res2 = await db.execute(sql.raw(`SELECT * FROM agent_chat_messages WHERE mission_id = 91 OR job_id = 91`));
  console.log("agent_chat_messages results:", JSON.stringify(res2.rows, null, 2));
}

find91().catch(console.error).finally(() => process.exit(0));

