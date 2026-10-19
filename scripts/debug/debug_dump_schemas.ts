import "dotenv/config";
import { db } from "@server/database_service.js";
import { graphSchemaDefs } from "@shared/schema/index.js";

async function main() {
    console.log("Dumping Graph Schema Definitions:");
    const schemas = await db.select().from(graphSchemaDefs);
    console.table(schemas.map((s: any) => ({
        id: s.id,
        name: s.name,
        orgId: s.organizationId,
        createdBy: s.createdBy
    })));
    process.exit(0);
}

main().catch(console.error);
