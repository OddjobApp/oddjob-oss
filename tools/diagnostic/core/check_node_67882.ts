
import "dotenv/config";
import { db } from "./server/db.js";
import { knowledgeNodes } from "./shared/schema/index.js";
import { eq } from "drizzle-orm";

async function checkNode() {
    const [node] = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, 67882));
    console.log(JSON.stringify(node, null, 2));
    process.exit(0);
}
checkNode();
