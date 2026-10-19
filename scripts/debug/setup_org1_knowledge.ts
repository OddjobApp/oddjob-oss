// @ts-nocheck
import 'dotenv/config';
import { db } from "@server/database_service.js";
import {
    knowledgeDocuments,
    graphSchemaDefs,
    knowledgeDocumentExtractions,
    knowledgeTopics
} from '../../shared/schema/index.js';
import { eq } from 'drizzle-orm';

const ORG_ID = 1; // Acme Corp
const ADMIN_USER = 'admin';

async function main() {
    console.log('🎯 Setting up Knowledge Extraction for Org 1 (Acme Corp)\n');

    // 1. Create topics
    console.log('📚 Creating knowledge topics...');
    const topics = [
        { name: 'Engineering', description: 'Software development and technical topics' },
        { name: 'Product', description: 'Product management and features' },
        { name: 'Operations', description: 'DevOps, infrastructure, and operations' },
    ];

    for (const topic of topics) {
        const existing = await db.select()
            .from(knowledgeTopics)
            .where(eq(knowledgeTopics.name, topic.name))
            .limit(1);

        if (existing.length === 0) {
            await db.insert(knowledgeTopics).values({
                name: topic.name,
                description: topic.description,
                organizationId: ORG_ID,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            console.log(`  ✅ Created topic: ${topic.name}`);
        } else {
            console.log(`  ⏭️  Topic already exists: ${topic.name}`);
        }
    }

    // 2. Create sample documents
    console.log('\n📄 Creating sample documents...');
    const documents = [
        {
            title: 'Project Requirements',
            content: `# Website Redesign Project

## Overview
Complete redesign of the company website with modern UI/UX.

## Key Features
- Responsive design for mobile and desktop
- Improved navigation structure
- Integration with CRM system
- Performance optimization

## Team
- Alice Johnson (Lead Developer)
- Bob Smith (UI/UX Designer)
- Carol Williams (Project Manager)

## Timeline
- Phase 1: Design - 2 weeks
- Phase 2: Development - 6 weeks
- Phase 3: Testing - 2 weeks
`,
            sourceType: 'manual',
        },
        {
            title: 'Technical Architecture',
            content: `# System Architecture Document

## Technology Stack
- Frontend: React, TypeScript
- Backend: Node.js, Express
- Database: PostgreSQL
- Cache: Redis
- Queue: BullMQ

## Components
1. API Gateway
2. Authentication Service
3. Data Processing Pipeline
4. Knowledge Graph Engine

## Dependencies
- External APIs: Stripe, SendGrid
- Internal Services: User Service, Analytics Service
`,
            sourceType: 'manual',
        },
        {
            title: 'Sprint Planning Notes',
            content: `# Sprint 23 Planning

## Goals
- Complete login implementation
- Design homepage mockups
- Set up CI/CD pipeline

## Tasks
### High Priority
- TASK-001: Implement OAuth authentication
- TASK-002: Create responsive header component
- TASK-003: Configure GitHub Actions

### Medium Priority
- TASK-004: Add error logging
- TASK-005: Update documentation

## Blockers
- Waiting for API credentials from DevOps team
`,
            sourceType: 'manual',
        },
    ];

    const createdDocs = [];
    for (const doc of documents) {
        const [created] = await db.insert(knowledgeDocuments).values({
            title: doc.title,
            content: doc.content,
            sourceType: doc.sourceType,
            organizationId: ORG_ID,
            createdBy: ADMIN_USER,
        }).returning();
        createdDocs.push(created);
        console.log(`  ✅ Created document: ${doc.title} (ID: ${created.id})`);
    }

    // 3. Create graph schema
    console.log('\n🧠 Creating graph schema...');
    const [schema] = await db.insert(graphSchemaDefs).values({
        name: 'Project Knowledge Schema',
        description: 'Extracts projects, tasks, people, and technologies from documents',
        mappings: [
            {
                entityType: 'Project',
                description: 'Software projects and initiatives',
                extractionPrompt: 'Extract project names and descriptions',
            },
            {
                entityType: 'Task',
                description: 'Work items, tickets, and action items',
                extractionPrompt: 'Extract tasks, tickets, and work items with their IDs',
            },
            {
                entityType: 'Person',
                description: 'Team members and stakeholders',
                extractionPrompt: 'Extract people names and their roles',
            },
            {
                entityType: 'Technology',
                description: 'Technologies, frameworks, and tools',
                extractionPrompt: 'Extract technology names and tools mentioned',
            },
            {
                entityType: 'Component',
                description: 'System components and services',
                extractionPrompt: 'Extract system components, services, and modules',
            },
        ],
        organizationId: ORG_ID,
        createdBy: ADMIN_USER,
    }).returning();

    console.log(`  ✅ Created schema: ${schema.name} (ID: ${schema.id})`);

    // 4. Queue extractions
    console.log('\n📊 Queueing knowledge extractions...');
    for (const doc of createdDocs) {
        const [extraction] = await db.insert(knowledgeDocumentExtractions).values({
            documentId: doc.id,
            schemaId: schema.id,
            status: 'pending',
            organizationId: ORG_ID,
            createdBy: ADMIN_USER,
        }).returning();

        console.log(`  ✅ Queued extraction for "${doc.title}" (Extraction ID: ${extraction.id})`);
    }

    console.log('\n✨ Setup complete!');
    console.log('\n📋 Summary:');
    console.log(`  • Created ${topics.length} topics`);
    console.log(`  • Created ${documents.length} documents`);
    console.log(`  • Created 1 graph schema with ${schema.mappings.length} entity types`);
    console.log(`  • Queued ${createdDocs.length} extraction jobs`);
    console.log('\n⏳ Next Steps:');
    console.log('  1. The extraction worker will process these jobs automatically');
    console.log('  2. Check the Knowledge Store to see extraction progress');
    console.log('  3. Once complete, view results in Knowledge Explorer');
    console.log('\n💡 Note: Extractions require an AI provider (OpenAI/Anthropic/Google)');
    console.log('     to be configured with valid API credentials.');
}

main().then(() => process.exit(0)).catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
