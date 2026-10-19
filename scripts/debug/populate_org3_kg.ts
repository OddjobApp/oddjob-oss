import 'dotenv/config';
import { db } from "@server/database_service.js";
import { knowledgeNodes, knowledgeEdges } from "../../shared/schema/index.js";

const ORG_ID = 3; // KUS
const ADMIN_USER = 'admin';

async function main() {
    console.log('🌱 Populating Knowledge Graph for Org 3 (KUS)...\n');

    // Create sample nodes
    const nodeData = [
        { name: 'Website Redesign', label: 'Project', externalId: 'PROJ-001', data: { status: 'active', budget: 50000 } },
        { name: 'Mobile App', label: 'Project', externalId: 'PROJ-002', data: { status: 'planning', budget: 75000 } },
        { name: 'Design Homepage', label: 'Task', externalId: 'TASK-001', data: { status: 'in_progress', priority: 'high' } },
        { name: 'Implement Login', label: 'Task', externalId: 'TASK-002', data: { status: 'todo', priority: 'medium' } },
        { name: 'API Integration', label: 'Task', externalId: 'TASK-003', data: { status: 'todo', priority: 'high' } },
        { name: 'Alice Johnson', label: 'User', externalId: 'USER-001', data: { email: 'alice@example.com', role: 'Developer' } },
        { name: 'Bob Smith', label: 'User', externalId: 'USER-002', data: { email: 'bob@example.com', role: 'Designer' } },
    ];

    const createdNodes = [];
    for (const nodeInfo of nodeData) {
        const [node] = await db.insert(knowledgeNodes).values({
            name: nodeInfo.name,
            label: nodeInfo.label,
            externalId: nodeInfo.externalId,
            data: nodeInfo.data,
            organizationId: ORG_ID,
            verificationStatus: 'verified',
            createdBy: ADMIN_USER,
        }).returning();
        createdNodes.push(node);
        console.log(`✅ Created node: ${node.label} - ${node.name}`);
    }

    // Create edges
    const edgeData = [
        { source: 'TASK-001', target: 'PROJ-001', relation: 'belongs_to' },
        { source: 'TASK-002', target: 'PROJ-001', relation: 'belongs_to' },
        { source: 'TASK-003', target: 'PROJ-002', relation: 'belongs_to' },
        { source: 'TASK-001', target: 'USER-001', relation: 'assigned_to' },
        { source: 'TASK-002', target: 'USER-002', relation: 'assigned_to' },
        { source: 'TASK-003', target: 'USER-001', relation: 'assigned_to' },
    ];

    for (const edgeInfo of edgeData) {
        const sourceNode = createdNodes.find(n => n.externalId === edgeInfo.source);
        const targetNode = createdNodes.find(n => n.externalId === edgeInfo.target);

        if (sourceNode && targetNode) {
            await db.insert(knowledgeEdges).values({
                sourceId: sourceNode.id,
                targetId: targetNode.id,
                relation: edgeInfo.relation,
                organizationId: ORG_ID,
                createdBy: ADMIN_USER,
            });
            console.log(`✅ Created edge: ${sourceNode.name} --[${edgeInfo.relation}]--> ${targetNode.name}`);
        }
    }

    console.log('\n✨ Done! Created:');
    console.log(`   • ${createdNodes.length} nodes`);
    console.log(`   • ${edgeData.length} edges`);
    console.log('\n🔍 Refresh the Knowledge Graph page to see the data!');
}

main().then(() => process.exit(0)).catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
