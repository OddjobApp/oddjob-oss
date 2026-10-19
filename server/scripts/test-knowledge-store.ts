/**
 * Test Script: Knowledge Store Integration
 * 
 * Tests the ingestFileToKnowledgeStore function directly
 */

import { db } from '../database_service.js';
import { knowledgeTopics, knowledgeDocuments, knowledgeTopicDocuments } from '@shared/schema/index.js';
import { ingestFileToKnowledgeStore } from "@server/knowledge/knowledge-store.js";
import { eq, desc } from 'drizzle-orm';

async function runTest() {
    console.log('=== Knowledge Store Integration Test ===\n');

    try {
        // 1. Find or create a test topic
        console.log('Step 1: Finding/creating test topic...');
        let topic = await db
            .select()
            .from(knowledgeTopics)
            .where(eq(knowledgeTopics.name, 'Test Import Topic'))
            .limit(1)
            .then(rows => rows[0]);

        if (!topic) {
            const [newTopic] = await db
                .insert(knowledgeTopics)
                .values({
                    name: 'Test Import Topic',
                    description: 'Topic for testing folder import integration',
                    createdBy: 'test@oddjob.com',
                    organizationId: null,
                })
                .returning();
            topic = newTopic;
            console.log(`  Created new topic: ${topic.id} - ${topic.name}`);
        } else {
            console.log(`  Using existing topic: ${topic.id} - ${topic.name}`);
        }

        // 2. Test ingesting a sample file
        console.log('\nStep 2: Ingesting test file...');
        const testContent = `# Sample Document

This is a test document created at ${new Date().toISOString()}.

## Key Points
- Point 1: Testing knowledge store integration
- Point 2: Folder import functionality
- Point 3: Qdrant vector indexing

## Data
- Created by: test-script
- Purpose: Integration testing
`;

        const documentId = await ingestFileToKnowledgeStore({
            content: testContent,
            title: `Test Document ${Date.now()}`,
            sourceType: 'upload',
            topicId: topic.id,
            organizationId: null,
            createdBy: 'test@oddjob.com',
            metadata: {
                source: 'test-script',
                timestamp: new Date().toISOString(),
                type: 'integration-test',
            },
        });

        console.log(`  ✅ Document created with ID: ${documentId}`);

        // 3. Verify the document was created
        console.log('\nStep 3: Verifying document...');
        const [doc] = await db
            .select()
            .from(knowledgeDocuments)
            .where(eq(knowledgeDocuments.id, documentId))
            .limit(1);

        if (doc) {
            console.log(`  ✅ Document found in database:`);
            console.log(`     - Title: ${doc.title}`);
            console.log(`     - Source Type: ${doc.sourceType}`);
            console.log(`     - Content Length: ${doc.textContent?.length || 0} chars`);
            console.log(`     - Qdrant Point ID: ${doc.qdrantPointId || 'Not indexed yet'}`);
        } else {
            console.log('  ❌ Document not found in database!');
        }

        // 4. Verify topic linkage
        console.log('\nStep 4: Verifying topic linkage...');
        const linkage = await db
            .select()
            .from(knowledgeTopicDocuments)
            .where(eq(knowledgeTopicDocuments.documentId, documentId))
            .limit(1);

        if (linkage.length > 0) {
            console.log(`  ✅ Document linked to topic ${linkage[0].topicId}`);
        } else {
            console.log('  ❌ Document not linked to any topic!');
        }

        // 5. Count documents in topic
        console.log('\nStep 5: Counting documents in topic...');
        const allDocs = await db
            .select()
            .from(knowledgeTopicDocuments)
            .where(eq(knowledgeTopicDocuments.topicId, topic.id));

        console.log(`  Total documents in "${topic.name}": ${allDocs.length}`);

        console.log('\n=== Test Completed Successfully ===');

    } catch (error) {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    }

    process.exit(0);
}

runTest();

