import 'dotenv/config';
import { db } from "@server/database_service.js";
import { graphSchemaDefs, knowledgeDocuments, knowledgeDocumentExtractions } from '../../shared/schema/index.js';
import { eq } from 'drizzle-orm';

const ORG_ID = 3;
const ADMIN_USER = 'admin';

async function main() {
    console.log('🔧 Setting up knowledge extraction for Org 3...\n');

    // 1. Create a graph schema
    console.log('Creating graph schema...');
    const [schema] = await db.insert(graphSchemaDefs).values({
        name: 'General Knowledge Schema',
        description: 'Extracts general entities and relationships from documents',
        mappings: [
            {
                entityType: 'Concept',
                description: 'Key concepts, terms, or topics mentioned in the document',
                extractionPrompt: 'Extract important concepts, terms, or topics from this text',
            },
            {
                entityType: 'Process',
                description: 'Processes, workflows, or procedures described',
                extractionPrompt: 'Extract processes, workflows, or procedures from this text',
            },
            {
                entityType: 'Issue',
                description: 'Problems, issues, or errors mentioned',
                extractionPrompt: 'Extract problems, issues, or errors from this text',
            }
        ],
        organizationId: ORG_ID,
        createdBy: ADMIN_USER,
    }).returning();

    console.log(`✅ Created schema: ${schema.name} (ID: ${schema.id})\n`);

    // 2. Get documents
    const documents = await db.select()
        .from(knowledgeDocuments)
        .where(eq(knowledgeDocuments.organizationId, ORG_ID));

    console.log(`Found ${documents.length} documents to extract from:\n`);
    documents.forEach(doc => {
        console.log(`  • ${doc.title} (ID: ${doc.id})`);
    });

    // 3. Queue extractions
    console.log('\n📊 Queueing extractions...\n');

    for (const doc of documents) {
        const [extraction] = await db.insert(knowledgeDocumentExtractions).values({
            documentId: doc.id,
            schemaId: schema.id,
            status: 'pending',
            organizationId: ORG_ID,
            createdBy: ADMIN_USER,
        }).returning();

        console.log(`✅ Queued extraction for "${doc.title}" (Extraction ID: ${extraction.id})`);
    }

    console.log('\n✨ Extraction setup complete!');
    console.log('\nNote: The actual extraction will be processed by the background worker.');
    console.log('You can monitor progress in the Knowledge Store UI.');
    console.log('\nTo see results immediately, you can also view the existing 7 nodes');
    console.log('we created earlier in the Knowledge Explorer (Graph/3D/Matrix views).');
}

main().then(() => process.exit(0)).catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
