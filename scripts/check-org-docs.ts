import { db } from "../server/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
  const result = await db.execute(sql`SELECT count(*) FROM knowledge_documents WHERE organization_id = 342 AND source_type = 'best_practices'`);
  console.log("BEST PRACTICE DOCS IN ORG 342 (Oddjob System):", result.rows[0]);

  const nodes = await db.execute(sql`SELECT count(*) FROM graph_nodes WHERE organization_id = 342 AND properties->>'sourceType' = 'best_practices'`);
  console.log("KNOWLEDGE GRAPH NODES IN ORG 342 (Oddjob System):", nodes.rows[0]);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
