#!/usr/bin/env tsx
/**
 * Knowledge Graph Demo: Build Jobs, Pipeline, and Populate Knowledge Graph
 * 
 * This script:
 * 1. Creates a job that returns sample JSON data
 * 2. Creates a pipeline with knowledge graph configuration
 * 3. Executes the pipeline
 * 4. Verifies knowledge graph nodes and edges were created
 * 5. Displays the results
 */

import 'dotenv/config';
import { db } from "../../server/db/index.js";

import {
  jobs,
  pipelines,
  pipelineSteps,
  pipelineExecutions,
  knowledgeNodes,
  knowledgeEdges,
  orgs,
  users,
} from "../../shared/schema";
import { eq, and, desc, count } from 'drizzle-orm';

const DEMO_ORG_NAME = 'Demo Org - Knowledge Graph';
const DEMO_USERNAME = 'demo-kg-user';
const DEMO_PIPELINE_NAME = 'Knowledge Graph Demo Pipeline';

let demoOrgId: number | null = null;
let demoUserId: string | null = null;
let demoJobId: number | null = null;
let demoPipelineId: number | null = null;
let demoExecutionId: number | null = null;

async function setupDemo() {
  console.log('🔧 Setting up demo environment...\n');

  // 1. Get or create demo organization
  let [org] = await db.select().from(orgs).where(eq(orgs.name, DEMO_ORG_NAME)).limit(1);
  if (!org) {
    [org] = await db.insert(orgs).values({
      name: DEMO_ORG_NAME,
    }).returning();
  }
  demoOrgId = org.id;
  console.log(`   ✅ Organization: ${org.name} (ID: ${demoOrgId})`);

  // 2. Get or create demo user
  let [user] = await db.select().from(users).where(eq(users.username, DEMO_USERNAME)).limit(1);
  if (!user) {
    [user] = await db.insert(users).values({
      username: DEMO_USERNAME,
      password: 'demo-password-hash', // In production, hash properly
      email: 'demo-kg@example.com',
      defaultOrgId: demoOrgId,
    }).returning();
  }
  demoUserId = user.id;
  console.log(`   ✅ User: ${user.username} (ID: ${demoUserId})`);

  // 3. Create a transformer job that will output structured data
  const [job] = await db.insert(jobs).values({
    name: 'Knowledge Graph Data Generator',
    description: 'Generates sample data for knowledge graph demonstration',
    type: 'transformer',
    tool: 'None',
    organizationId: demoOrgId,
    config: {
      inputSource: 'previous_step',
      rules: [],
    },
    priority: 1,
    isActive: true,
    createdBy: demoUserId,
  }).returning();
  demoJobId = job.id;
  console.log(`   ✅ Job: ${job.name} (ID: ${demoJobId})`);

  // 4. Create pipeline with knowledge graph configuration
  const kgConfig = {
    rules: [
      {
        ruleId: 'rule-project',
        name: 'Extract Projects',
        entityType: 'Project',
        sourceRootPath: '$.projects[*]',
        externalIdPath: '$.id',
        entityNamePath: '$.name',
        includeFullSourceData: true,
      },
      {
        ruleId: 'rule-task',
        name: 'Extract Tasks',
        entityType: 'Task',
        sourceRootPath: '$.tasks[*]',
        externalIdPath: '$.id',
        entityNamePath: '$.title',
        includeFullSourceData: true,
      },
      {
        ruleId: 'rule-user',
        name: 'Extract Users',
        entityType: 'User',
        sourceRootPath: '$.users[*]',
        externalIdPath: '$.id',
        entityNamePath: '$.name',
        includeFullSourceData: true,
      },
    ],
    internalEdges: [
      {
        sourceRuleId: 'rule-task',
        targetRuleId: 'rule-project',
        relationType: 'belongs_to',
        sourcePath: '$.projectId',
        targetPath: '$.id',
      },
      {
        sourceRuleId: 'rule-task',
        targetRuleId: 'rule-user',
        relationType: 'assigned_to',
        sourcePath: '$.assigneeId',
        targetPath: '$.id',
      },
    ],
  };

  const [pipeline] = await db.insert(pipelines).values({
    name: DEMO_PIPELINE_NAME,
    description: 'Demonstrates knowledge graph population from pipeline execution',
    triggerType: 'manual',
    organizationId: demoOrgId,
    createdBy: demoUserId,
    knowledgeGraphConfig: kgConfig,
  }).returning();
  demoPipelineId = pipeline.id;
  console.log(`   ✅ Pipeline: ${pipeline.name} (ID: ${demoPipelineId})`);

  // 5. Create pipeline step
  await db.insert(pipelineSteps).values({
    pipelineId: demoPipelineId,
    jobId: demoJobId,
    order: 0,
    runOnCondition: 'on_success',
    waitDurationSeconds: 0,
    onFailureAction: 'Stop Pipeline',
    knowledgeGraphConfig: kgConfig,
  });
  console.log(`   ✅ Pipeline step created`);

  console.log('\n✨ Demo environment ready!\n');
}

async function executePipeline() {
  console.log('🚀 Executing pipeline...\n');

  // Sample data that simulates what a real job would return
  const sampleOutput = {
    projects: [
      {
        id: 'PROJ-001',
        name: 'Website Redesign',
        status: 'active',
        startDate: '2024-01-01',
        budget: 50000,
      },
      {
        id: 'PROJ-002',
        name: 'Mobile App Development',
        status: 'planning',
        startDate: '2024-02-01',
        budget: 75000,
      },
    ],
    tasks: [
      {
        id: 'TASK-001',
        title: 'Design Homepage',
        projectId: 'PROJ-001',
        assigneeId: 'USER-001',
        status: 'in_progress',
        priority: 'high',
      },
      {
        id: 'TASK-002',
        title: 'Implement Login',
        projectId: 'PROJ-001',
        assigneeId: 'USER-002',
        status: 'todo',
        priority: 'medium',
      },
      {
        id: 'TASK-003',
        title: 'API Integration',
        projectId: 'PROJ-002',
        assigneeId: 'USER-001',
        status: 'todo',
        priority: 'high',
      },
    ],
    users: [
      {
        id: 'USER-001',
        name: 'Alice Johnson',
        email: 'alice@example.com',
        role: 'Developer',
      },
      {
        id: 'USER-002',
        name: 'Bob Smith',
        email: 'bob@example.com',
        role: 'Designer',
      },
    ],
  };

  // Create pipeline execution
  const [execution] = await db.insert(pipelineExecutions).values({
    pipelineId: demoPipelineId!,
    status: 'running',
    startedAt: new Date(),
    createdBy: demoUserId!,
  }).returning();
  demoExecutionId = execution.id;
  console.log(`   ✅ Execution created (ID: ${demoExecutionId})`);

  // Get pipeline step
  const [step] = await db
    .select()
    .from(pipelineSteps)
    .where(and(eq(pipelineSteps.pipelineId, demoPipelineId!), eq(pipelineSteps.order, 0)))
    .limit(1);

  if (!step || !step.knowledgeGraphConfig) {
    throw new Error('Pipeline step or knowledge graph config not found');
  }

  // Process knowledge graph rules
  console.log('   📊 Processing knowledge graph rules...');
  const { processExplicitKnowledgeGraphRules } = await import('../../server/domain/knowledge/core/extraction/knowledge-graph-integration.js');

  await processExplicitKnowledgeGraphRules(
    step.knowledgeGraphConfig as any,
    {
      jobOutput: sampleOutput,
      organizationId: demoOrgId!,
      pipelineExecutionId: demoExecutionId,
      creatorEmail: demoUserId!,
    }
  );

  // Update execution status
  await db
    .update(pipelineExecutions)
    .set({ status: 'completed', completedAt: new Date() })
    .where(eq(pipelineExecutions.id, demoExecutionId));

  console.log('   ✅ Pipeline execution completed\n');
}

async function verifyKnowledgeGraph() {
  console.log('🔍 Verifying Knowledge Graph...\n');

  // Get all nodes
  const nodes = await db
    .select()
    .from(knowledgeNodes)
    .where(eq(knowledgeNodes.organizationId, demoOrgId!))
    .orderBy(desc(knowledgeNodes.createdAt));

  // Get all edges
  const edges = await db
    .select()
    .from(knowledgeEdges)
    .where(eq(knowledgeEdges.organizationId, demoOrgId!));

  // Count by label
  const nodesByLabel = new Map<string, number>();
  nodes.forEach(node => {
    nodesByLabel.set(node.label, (nodesByLabel.get(node.label) || 0) + 1);
  });

  // Count by relation
  const edgesByRelation = new Map<string, number>();
  edges.forEach(edge => {
    edgesByRelation.set(edge.relation, (edgesByRelation.get(edge.relation) || 0) + 1);
  });

  console.log('📊 Knowledge Graph Statistics:');
  console.log(`   Total Nodes: ${nodes.length}`);
  console.log(`   Total Edges: ${edges.length}`);
  console.log('\n   Nodes by Type:');
  nodesByLabel.forEach((count, label) => {
    console.log(`      ${label}: ${count}`);
  });
  console.log('\n   Edges by Relation:');
  edgesByRelation.forEach((count, relation) => {
    console.log(`      ${relation}: ${count}`);
  });

  console.log('\n📋 Node Details:');
  nodes.forEach(node => {
    const data = node.data as any;
    console.log(`   [${node.label}] ${node.name} (ID: ${node.externalId})`);
    if (data) {
      const keyFields = Object.keys(data).filter(k => !k.startsWith('_')).slice(0, 3);
      if (keyFields.length > 0) {
        const fields = keyFields.map(k => `${k}=${data[k]}`).join(', ');
        console.log(`      Data: ${fields}`);
      }
    }
  });

  console.log('\n🔗 Edge Details:');
  for (const edge of edges) {
    const sourceNode = nodes.find(n => n.id === edge.sourceId);
    const targetNode = nodes.find(n => n.id === edge.targetId);
    if (sourceNode && targetNode) {
      console.log(`   ${sourceNode.label}:${sourceNode.name} --[${edge.relation}]--> ${targetNode.label}:${targetNode.name}`);
    }
  }

  // Verify expected data
  console.log('\n✅ Verification:');
  const expectedNodes = {
    Project: 2,
    Task: 3,
    User: 2,
  };

  let allPassed = true;
  for (const [label, expectedCount] of Object.entries(expectedNodes)) {
    const actualCount = nodesByLabel.get(label) || 0;
    const passed = actualCount === expectedCount;
    console.log(`   ${passed ? '✅' : '❌'} ${label}: Expected ${expectedCount}, Got ${actualCount}`);
    if (!passed) allPassed = false;
  }

  const expectedEdges = {
    belongs_to: 3, // 3 tasks belong to projects
    assigned_to: 3, // 3 tasks assigned to users
  };

  for (const [relation, expectedCount] of Object.entries(expectedEdges)) {
    const actualCount = edgesByRelation.get(relation) || 0;
    const passed = actualCount === expectedCount;
    console.log(`   ${passed ? '✅' : '❌'} ${relation}: Expected ${expectedCount}, Got ${actualCount}`);
    if (!passed) allPassed = false;
  }

  return allPassed;
}

async function displayGraphVisualization() {
  console.log('\n🎨 Knowledge Graph Visualization:\n');

  const nodes = await db
    .select()
    .from(knowledgeNodes)
    .where(eq(knowledgeNodes.organizationId, demoOrgId!));

  const edges = await db
    .select()
    .from(knowledgeEdges)
    .where(eq(knowledgeEdges.organizationId, demoOrgId!));

  // Build adjacency list
  const graph: Map<number, Array<{ node: typeof nodes[0], relation: string }>> = new Map();

  nodes.forEach(node => {
    graph.set(node.id, []);
  });

  edges.forEach(edge => {
    const source = graph.get(edge.sourceId);
    const targetNode = nodes.find(n => n.id === edge.targetId);
    if (source && targetNode) {
      source.push({ node: targetNode, relation: edge.relation });
    }
  });

  // Display graph
  nodes.forEach(node => {
    const connections = graph.get(node.id) || [];
    console.log(`   ${node.label}: ${node.name} (${node.externalId})`);
    if (connections.length > 0) {
      connections.forEach(({ node: target, relation }) => {
        console.log(`      └─[${relation}]─→ ${target.label}: ${target.name}`);
      });
    }
  });
}

async function cleanup() {
  console.log('\n🧹 Cleaning up demo data...\n');

  // Get all nodes and edges created
  const nodes = await db
    .select({ id: knowledgeNodes.id })
    .from(knowledgeNodes)
    .where(eq(knowledgeNodes.organizationId, demoOrgId!));

  const edges = await db
    .select({ id: knowledgeEdges.id })
    .from(knowledgeEdges)
    .where(eq(knowledgeEdges.organizationId, demoOrgId!));

  const nodeIds = nodes.map(n => n.id);
  const edgeIds = edges.map(e => e.id);

  if (edgeIds.length > 0) {
    await db.delete(knowledgeEdges).where(
      eq(knowledgeEdges.organizationId, demoOrgId!)
    );
    console.log(`   ✅ Deleted ${edgeIds.length} edges`);
  }

  if (nodeIds.length > 0) {
    await db.delete(knowledgeNodes).where(
      eq(knowledgeNodes.organizationId, demoOrgId!)
    );
    console.log(`   ✅ Deleted ${nodeIds.length} nodes`);
  }

  if (demoExecutionId) {
    await db.delete(pipelineExecutions).where(eq(pipelineExecutions.id, demoExecutionId));
    console.log(`   ✅ Deleted execution ${demoExecutionId}`);
  }

  if (demoPipelineId) {
    await db.delete(pipelineSteps).where(eq(pipelineSteps.pipelineId, demoPipelineId));
    await db.delete(pipelines).where(eq(pipelines.id, demoPipelineId));
    console.log(`   ✅ Deleted pipeline ${demoPipelineId}`);
  }

  if (demoJobId) {
    await db.delete(jobs).where(eq(jobs.id, demoJobId));
    console.log(`   ✅ Deleted job ${demoJobId}`);
  }

  console.log('\n✨ Cleanup complete!\n');
}

async function main() {
  console.log('🎯 Knowledge Graph Demo: Build, Run, and Verify\n');
  console.log('='.repeat(60));

  try {
    // Step 1: Setup
    await setupDemo();

    // Step 2: Execute
    await executePipeline();

    // Step 3: Verify
    const verified = await verifyKnowledgeGraph();

    // Step 4: Visualize
    await displayGraphVisualization();

    // Summary
    console.log('\n' + '='.repeat(60));
    if (verified) {
      console.log('✨ SUCCESS: Knowledge Graph populated and verified! ✨');
      console.log('\n📝 Summary:');
      console.log(`   • Job ID: ${demoJobId}`);
      console.log(`   • Pipeline ID: ${demoPipelineId}`);
      console.log(`   • Execution ID: ${demoExecutionId}`);
      console.log(`   • Organization ID: ${demoOrgId}`);
      console.log('\n💡 You can now:');
      console.log('   • View the knowledge graph in the UI');
      console.log('   • Query nodes and edges via API');
      console.log('   • Use this as a template for your own pipelines');
    } else {
      console.log('⚠️  WARNING: Some verifications failed');
      console.log('   Check the output above for details');
    }
    console.log('='.repeat(60));

    // Ask if user wants to keep the data
    console.log('\n💾 Demo data has been created.');
    console.log('   Run with --keep flag to preserve the data, or');
    console.log('   it will be cleaned up automatically.\n');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Only cleanup if --keep flag is not set
    if (!process.argv.includes('--keep')) {
      await cleanup();
    } else {
      console.log('\n💾 Data preserved (--keep flag set)');
      console.log(`   • Job ID: ${demoJobId}`);
      console.log(`   • Pipeline ID: ${demoPipelineId}`);
      console.log(`   • Execution ID: ${demoExecutionId}`);
      console.log(`   • Organization ID: ${demoOrgId}`);
    }
  }
}

main().catch(console.error);

