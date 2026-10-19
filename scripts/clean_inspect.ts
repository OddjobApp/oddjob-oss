import "dotenv/config";
import { db } from "../server/db/index.js";
import { graphSchemaDefs, users, orgs } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

async function main() {
    console.log(`Using DATABASE_URL: ${process.env.DATABASE_URL}`);
    const allUsers = await db.select().from(users);
    console.log(`Total Users: ${allUsers.length}`);
    const admin2 = allUsers.find(u => u.username === 'admin2');
    console.log(`admin2 found: ${!!admin2} (Org ID: ${admin2?.defaultOrgId})`);

    const schemas = await db.select().from(graphSchemaDefs);
    console.log(`Total Schemas: ${schemas.length}`);
    schemas.forEach(s => {
        console.log(`- [${s.id}] Name: "${s.name}", Org: ${s.organizationId}, CreatedBy: ${s.createdBy}`);
    });

    process.exit(0);
}

main().catch(console.error);
