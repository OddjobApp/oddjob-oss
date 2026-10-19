
import { db } from "@server/database_service.js";
import { knowledgeDocuments, graphSchemaDefs } from "../../shared/schema";

async function main() {
    const docs = await db.select().from(knowledgeDocuments).limit(5);
    console.log("Documents:", JSON.stringify(docs, null, 2));

    const schemas = await db.select().from(graphSchemaDefs).limit(5);
    console.log("Schemas:", JSON.stringify(schemas, null, 2));

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
