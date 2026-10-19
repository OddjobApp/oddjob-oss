import "dotenv/config";
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from "../shared/schema/index";
import fs from 'fs';

async function main() {
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
    });
    const db = drizzle(pool, { schema });

    console.log("Fetching ALL schemas from graph_schema_defs...");
    const allSchemas = await db.select().from(schema.graphSchemaDefs);
    console.log(`Found ${allSchemas.length} schemas.`);

    for (const s of allSchemas) {
        console.log(`ID: ${s.id}, Name: "${s.name}", OrgId: ${s.organizationId}, CreatedBy: ${s.createdBy}`);
    }

    const allTopics = await db.select().from(schema.knowledgeTopics);
    console.log(`\nFound ${allTopics.length} topics.`);
    for (const t of allTopics) {
        console.log(`ID: ${t.id}, Name: "${t.name}", OrgId: ${t.organizationId}`);
    }

    await pool.end();
}
main();
