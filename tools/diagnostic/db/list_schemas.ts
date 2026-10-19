
import { db } from "./server/db.js";
import { graphSchemaDefs } from "./shared/schema/index.js";

async function listSchemas() {
    const schemas = await db.select().from(graphSchemaDefs);
    console.log("Available Graph Schemas:");
    schemas.forEach(s => {
        console.log(`- ID: ${s.id}, Name: "${s.name}", OrgId: ${s.organizationId}`);
    });
}

listSchemas().catch(console.error);
