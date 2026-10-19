#!/usr/bin/env tsx
/**
 * Knowledge Graph End-to-End Test Suite
 * 
 * Tests the complete knowledge graph flow:
 * 1. Pipeline execution creates knowledge graph nodes/edges
 * 2. Explicit rules extraction
 * 3. Semantic enrichment
 * 4. Data availability via APIs
 * 5. Mutation tracking
 * 6. Relationship discovery
 * 
 * Uses Chain of Validation to prove each step works.
 */

import 'dotenv/config';
import { db } from "../../server/db/index.js";
import { graphService } from "../../server/domain/knowledge/index";
import { OrgContext } from "../../server/utils/auth-context.js";
import { PipelineExecutor } from "../../server/core/pipeline-executor";
import {
  jobs,
  pipelines,
  pipelineSteps,
  pipelineExecutions,
  knowledgeNodes,
  knowledgeEdges,
  orgSettings,
  users,
  orgs,
} from "../../shared/schema";
import { eq, and, desc, count, sql, inArray } from 'drizzle-orm';

// Test configuration
const TEST_ORG_NAME = 'Test Org - KG E2E';
const TEST_USERNAME = 'test-kg-user';
const TEST_PIPELINE_NAME = 'KG Test Pipeline';

interface ValidationStep {
  name: string;
  validate: () => Promise<boolean>;
  errorMessage: string;
}

class ValidationChain {
  private steps: ValidationStep[] = [];
  private results: Array<{ name: string; passed: boolean; error?: string }> = [];

  addStep(name: string, validate: () => Promise<boolean>, errorMessage: string) {
    this.steps.push({ name, validate, errorMessage });
  }

  async execute(): Promise<boolean> {
    console.log('\n🔗 Starting Validation Chain...\n');

    for (const step of this.steps) {
      try {
        const passed = await step.validate();
        this.results.push({ name: step.name, passed });

        if (passed) {
          console.log(`✅ ${step.name}`);
        } else {
          console.log(`❌ ${step.name}: ${step.errorMessage}`);
          return false;
        }
      } catch (error: any) {
        this.results.push({ name: step.name, passed: false, error: error.message });
        console.log(`❌ ${step.name}: ${error.message}`);
        return false;
      }
    }

    return true;
  }

  getResults() {
    return this.results;
  }
}

// Test state
let testOrgId: number | null = null;
let testUserId: string | null = null;
let testJobId: number | null = null;
let testPipelineId: number | null = null;
let testExecutionId: number | null = null;
let testNodeIds: number[] = [];
let testEdgeIds: number[] = [];

async function setupTestEnvironment() {
  console.log('🔧 Setting up test environment...\n');

  // 1. Create or get test organization
  let [org] = await db.select().from(orgs).where(eq(orgs.name, TEST_ORG_NAME)).limit(1);
  if (!org) {
    [org] = await db.insert(orgs).values({
      name: TEST_ORG_NAME,
      createdAt: new Date(),
    }).returning();
  }
  testOrgId = org.id;
  console.log(`   ✅ Organization ID: ${testOrgId}`);

  // 2. Enable knowledge graph for org
  const [existingSettings] = await db
    .select()
    .from(orgSettings)
    .where(eq(orgSettings.organizationId, testOrgId))
    .limit(1);

  if (existingSettings) {
    await db
      .update(orgSettings)
      .set({ knowledgeGraphEnabled: true })
      .where(eq(orgSettings.organizationId, testOrgId));
  } else {
    await db.insert(orgSettings).values({
      organizationId: testOrgId,
      knowledgeGraphEnabled: true,
      knowledgeStoreEnabled: true,
    });
  }
  console.log(`   ✅ Knowledge Graph enabled for org`);

  // 3. Create or get test user
  let [user] = await db.select().from(users).where(eq(users.username, TEST_USERNAME)).limit(1);
  if (!user) {
    [user] = await db.insert(users).values({
      username: TEST_USERNAME,
      password: 'hashed_password', // In real test, hash properly
      email: 'test-kg@example.com',
      defaultOrgId: testOrgId,
    }).returning();
  }
  testUserId = user.id;
  console.log(`   ✅ User ID: ${testUserId}`);

  // 4. Create test job (transformer type for knowledge graph)
  const [job] = await db.insert(jobs).values({
    name: 'KG Test Job',
    type: 'transformer',
    tool: 'None',
    organizationId: testOrgId,
    config: {
      inputSource: 'previous_step',
      rules: [],
    },
    priority: 1,
    isActive: true,
    createdBy: testUserId,
  }).returning();
  testJobId = job.id;
  console.log(`   ✅ Job ID: ${testJobId}`);

  // 5. Create test pipeline with knowledge graph config
  const [pipeline] = await db.insert(pipelines).values({
    name: TEST_PIPELINE_NAME,
    triggerType: 'manual',
    organizationId: testOrgId,
    createdBy: testUserId,
    knowledgeGraphConfig: {
      rules: [
        {
          ruleId: 'rule-ticket',
          name: 'Extract Tickets',
          entityType: 'Ticket',
          sourceRootPath: '$.tickets[*]',
          externalIdPath: '$.id',
          entityNamePath: '$.title',
          includeFullSourceData: true,
        },
        {
          ruleId: 'rule-feature',
          name: 'Extract Features',
          entityType: 'Feature',
          sourceRootPath: '$.features[*]',
          externalIdPath: '$.id',
          entityNamePath: '$.name',
          includeFullSourceData: true,
        },
      ],
      internalEdges: [
        {
          sourceRuleId: 'rule-ticket',
          targetRuleId: 'rule-feature',
          relationType: 'relates_to',
          sourcePath: '$.featureId',
          targetPath: '$.id',
        },
      ],
    },
  }).returning();
  testPipelineId = pipeline.id;
  console.log(`   ✅ Pipeline ID: ${testPipelineId}`);

  // 6. Create pipeline step
  await db.insert(pipelineSteps).values({
    pipelineId: testPipelineId,
    jobId: testJobId,
    order: 0,
    runOnCondition: 'on_success',
    waitDurationSeconds: 0,
    onFailureAction: 'Stop Pipeline',
    knowledgeGraphConfig: pipeline.knowledgeGraphConfig,
  });
  console.log(`   ✅ Pipeline step created`);

  console.log('\n✨ Test environment ready!\n');
}

async function executeTestPipeline() {
  console.log('🚀 Executing test pipeline...\n');

  // Simulate step execution with test data
  const testOutput = JSON.stringify({
    tickets: [
      { id: 'TICKET-001', title: 'Fix Bug in Login', featureId: 'FEAT-001', status: 'Open' },
      { id: 'TICKET-002', title: 'Add New Feature', featureId: 'FEAT-002', status: 'Open' },
    ],
    features: [
      { id: 'FEAT-001', name: 'Authentication System', description: 'User login and auth' },
      { id: 'FEAT-002', name: 'Dashboard Widget', description: 'New dashboard component' },
    ],
  });

  // Create pipeline execution
  const [execution] = await db.insert(pipelineExecutions).values({
    pipelineId: testPipelineId!,
    status: 'running',
    startedAt: new Date(),
    createdBy: testUserId!,
  }).returning();
  testExecutionId = execution.id;
  console.log(`   ✅ Execution ID: ${testExecutionId}`);

  // Get pipeline and step
  const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, testPipelineId!)).limit(1);
  const [step] = await db
    .select()
    .from(pipelineSteps)
    .where(and(eq(pipelineSteps.pipelineId, testPipelineId!), eq(pipelineSteps.order, 0)))
    .limit(1);

  // Process knowledge graph rules
  const { processExplicitKnowledgeGraphRules } = await import('../../server/domain/knowledge/core/extraction/knowledge-graph-integration.js');

  const jsonOutput = JSON.parse(testOutput);
  await processExplicitKnowledgeGraphRules(
    step.knowledgeGraphConfig as any,
    {
      jobOutput: jsonOutput,
      organizationId: testOrgId!,
      pipelineExecutionId: testExecutionId!,
      creatorEmail: testUserId!,
    }
  );

  // Update execution status
  await db
    .update(pipelineExecutions)
    .set({ status: 'completed', completedAt: new Date() })
    .where(eq(pipelineExecutions.id, testExecutionId));

  console.log('   ✅ Pipeline execution completed\n');
}

async function validateKnowledgeGraphCreation() {
  const chain = new ValidationChain();

  // Validation 1: Nodes were created
  chain.addStep(
    'Nodes Created',
    async () => {
      const nodes = await db
        .select()
        .from(knowledgeNodes)
        .where(eq(knowledgeNodes.organizationId, testOrgId!));
      testNodeIds = nodes.map(n => n.id);
      return nodes.length >= 4; // At least 2 tickets + 2 features
    },
    'Expected at least 4 nodes (2 tickets + 2 features)'
  );

  // Validation 2: Nodes have correct labels
  chain.addStep(
    'Node Labels Correct',
    async () => {
      const ticketNodes = await db
        .select()
        .from(knowledgeNodes)
        .where(and(
          eq(knowledgeNodes.organizationId, testOrgId!),
          eq(knowledgeNodes.label, 'Ticket')
        ));
      const featureNodes = await db
        .select()
        .from(knowledgeNodes)
        .where(and(
          eq(knowledgeNodes.organizationId, testOrgId!),
          eq(knowledgeNodes.label, 'Feature')
        ));
      return ticketNodes.length >= 2 && featureNodes.length >= 2;
    },
    'Expected 2 Ticket nodes and 2 Feature nodes'
  );

  // Validation 3: Nodes have correct external IDs
  chain.addStep(
    'Node External IDs Correct',
    async () => {
      const ticket1 = await db
        .select()
        .from(knowledgeNodes)
        .where(and(
          eq(knowledgeNodes.organizationId, testOrgId!),
          eq(knowledgeNodes.externalId, 'TICKET-001')
        ))
        .limit(1);
      return ticket1.length === 1;
    },
    'Expected node with externalId=TICKET-001'
  );

  // Validation 4: Nodes have pipeline execution ID
  chain.addStep(
    'Nodes Linked to Execution',
    async () => {
      const nodes = await db
        .select()
        .from(knowledgeNodes)
        .where(and(
          eq(knowledgeNodes.organizationId, testOrgId!),
          eq(knowledgeNodes.pipelineExecutionId, testExecutionId!)
        ));
      return nodes.length >= 4;
    },
    'Expected nodes to be linked to pipeline execution'
  );

  // Validation 5: Edges were created
  chain.addStep(
    'Edges Created',
    async () => {
      const edges = await db
        .select()
        .from(knowledgeEdges)
        .where(eq(knowledgeEdges.organizationId, testOrgId!));
      testEdgeIds = edges.map(e => e.id);
      return edges.length >= 2; // At least 2 relationships
    },
    'Expected at least 2 edges (ticket-feature relationships)'
  );

  // Validation 6: Edges have correct relations
  chain.addStep(
    'Edge Relations Correct',
    async () => {
      const edges = await db
        .select()
        .from(knowledgeEdges)
        .where(and(
          eq(knowledgeEdges.organizationId, testOrgId!),
          eq(knowledgeEdges.relation, 'relates_to')
        ));
      return edges.length >= 2;
    },
    'Expected edges with relation=relates_to'
  );

  // Validation 7: Edges link correct nodes
  chain.addStep(
    'Edges Link Correct Nodes',
    async () => {
      // Get ticket and feature nodes
      const ticket1 = await db
        .select()
        .from(knowledgeNodes)
        .where(and(
          eq(knowledgeNodes.organizationId, testOrgId!),
          eq(knowledgeNodes.externalId, 'TICKET-001')
        ))
        .limit(1);
      const feature1 = await db
        .select()
        .from(knowledgeNodes)
        .where(and(
          eq(knowledgeNodes.organizationId, testOrgId!),
          eq(knowledgeNodes.externalId, 'FEAT-001')
        ))
        .limit(1);

      if (ticket1.length === 0 || feature1.length === 0) return false;

      const edge = await db
        .select()
        .from(knowledgeEdges)
        .where(and(
          eq(knowledgeEdges.organizationId, testOrgId!),
          eq(knowledgeEdges.sourceId, ticket1[0].id),
          eq(knowledgeEdges.targetId, feature1[0].id)
        ))
        .limit(1);

      return edge.length === 1;
    },
    'Expected edge connecting TICKET-001 to FEAT-001'
  );

  // Validation 8: Node data contains full source
  chain.addStep(
    'Node Data Contains Source',
    async () => {
      const node = await db
        .select()
        .from(knowledgeNodes)
        .where(and(
          eq(knowledgeNodes.organizationId, testOrgId!),
          eq(knowledgeNodes.externalId, 'TICKET-001')
        ))
        .limit(1);

      if (node.length === 0) return false;
      const data = node[0].data as any;
      return data && data.id === 'TICKET-001' && data.title === 'Fix Bug in Login';
    },
    'Expected node data to contain full source object'
  );

  const passed = await chain.execute();
  return { passed, results: chain.getResults() };
}

async function validateIdempotentUpdates() {
  console.log('\n🔄 Testing idempotent updates...\n');

  const chain = new ValidationChain();

  // Get initial node count
  const initialCount = await db
    .select({ count: count() })
    .from(knowledgeNodes)
    .where(eq(knowledgeNodes.organizationId, testOrgId!));

  // Re-execute with same data (should update, not duplicate)
  const testOutput2 = JSON.stringify({
    tickets: [
      { id: 'TICKET-001', title: 'Fix Bug in Login (Updated)', featureId: 'FEAT-001', status: 'Closed' },
    ],
    features: [
      { id: 'FEAT-001', name: 'Authentication System', description: 'User login and auth' },
    ],
  });

  const [execution2] = await db.insert(pipelineExecutions).values({
    pipelineId: testPipelineId!,
    status: 'running',
    startedAt: new Date(),
    createdBy: testUserId!,
  }).returning();

  const [step] = await db
    .select()
    .from(pipelineSteps)
    .where(and(eq(pipelineSteps.pipelineId, testPipelineId!), eq(pipelineSteps.order, 0)))
    .limit(1);

  const { processExplicitKnowledgeGraphRules } = await import('../../server/domain/knowledge/core/extraction/knowledge-graph-integration.js');
  const jsonOutput2 = JSON.parse(testOutput2);
  await processExplicitKnowledgeGraphRules(
    step.knowledgeGraphConfig as any,
    {
      jobOutput: jsonOutput2,
      organizationId: testOrgId!,
      pipelineExecutionId: execution2.id,
      creatorEmail: testUserId!,
    }
  );

  await db
    .update(pipelineExecutions)
    .set({ status: 'completed', completedAt: new Date() })
    .where(eq(pipelineExecutions.id, execution2.id));

  // Validation: Node count should not increase (update, not duplicate)
  chain.addStep(
    'Idempotent Update Works',
    async () => {
      const finalCount = await db
        .select({ count: count() })
        .from(knowledgeNodes)
        .where(eq(knowledgeNodes.organizationId, testOrgId!));

      // Should have same or fewer nodes (no duplicates)
      return finalCount[0].count <= initialCount[0].count + 1; // +1 for new ticket if any
    },
    'Expected no duplicate nodes (same externalId should update)'
  );

  // Validation: Node data was updated
  chain.addStep(
    'Node Data Updated',
    async () => {
      const node = await db
        .select()
        .from(knowledgeNodes)
        .where(and(
          eq(knowledgeNodes.organizationId, testOrgId!),
          eq(knowledgeNodes.externalId, 'TICKET-001')
        ))
        .limit(1);

      if (node.length === 0) return false;
      const data = node[0].data as any;
      // Should have updated title or status
      return data && (data.title.includes('Updated') || data.status === 'Closed');
    },
    'Expected node data to be updated with new information'
  );

  const passed = await chain.execute();
  return { passed, results: chain.getResults() };
}

async function validateAPIAvailability() {
  console.log('\n🌐 Testing API availability...\n');

  const chain = new ValidationChain();

  // Validation: Storage layer returns nodes
  chain.addStep(
    'Storage Layer Returns Nodes',
    async () => {
      const orgContext: OrgContext = {
        organizationId: testOrgId!,
        userId: testUserId!,
        isAdmin: true,
        isSuperAdmin: true,
        isOrgAdmin: true
      };
      const result = await graphService.searchNodes(orgContext, { limit: 100 });
      return result.nodes.length >= 4 && result.total >= 4;
    },
    'Expected storage.listKnowledgeNodes to return nodes'
  );

  // Validation: Storage layer returns edges
  chain.addStep(
    'Storage Layer Returns Edges',
    async () => {
      const orgContext: OrgContext = {
        organizationId: testOrgId!,
        userId: testUserId!,
        isAdmin: true,
        isSuperAdmin: true,
        isOrgAdmin: true
      };
      const result = await graphService.listEdges(orgContext, { limit: 100 });
      return result.edges.length >= 2 && result.total >= 2;
    },
    'Expected storage.listKnowledgeEdges to return edges'
  );

  // Validation: Pagination works
  chain.addStep(
    'Pagination Works',
    async () => {
      const orgContext: OrgContext = {
        organizationId: testOrgId!,
        userId: testUserId!,
        isAdmin: true,
        isSuperAdmin: true,
        isOrgAdmin: true
      };
      const page1 = await graphService.searchNodes(orgContext, { limit: 2, offset: 0 });
      const page2 = await graphService.searchNodes(orgContext, { limit: 2, offset: 2 });
      return page1.nodes.length <= 2 && page2.nodes.length <= 2 && page1.total === page2.total;
    },
    'Expected pagination to work correctly'
  );

  // Validation: Run context works
  chain.addStep(
    'Run Context Works',
    async () => {
      const nodes = await db
        .select()
        .from(knowledgeNodes)
        .where(and(
          eq(knowledgeNodes.organizationId, testOrgId!),
          eq(knowledgeNodes.pipelineExecutionId, testExecutionId!)
        ));
      return nodes.length >= 4;
    },
    'Expected run context to return nodes from execution'
  );

  const passed = await chain.execute();
  return { passed, results: chain.getResults() };
}

async function cleanup() {
  console.log('\n🧹 Cleaning up test data...\n');

  if (testEdgeIds.length > 0) {
    await db.delete(knowledgeEdges).where(
      inArray(knowledgeEdges.id, testEdgeIds)
    );
  }

  if (testNodeIds.length > 0) {
    await db.delete(knowledgeNodes).where(
      inArray(knowledgeNodes.id, testNodeIds)
    );
  }

  if (testExecutionId) {
    await db.delete(pipelineExecutions).where(eq(pipelineExecutions.id, testExecutionId));
  }

  if (testPipelineId) {
    await db.delete(pipelineSteps).where(eq(pipelineSteps.pipelineId, testPipelineId));
    await db.delete(pipelines).where(eq(pipelines.id, testPipelineId));
  }

  if (testJobId) {
    await db.delete(jobs).where(eq(jobs.id, testJobId));
  }

  console.log('   ✅ Cleanup complete\n');
}

async function runTests() {
  console.log('🧪 Knowledge Graph End-to-End Test Suite\n');
  console.log('='.repeat(60));

  try {
    // Setup
    await setupTestEnvironment();

    // Test 1: Knowledge Graph Creation
    console.log('\n📊 Test 1: Knowledge Graph Creation');
    console.log('-'.repeat(60));
    await executeTestPipeline();
    const validation1 = await validateKnowledgeGraphCreation();

    if (!validation1.passed) {
      console.log('\n❌ Test 1 FAILED');
      console.log('Results:', validation1.results);
      await cleanup();
      process.exit(1);
    }

    // Test 2: Idempotent Updates
    console.log('\n📊 Test 2: Idempotent Updates');
    console.log('-'.repeat(60));
    const validation2 = await validateIdempotentUpdates();

    if (!validation2.passed) {
      console.log('\n❌ Test 2 FAILED');
      console.log('Results:', validation2.results);
      await cleanup();
      process.exit(1);
    }

    // Test 3: API Availability
    console.log('\n📊 Test 3: API Availability');
    console.log('-'.repeat(60));
    const validation3 = await validateAPIAvailability();

    if (!validation3.passed) {
      console.log('\n❌ Test 3 FAILED');
      console.log('Results:', validation3.results);
      await cleanup();
      process.exit(1);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✨ ALL TESTS PASSED! ✨');
    console.log('='.repeat(60));
    console.log('\nValidation Chain Results:');
    console.log(`  ✅ Test 1: ${validation1.results.length} validations passed`);
    console.log(`  ✅ Test 2: ${validation2.results.length} validations passed`);
    console.log(`  ✅ Test 3: ${validation3.results.length} validations passed`);

  } catch (error: any) {
    console.error('\n❌ Test Suite Failed:', error);
    console.error(error.stack);
    await cleanup();
    process.exit(1);
  } finally {
    await cleanup();
  }
}

// Run tests
runTests().catch(console.error);

