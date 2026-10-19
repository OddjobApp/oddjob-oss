import { db } from "@server/database_service.js";
import { graphSchemaDefs, knowledgeDocuments } from '@shared/schema/index.js';

async function debug() {
    console.log('=== Debug Extraction Schema ===\n');

    // 1. List all schemas
    const schemas = await db.select().from(graphSchemaDefs);
    console.log(`Total schemas in database: ${schemas.length}`);
    if (schemas.length === 0) {
        console.log('  ⚠️  NO SCHEMAS FOUND! This is the problem.');
        console.log('  You need to create a schema in the Knowledge Store > Schemas page first.');
    } else {
        schemas.forEach((s: any) => {
            console.log(`  - ID: ${s.id}, Name: "${s.name}", OrgId: ${s.organizationId}`);
        });
    }

    // 2. List documents
    console.log('\n=== Knowledge Documents ===');
    const docs = await db.select({
        id: knowledgeDocuments.id,
        title: knowledgeDocuments.title,
        organizationId: knowledgeDocuments.organizationId
    }).from(knowledgeDocuments).limit(10);

    docs.forEach(d => {
        console.log(`  - ID: ${d.id}, Title: "${d.title}", OrgId: ${d.organizationId}`);
    });

    process.exit(0);
}

debug().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
