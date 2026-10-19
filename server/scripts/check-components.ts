import { db } from "../database_service.js";
import { componentIndex } from "@shared/schema/index.js";

async function checkComponents() {
  const results = await db.select().from(componentIndex);
  console.log(`Found ${results.length} components in component_index table:`);
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

checkComponents().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
