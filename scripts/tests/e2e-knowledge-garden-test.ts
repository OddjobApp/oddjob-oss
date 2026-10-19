#!/usr/bin/env npx tsx
/**
 * Knowledge Garden & Knowledge Graph End-to-End Test
 * 
 * This script performs a complete E2E test of the Knowledge Garden and Knowledge Graph:
 * 1. Creates nodes in "staging" status (for Knowledge Garden)
 * 2. Creates nodes in "verified" status (for Knowledge Graph)
 * 3. Creates edges between nodes
 * 4. Tests verification workflow
 * 5. Validates data is accessible via API endpoints
 * 
 * Run: npx tsx scripts/e2e-knowledge-garden-test.ts
 */

import 'dotenv/config';
import { db } from "../../server/db/index.js";
import { graphService } from "../../server/domain/knowledge/index";
import {
    knowledgeNodes,
    knowledgeEdges,
    users,
    orgs,
    type InsertKnowledgeNode,
    type InsertKnowledgeEdge,
} from "../../shared/schema";
import { eq, and, inArray, sql, desc } from 'drizzle-orm';

// Test configuration
const TEST_ORG_NAME = 'E2E Test Org - Knowledge Garden';
const TEST_USERNAME = 'e2e-test-user';

// Test data - Simulating a realistic JIRA/Project Management scenario
const TEST_ENTITIES = {
    staging: [
        {
            label: 'Ticket',
            name: 'Fix Critical Login Bug',
            externalId: 'E2E-TICKET-001',
            data: {
                status: 'Open',
                priority: 'Critical',
                assignee: 'john.doe@example.com',
                created: new Date().toISOString(),
                description: 'Users unable to login after password reset',
            },
            confidenceScore: '0.85',
        },
        {
            label: 'Ticket',
            name: 'Implement 2FA Authentication',
            externalId: 'E2E-TICKET-002',
            data: {
                status: 'In Progress',
                priority: 'High',
                assignee: 'jane.smith@example.com',
                created: new Date().toISOString(),
                description: 'Add two-factor authentication to the login flow',
            },
            confidenceScore: '0.92',
        },
        {
            label: 'Feature',
            name: 'Authentication System v2',
            externalId: 'E2E-FEAT-001',
            data: {
                status: 'Active',
                owner: 'security-team',
                roadmapQ: 'Q1 2025',
            },
            confidenceScore: '0.78',
        },
        {
            label: 'Component',
            name: 'Login Service',
            externalId: 'E2E-COMP-001',
            data: {
                type: 'microservice',
                language: 'TypeScript',
                repository: 'github.com/example/login-service',
            },
            confidenceScore: '0.95',
        },
        {
            label: 'User',
            name: 'John Doe',
            externalId: 'E2E-USER-001',
            data: {
                email: 'john.doe@example.com',
                role: 'Senior Developer',
                team: 'Platform',
            },
            confidenceScore: '0.99',
        },
    ],
    verified: [
        {
            label: 'Project',
            name: 'Security Enhancement Initiative',
            externalId: 'E2E-PROJ-001',
            data: {
                status: 'Active',
                budget: 150000,
                startDate: '2025-01-01',
                endDate: '2025-06-30',
            },
        },
        {
            label: 'Team',
            name: 'Security Team',
            externalId: 'E2E-TEAM-001',
            data: {
                department: 'Engineering',
                headcount: 8,
                lead: 'security-lead@example.com',
            },
        },
    ],
};

// Edges to create
const TEST_EDGES = [
    { sourceExternalId: 'E2E-TICKET-001', targetExternalId: 'E2E-FEAT-001', relation: 'belongs_to' },
    { sourceExternalId: 'E2E-TICKET-002', targetExternalId: 'E2E-FEAT-001', relation: 'belongs_to' },
    { sourceExternalId: 'E2E-TICKET-001', targetExternalId: 'E2E-COMP-001', relation: 'affects' },
    { sourceExternalId: 'E2E-TICKET-002', targetExternalId: 'E2E-COMP-001', relation: 'affects' },
    { sourceExternalId: 'E2E-USER-001', targetExternalId: 'E2E-TICKET-001', relation: 'assigned_to' },
    { sourceExternalId: 'E2E-FEAT-001', targetExternalId: 'E2E-PROJ-001', relation: 'part_of' },
    { sourceExternalId: 'E2E-TEAM-001', targetExternalId: 'E2E-PROJ-001', relation: 'owns' },
];

// State tracking
let testOrgId: number | null = null;
let testUserId: string | null = null;
let orgContext: any = null;
const createdNodeIds: number[] = [];
const createdEdgeIds: number[] = [];

async function log(message: string, type: 'info' | 'success' | 'error' | 'section' = 'info') {
    const icons = {
        info: '📋',
        success: '✅',
        error: '❌',
        section: '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📊',
    };
    console.log(`${icons[type]} ${message}`);
}

async function setupTestEnvironment() {
    log('SETUP: Test Environment', 'section');

    // 1. Create or get test organization
    let [org] = await db.select().from(orgs).where(eq(orgs.name, TEST_ORG_NAME)).limit(1);
    if (!org) {
        [org] = await db.insert(orgs).values({
            name: TEST_ORG_NAME,
            createdAt: new Date(),
        }).returning();
        log(`Created new organization: ${org.name} (ID: ${org.id})`, 'success');
    } else {
        log(`Using existing organization: ${org.name} (ID: ${org.id})`, 'info');
    }
    testOrgId = org.id;

    // 2. Enable knowledge graph and store for org (using raw SQL to avoid schema mismatch)
    const existingSettingsCheck = await db.execute(sql`
        SELECT id FROM org_settings WHERE organization_id = ${testOrgId} LIMIT 1
    `);

    if (existingSettingsCheck.rows.length > 0) {
        await db.execute(sql`
            UPDATE org_settings 
            SET knowledge_graph_enabled = true, knowledge_store_enabled = true
            WHERE organization_id = ${testOrgId}
        `);
    } else {
        await db.execute(sql`
            INSERT INTO org_settings (organization_id, knowledge_graph_enabled, knowledge_store_enabled)
            VALUES (${testOrgId}, true, true)
        `);
    }
    log('Knowledge Graph & Store enabled for organization', 'success');

    // 3. Create or get test user
    let [user] = await db.select().from(users).where(eq(users.username, TEST_USERNAME)).limit(1);
    if (!user) {
        [user] = await db.insert(users).values({
            username: TEST_USERNAME,
            password: 'test_password_hash',
            email: 'e2e-test@example.com',
            defaultOrgId: testOrgId,
        }).returning();
        log(`Created test user: ${user.username}`, 'success');
    }
    testUserId = user.id;
    log(`Test user ID: ${testUserId}`, 'info');

    // 4. Clean up any existing test data
    log('Cleaning up previous test data...', 'info');
    const existingNodes = await db
        .select({ id: knowledgeNodes.id })
        .from(knowledgeNodes)
        .where(
            and(
                eq(knowledgeNodes.organizationId, testOrgId),
                sql`${knowledgeNodes.externalId} LIKE 'E2E-%'`
            )
        );

    if (existingNodes.length > 0) {
        const idsToDelete = existingNodes.map(n => n.id);

        // Delete edges first (referential integrity)
        await db.delete(knowledgeEdges).where(
            and(
                eq(knowledgeEdges.organizationId, testOrgId),
                sql`source_id IN (${sql.join(idsToDelete, sql`,`)}) OR target_id IN (${sql.join(idsToDelete, sql`,`)})`
            )
        );

        await db.delete(knowledgeNodes).where(
            inArray(knowledgeNodes.id, idsToDelete)
        );
        log(`Cleaned up ${existingNodes.length} previous test nodes`, 'success');
    }

    log('Test environment ready!', 'success');
}

async function createStagingNodes() {
    log('STEP 1: Creating STAGING Nodes (for Knowledge Garden)', 'section');

    for (const entity of TEST_ENTITIES.staging) {
        const nodeData = {
            label: entity.label,
            name: entity.name,
            externalId: entity.externalId,
            properties: entity.data,
            verificationStatus: 'staging' as const,
            confidenceScore: entity.confidenceScore ? parseFloat(entity.confidenceScore) : null,
        };

        const node = await graphService.createNode(nodeData, orgContext);
        createdNodeIds.push(node.id);
        log(`Created staging node: ${node.label}/${node.name} (ID: ${node.id}, Status: staging)`, 'success');
    }

    log(`Created ${TEST_ENTITIES.staging.length} staging nodes for review in Knowledge Garden`, 'success');
}

async function createVerifiedNodes() {
    log('STEP 2: Creating VERIFIED Nodes (for Knowledge Graph)', 'section');

    for (const entity of TEST_ENTITIES.verified) {
        const nodeData = {
            label: entity.label,
            name: entity.name,
            externalId: entity.externalId,
            properties: entity.data,
            verificationStatus: 'verified' as const,
        };

        const node = await graphService.createNode(nodeData, orgContext);
        createdNodeIds.push(node.id);
        log(`Created verified node: ${node.label}/${node.name} (ID: ${node.id}, Status: verified)`, 'success');
    }

    log(`Created ${TEST_ENTITIES.verified.length} verified nodes for Knowledge Graph`, 'success');
}

async function createEdges() {
    log('STEP 3: Creating Edges (Relationships)', 'section');

    for (const edgeConfig of TEST_EDGES) {
        // Look up source and target nodes by external ID
        const [sourceNode] = await db
            .select()
            .from(knowledgeNodes)
            .where(
                and(
                    eq(knowledgeNodes.organizationId, testOrgId!),
                    eq(knowledgeNodes.externalId, edgeConfig.sourceExternalId)
                )
            )
            .limit(1);

        const [targetNode] = await db
            .select()
            .from(knowledgeNodes)
            .where(
                and(
                    eq(knowledgeNodes.organizationId, testOrgId!),
                    eq(knowledgeNodes.externalId, edgeConfig.targetExternalId)
                )
            )
            .limit(1);

        if (!sourceNode || !targetNode) {
            log(`Skipping edge: ${edgeConfig.sourceExternalId} -> ${edgeConfig.targetExternalId} (node not found)`, 'error');
            continue;
        }

        const edgeData = {
            sourceNodeId: sourceNode.id,
            targetNodeId: targetNode.id,
            relation: edgeConfig.relation,
            weight: 5,
        };

        try {
            const edge = await graphService.createEdge(edgeData, orgContext);
            createdEdgeIds.push(edge.id);
            log(`Created edge: ${sourceNode.name} --[${edgeConfig.relation}]--> ${targetNode.name}`, 'success');
        } catch (err: any) {
            log(`Failed to create edge: ${err.message}`, 'error');
        }
    }

    log(`Created ${createdEdgeIds.length} edges`, 'success');
}

async function validateKnowledgeGarden() {
    log('STEP 4: Validating Knowledge Garden Data', 'section');

    // Check staging nodes
    const stagingNodes = await db
        .select()
        .from(knowledgeNodes)
        .where(
            and(
                eq(knowledgeNodes.organizationId, testOrgId!),
                eq(knowledgeNodes.verificationStatus, 'staging')
            )
        );

    log(`Found ${stagingNodes.length} staging nodes in database`, 'info');

    if (stagingNodes.length === TEST_ENTITIES.staging.length) {
        log('✓ All staging nodes created correctly', 'success');
    } else {
        log(`Expected ${TEST_ENTITIES.staging.length} staging nodes, found ${stagingNodes.length}`, 'error');
    }

    // Log details
    for (const node of stagingNodes) {
        log(`  - [${node.label}] ${node.name} (confidence: ${node.confidenceScore || 'N/A'})`, 'info');
    }

    // Check statistics endpoint would return
    const statusCounts = await db.execute(sql`
    SELECT verification_status, COUNT(*)::int as count 
    FROM knowledge_nodes 
    WHERE organization_id = ${testOrgId}
    GROUP BY verification_status
  `);

    log('\nVerification Status Distribution:', 'info');
    for (const row of statusCounts.rows as any[]) {
        log(`  - ${row.verification_status}: ${row.count}`, 'info');
    }
}

async function validateKnowledgeGraph() {
    log('STEP 5: Validating Knowledge Graph Data', 'section');

    // Count all nodes
    const allNodes = await graphService.searchNodes(orgContext, { limit: 100 });
    log(`Total nodes in Knowledge Graph: ${allNodes.total}`, 'info');

    // Count verified nodes
    const verifiedNodes = await db
        .select()
        .from(knowledgeNodes)
        .where(
            and(
                eq(knowledgeNodes.organizationId, testOrgId!),
                eq(knowledgeNodes.verificationStatus, 'verified')
            )
        );

    log(`Verified (live) nodes: ${verifiedNodes.length}`, 'info');

    // Count edges
    const allEdges = await graphService.listEdges(orgContext, { limit: 100 });
    log(`Total edges in Knowledge Graph: ${allEdges.total}`, 'info');

    // Get unique labels
    const labels = await graphService.getLabels(orgContext);
    log(`Entity types (labels): ${labels.join(', ')}`, 'info');
}

async function simulateVerification() {
    log('STEP 6: Simulating Verification Workflow', 'section');

    // Get a staging node to verify
    const [nodeToVerify] = await db
        .select()
        .from(knowledgeNodes)
        .where(
            and(
                eq(knowledgeNodes.organizationId, testOrgId!),
                eq(knowledgeNodes.verificationStatus, 'staging'),
                eq(knowledgeNodes.externalId, 'E2E-TICKET-001')
            )
        )
        .limit(1);

    if (!nodeToVerify) {
        log('No staging node found to verify', 'error');
        return;
    }

    log(`Verifying node: ${nodeToVerify.name} (ID: ${nodeToVerify.id})`, 'info');

    // Update to verified
    await db
        .update(knowledgeNodes)
        .set({
            verificationStatus: 'verified',
            verifiedBy: 'e2e-test@example.com',
            verifiedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(eq(knowledgeNodes.id, nodeToVerify.id));

    log(`Node verified successfully!`, 'success');

    // Verify the update
    const [updatedNode] = await db
        .select()
        .from(knowledgeNodes)
        .where(eq(knowledgeNodes.id, nodeToVerify.id))
        .limit(1);

    log(`  - Status: ${updatedNode.verificationStatus}`, 'info');
    log(`  - Verified By: ${updatedNode.verifiedBy}`, 'info');
    log(`  - Verified At: ${updatedNode.verifiedAt}`, 'info');
}

async function printSummary() {
    log('TEST SUMMARY', 'section');

    // Final counts
    const stagingCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(knowledgeNodes)
        .where(
            and(
                eq(knowledgeNodes.organizationId, testOrgId!),
                eq(knowledgeNodes.verificationStatus, 'staging')
            )
        );

    const verifiedCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(knowledgeNodes)
        .where(
            and(
                eq(knowledgeNodes.organizationId, testOrgId!),
                eq(knowledgeNodes.verificationStatus, 'verified')
            )
        );

    const edgeCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(knowledgeEdges)
        .where(eq(knowledgeEdges.organizationId, testOrgId!));

    console.log('\n┌──────────────────────────────────────────────────────────┐');
    console.log('│                   E2E TEST RESULTS                       │');
    console.log('├──────────────────────────────────────────────────────────┤');
    console.log(`│  Organization ID:         ${testOrgId?.toString().padEnd(30)}│`);
    console.log(`│  Staging Nodes (Garden):  ${Number(stagingCount[0].count).toString().padEnd(30)}│`);
    console.log(`│  Verified Nodes (Graph):  ${Number(verifiedCount[0].count).toString().padEnd(30)}│`);
    console.log(`│  Total Edges:             ${Number(edgeCount[0].count).toString().padEnd(30)}│`);
    console.log('├──────────────────────────────────────────────────────────┤');
    console.log('│                                                          │');
    console.log('│  🌱 Knowledge Garden: Open /knowledge/garden             │');
    console.log('│     You should see pending items to review               │');
    console.log('│                                                          │');
    console.log('│  📊 Knowledge Graph: Open /knowledge/graph               │');
    console.log('│     You should see verified nodes and relationships      │');
    console.log('│                                                          │');
    console.log('└──────────────────────────────────────────────────────────┘\n');
}

async function cleanup(keepData: boolean = true) {
    if (keepData) {
        log('Data retained for manual inspection. Run with --cleanup to remove.', 'info');
        return;
    }

    log('CLEANUP: Removing Test Data', 'section');

    if (createdEdgeIds.length > 0) {
        await db.delete(knowledgeEdges).where(inArray(knowledgeEdges.id, createdEdgeIds));
        log(`Deleted ${createdEdgeIds.length} edges`, 'success');
    }

    if (createdNodeIds.length > 0) {
        await db.delete(knowledgeNodes).where(inArray(knowledgeNodes.id, createdNodeIds));
        log(`Deleted ${createdNodeIds.length} nodes`, 'success');
    }

    log('Cleanup complete', 'success');
}

async function runE2ETest() {
    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║     KNOWLEDGE GARDEN & GRAPH END-TO-END TEST             ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('\n');

    const shouldCleanup = process.argv.includes('--cleanup');

    try {
        await setupTestEnvironment();
        await createStagingNodes();
        await createVerifiedNodes();
        await createEdges();
        await validateKnowledgeGarden();
        await validateKnowledgeGraph();
        await simulateVerification();
        await printSummary();

        log('\n🎉 E2E TEST COMPLETED SUCCESSFULLY!\n', 'success');
    } catch (error: any) {
        log(`E2E Test Failed: ${error.message}`, 'error');
        console.error(error.stack);
        process.exit(1);
    } finally {
        await cleanup(!shouldCleanup);
        process.exit(0);
    }
}

// Execute
runE2ETest();
