# Oddjob AI Research - Use Cases & Tutorials

Practical examples and step-by-step tutorials for each research module.

---

## Table of Contents

1. [Enterprise Knowledge Management](#enterprise-knowledge-management)
2. [Agent Safety & Compliance](#agent-safety--compliance)
3. [Intelligent Document Processing](#intelligent-document-processing)
4. [Autonomous Mission Planning](#autonomous-mission-planning)
5. [Financial Compliance](#financial-compliance)
6. [Cross-Organization Learning](#cross-organization-learning)
7. [Causal Decision Making](#causal-decision-making)
8. [Real-Time Adaptive Systems](#real-time-adaptive-systems)
9. [Multi-Module Integration](#multi-module-integration)

---

## Enterprise Knowledge Management

**Modules**: Graph RAG

### Use Case: HR Policy Assistant

Build an assistant that answers complex HR policy questions with citations.

```typescript
import { GraphRAGService } from '@oddjob/research';

async function buildHRAssistant() {
  const service = new GraphRAGService(qdrantClient, embeddingService);

  // Query about vacation policy
  const result = await service.query({
    query: "How many vacation days do senior engineers get and what's the rollover policy?",
    organizationId: 1,
    maxHops: 3,
    topK: 5,
    includePaths: true,
    generateAnswer: true
  });

  // Build response with citations
  const response = {
    answer: result.answer,
    sources: result.traversedPaths.map(path => ({
      document: path.seedNodeId,
      section: path.targetNodeId,
      confidence: path.pathScore
    })),
    explanation: result.contextNodes.map(node => ({
      text: node.node.content.substring(0, 200),
      relevance: node.relevanceScore
    }))
  };

  return response;
}

// Example response:
// {
//   answer: "Senior engineers receive 25 vacation days annually...",
//   sources: [
//     { document: "HR_Policy_2024.pdf", section: "vacation_policy", confidence: 0.95 },
//     { document: "Benefits_Guide.pdf", section: "senior_benefits", confidence: 0.88 }
//   ],
//   explanation: [...]
// }
```

### Tutorial: Multi-hop Knowledge Discovery

**Goal**: Find indirect relationships in knowledge graph

```typescript
// Find how two employees are connected
const result = await service.query({
  query: "How is Alice in Engineering connected to Bob in Sales?",
  maxHops: 5,  // Allow deep traversal
  traversalStrategy: 'bfs',  // Breadth-first finds shortest path
  includePaths: true
});

// Analyze the connection path
const path = result.traversedPaths[0];
console.log(`Connection found: ${path.explanation}`);
// "Alice worked on Project X with Carol, who reports to Bob"
```

---

## Agent Safety & Compliance

**Modules**: Constitutional AI

### Use Case: Data Access Control

Ensure agents only access data they're authorized to see.

```typescript
import { ConstitutionalAIService } from '@oddjob/research';

async function reviewDataAccess(agentId, requestedTable, userRole) {
  const service = new ConstitutionalAIService(llmClient, constitutionRepo, eventStream);

  const action = {
    id: `access-${Date.now()}`,
    type: 'database_query',
    content: JSON.stringify({
      table: requestedTable,
      operation: 'SELECT',
      columns: ['*']
    }),
    agentId
  };

  const context = {
    agentId,
    organizationId: 1,
    userId: 'current-user',
    userRole,  // 'admin', 'manager', 'employee'
    sensitivityLevel: await getTableSensitivity(requestedTable)
  };

  const review = await service.reviewAction(action, context);

  if (!review.approved) {
    // Log violation
    await auditLog.record({
      actionId: action.id,
      violations: review.blockingViolations,
      timestamp: new Date()
    });

    // Auto-correct if possible
    if (review.finalAction) {
      return {
        allowed: true,
        modifiedQuery: review.finalAction.content,
        reason: 'Auto-corrected to comply with privacy principle'
      };
    }

    return {
      allowed: false,
      reason: review.blockingViolations[0].critique
    };
  }

  return { allowed: true };
}
```

### Tutorial: Custom Constitutional Rules

Add custom rules for your organization:

```typescript
const customRuleset = {
  id: 'fintech-rules',
  name: 'FinTech Compliance',
  principles: [
    {
      id: 'sox-compliance',
      name: 'SOX Compliance',
      description: 'All financial records access must be logged',
      category: 'compliance',
      severity: 'blocking',
      rule: 'financial_access_requires_audit_log',
      autoCorrect: false
    },
    {
      id: 'gdpr-right-to-erasure',
      name: 'GDPR Right to Erasure',
      description: 'Honor data deletion requests within 30 days',
      category: 'privacy',
      severity: 'blocking',
      rule: 'data_deletion_within_30_days',
      autoCorrect: true
    }
  ]
};

await service.loadConstitution(customRuleset);
```

---

## Intelligent Document Processing

**Modules**: Multi-Modal

### Use Case: Invoice Processing Pipeline

Automatically extract data from invoices and enter into ERP.

```typescript
import { VisionService, DocumentProcessingService } from '@oddjob/research';

async function processInvoice(pdfBuffer) {
  const vision = new VisionService(gpt4vClient);
  const docService = new DocumentProcessingService(vision);

  // Process PDF invoice
  const document = await docService.processDocument({
    source: { buffer: pdfBuffer },
    type: 'pdf',
    extractLayout: true,
    extractTables: true,
    ocr: true
  });

  // Extract key fields using vision
  const extraction = await vision.analyze({
    images: document.pages.map(p => ({ base64: p.imageBase64 })),
    prompt: `Extract invoice data:
      - Invoice Number
      - Vendor Name
      - Invoice Date
      - Due Date
      - Line Items (description, quantity, price, total)
      - Subtotal
      - Tax
      - Total Amount
      Return as JSON.`,
    model: 'gpt-4-vision',
    outputFormat: 'json'
  });

  const invoiceData = JSON.parse(extraction.structuredData);

  // Validate extracted data
  const validation = validateInvoice(invoiceData);

  return {
    data: invoiceData,
    validation,
    sourceDocument: document
  };
}
```

### Tutorial: Form Field Extraction

Extract data from scanned forms:

```typescript
async function extractFormData(formImage) {
  const vision = new VisionService(gpt4vClient);

  // Detect form fields
  const analysis = await vision.analyze({
    images: [{ base64: formImage }],
    prompt: `This is an insurance claim form. 
      Identify all filled form fields and their values.
      Pay special attention to:
      - Policy Number
      - Claim Date
      - Incident Description
      - Damage Amount`,
    model: 'gpt-4-vision',
    maxTokens: 2000
  });

  // Extract text with OCR as backup
  const ocrResult = await vision.extractText([{ base64: formImage }]);

  // Combine structured extraction with raw OCR
  return {
    structured: analysis.structuredData,
    rawText: ocrResult.fullText,
    confidence: analysis.confidence
  };
}
```

---

## Autonomous Mission Planning

**Modules**: Speculative Execution

### Use Case: Customer Onboarding Automation

Plan optimal onboarding sequence for new customers.

```typescript
import { SpeculativeExecutionService } from '@oddjob/research';

async function planOnboarding(customerProfile) {
  const service = new SpeculativeExecutionService(stateSimulator, eventStream);

  // Define available actions
  const actions = [
    { id: 'welcome_email', type: 'email', cost: 1, duration: 1 },
    { id: 'product_tour', type: 'interactive', cost: 5, duration: 10 },
    { id: 'demo_call', type: 'meeting', cost: 20, duration: 30 },
    { id: 'trial_setup', type: 'technical', cost: 10, duration: 15 },
    { id: 'follow_up', type: 'email', cost: 1, duration: 1 }
  ];

  // Create plan
  const plan = await service.plan({
    id: `onboarding-${customerProfile.id}`,
    initialState: {
      id: 'start',
      description: 'New customer signup',
      context: customerProfile
    },
    goal: "Customer completes first successful product use",
    availableActions: actions,
    constraints: {
      maxCost: 50,
      maxDuration: 60
    },
    successCriteria: {
      minEngagement: 0.7,
      requiredActions: ['product_tour']
    }
  });

  // Execute with checkpoints
  for (const action of plan.bestPlan) {
    const checkpoint = await service.createCheckpoint(
      'onboarding-agent',
      customerProfile.id,
      currentState
    );

    const result = await service.speculate({
      id: `step-${action.id}`,
      agentId: 'onboarding-agent',
      missionId: customerProfile.id,
      currentState,
      action,
      checkpointId: checkpoint.id
    });

    if (result.recommendExecution) {
      await executeAction(action);
      currentState = result.outcome;
    } else {
      // Rollback and try alternative
      await service.rollback(checkpoint.id);
      const alternative = plan.alternativePlans[0];
      // Try alternative action...
    }
  }

  return plan;
}
```

### Tutorial: Self-Healing Workflows

Build workflows that recover from failures:

```typescript
async function selfHealingWorkflow(missionId, actions) {
  const service = new SpeculativeExecutionService(stateSimulator, eventStream);

  for (const action of actions) {
    const checkpoint = await service.createCheckpoint('workflow-agent', missionId, state);

    try {
      // Speculate first
      const speculation = await service.speculate({
        id: `spec-${action.id}`,
        agentId: 'workflow-agent',
        missionId,
        currentState: state,
        action
      });

      if (speculation.success) {
        // Execute for real
        await executeAction(action);
        state = speculation.outcome;
      } else {
        // Try recovery
        console.log(`Action ${action.id} predicted to fail, attempting recovery...`);
        const recoveryAction = findRecoveryAction(action, speculation.sideEffects);

        if (recoveryAction) {
          await executeAction(recoveryAction);
        } else {
          // Rollback and escalate
          await service.rollback(checkpoint.id);
          await escalateToHuman(missionId, action, speculation);
        }
      }
    } catch (error) {
      // Rollback on actual failure
      await service.rollback(checkpoint.id);
      throw error;
    }
  }
}
```

---

## Financial Compliance

**Modules**: Neuro-Symbolic AI

### Use Case: Real-time Transaction Monitoring

Detect suspicious transactions using AML rules.

```typescript
import { HybridReasoningService } from '@oddjob/research';

async function monitorTransaction(transaction) {
  const service = new HybridReasoningService(llmClient);

  // Load AML ruleset
  service.loadDomainRuleset(amlRuleset);

  // Convert transaction to facts
  const facts = [
    {
      id: `tx-${transaction.id}`,
      predicate: 'transaction',
      arguments: [
        transaction.id,
        transaction.amount,
        transaction.sender,
        transaction.receiver,
        transaction.timestamp
      ],
      negated: false,
      source: 'extracted',
      confidence: 1.0
    },
    {
      id: `customer-${transaction.sender}`,
      predicate: 'customer',
      arguments: [transaction.sender, transaction.riskScore, transaction.country, 'business'],
      negated: false,
      source: 'extracted',
      confidence: 1.0
    }
  ];

  // Compliance check
  const result = await service.checkCompliance({
    checkType: 'aml',
    subject: {
      transactionId: transaction.id,
      customerId: transaction.sender,
      amount: transaction.amount,
      riskScore: transaction.riskScore
    },
    context: facts,
    jurisdiction: 'US',
    riskLevel: transaction.riskScore > 70 ? 'high' : 'medium'
  });

  if (!result.passed) {
    // Create SAR (Suspicious Activity Report)
    await createSAR({
      transactionId: transaction.id,
      violations: result.violations,
      riskScore: result.riskScore,
      explanation: result.explanation,
      auditTrail: result.auditTrail
    });

    // Block transaction
    return {
      action: 'BLOCK',
      reason: result.violations[0].description,
      sarId: sar.id
    };
  }

  return { action: 'ALLOW' };
}
```

### Tutorial: Custom Compliance Rules

Add custom logic rules:

```typescript
const customAMLRules = `
  % High-value transaction rule
  suspicious(TX) :- 
    transaction(TX, Amount, _, _, _),
    Amount > 10000.

  % Velocity check
  suspicious(Customer) :-
    customer(Customer, _, _, _),
    transaction_count(Customer, 1, hour, Count),
    Count > 10.

  % Structuring detection
  structuring(Customer) :-
    customer(Customer, _, _, _),
    multiple_transactions_just_below_threshold(Customer, 10000).
`;

// Load into Datalog engine
const engine = new DatalogEngine();
const { facts, rules } = engine.parseDatalog(customAMLRules);
engine.loadProgram({
  id: 'custom-aml',
  facts,
  rules,
  domain: 'aml',
  version: '1.0',
  createdAt: new Date(),
  updatedAt: new Date()
});
```

---

## Cross-Organization Learning

**Modules**: Federated Learning

### Use Case: Industry-Wide Support Agent

Train customer support agents across multiple companies.

```typescript
import { FederatedCoordinatorService } from '@oddjob/research';

async function createIndustrySupportNetwork() {
  const coordinator = new FederatedCoordinatorService(eventStream);

  // Register participating companies
  const companies = [
    { id: 'saas-corp', name: 'SaaS Corp', samples: 50000 },
    { id: 'tech-co', name: 'Tech Co', samples: 30000 },
    { id: 'cloud-inc', name: 'Cloud Inc', samples: 40000 }
  ];

  for (const company of companies) {
    await coordinator.registerOrg(
      company.id,
      company.name,
      await generatePublicKey(),
      {
        sampleCount: company.samples,
        featureCount: 128,
        dataTypes: ['text', 'categorical'],
        quality: 0.92
      }
    );
  }

  // Create federated training job
  const job = await coordinator.createJob(
    'Industry Support Agent v2.0',
    'Train collaborative support agent across SaaS industry',
    'agent_policy',
    [
      'technical_troubleshooting',
      'billing_inquiries',
      'feature_requests',
      'account_management'
    ],
    companies.map(c => c.id),
    {
      rounds: 50,
      aggregationMethod: 'fedavg',
      privacy: {
        epsilon: 0.5,
        delta: 1e-5
      }
    }
  );

  // Start training
  await coordinator.startJob(job.id);

  // Monitor progress
  return {
    jobId: job.id,
    participants: companies.length,
    expectedImprovement: '+25% accuracy vs isolated training'
  };
}
```

### Tutorial: Privacy Budget Management

Track differential privacy budget:

```typescript
// Check remaining privacy budget
const report = coordinator.generateContributionReport(
  'org-acme',
  new Date('2024-01-01'),
  new Date('2024-12-31')
);

console.log(`Privacy budget used: ${report.privacyConsumed}`);
console.log(`Remaining budget: ${1.0 - report.privacyConsumed}`);

// Adjust training based on budget
if (report.privacyConsumed > 0.8) {
  // Slow down training or request budget increase
  await adjustTrainingRate(job.id, 0.5);
}
```

---

## Causal Decision Making

**Modules**: Causal Reasoning

### Use Case: Marketing ROI Optimization

Determine true causal impact of marketing spend.

```typescript
import { CausalReasoningService } from '@oddjob/research';

async function optimizeMarketingROI() {
  const service = new CausalReasoningService(eventStream);

  // Build causal graph from data
  const graph = {
    id: 'marketing-graph',
    variables: [
      { id: 'ad_spend', name: 'Ad Spend', type: 'continuous' },
      { id: 'impressions', name: 'Impressions', type: 'continuous' },
      { id: 'clicks', name: 'Clicks', type: 'continuous' },
      { id: 'conversions', name: 'Conversions', type: 'continuous' },
      { id: 'revenue', name: 'Revenue', type: 'continuous' },
      { id: 'seasonality', name: 'Seasonality', type: 'categorical' },
      { id: 'competitor_activity', name: 'Competitor Activity', type: 'continuous' }
    ],
    edges: [
      { source: 'ad_spend', target: 'impressions', strength: 0.9 },
      { source: 'impressions', target: 'clicks', strength: 0.6 },
      { source: 'clicks', target: 'conversions', strength: 0.3 },
      { source: 'conversions', target: 'revenue', strength: 0.95 },
      { source: 'seasonality', target: 'ad_spend', strength: 0.4 },
      { source: 'seasonality', target: 'revenue', strength: 0.5 },
      { source: 'competitor_activity', target: 'revenue', strength: 0.2 }
    ]
  };

  service.loadGraph(graph);

  // Estimate ATE of $1000 increase in ad spend
  const historicalData = await loadHistoricalData();

  const ate = await service.estimateATE(
    'marketing-graph',
    'ad_spend',
    'revenue',
    historicalData
  );

  console.log(`Increasing ad spend by $1000 causes $${ate.value.toFixed(2)} increase in revenue`);
  console.log(`95% CI: [$${ate.confidenceInterval.lower.toFixed(2)}, $${ate.confidenceInterval.upper.toFixed(2)}]`);
  console.log(`P-value: ${ate.pValue}`);

  // Counterfactual: What if we spent $5000 instead of $2000?
  const counterfactual = await service.computeCounterfactual(
    'marketing-graph',
    { ad_spend: 2000, revenue: 15000 },  // What we did
    { target: 'ad_spend', value: 5000 },  // What if we spent more
    'revenue'
  );

  return {
    ate,
    counterfactual,
    recommendation: ate.value > 500 ? 'Increase spend' : 'Maintain current spend'
  };
}
```

### Tutorial: Root Cause Analysis

Analyze why a mission failed:

```typescript
async function analyzeMissionFailure(missionId, failureData) {
  const service = new CausalReasoningService(eventStream);

  // Load mission causal graph
  const missionGraph = await loadMissionGraph(missionId);
  service.loadGraph(missionGraph);

  const analysis = await service.analyzeRootCause(
    missionGraph.id,
    {
      variable: 'mission_success',
      value: 0,  // Failed
      expectedValue: 1  // Expected success
    },
    {
      pipeline_steps: failureData.steps,
      agent_performance: failureData.agentMetrics,
      external_factors: failureData.externalEvents
    }
  );

  console.log('Top root causes:');
  analysis.rootCauses.slice(0, 3).forEach((cause, i) => {
    console.log(`${i + 1}. ${cause.variable}: ${(cause.contribution * 100).toFixed(1)}% contribution`);
    console.log(`   ${cause.evidence}`);
  });

  console.log('\nRecommended interventions:');
  analysis.recommendations.forEach((rec, i) => {
    console.log(`${i + 1}. Adjust ${rec.intervention.target} to ${rec.intervention.value}`);
    console.log(`   Expected outcome improvement: ${(rec.confidence * 100).toFixed(1)}%`);
  });

  return analysis;
}
```

---

## Real-Time Adaptive Systems

**Modules**: Liquid Neural Networks

### Use Case: Adaptive Monitoring Agent

Monitor system metrics with real-time adaptation to changing conditions.

```typescript
import { LNNCoreService } from '@oddjob/research';

async function createAdaptiveMonitor() {
  const service = new LNNCoreService(eventStream);

  // Create monitoring agent
  const agent = await service.createAgent(
    'System Health Monitor',
    'monitoring',
    {
      numNeurons: 64,
      timeConstant: 0.05,  // Fast adaptation for real-time
      inputDim: 5,  // CPU, memory, disk, network, errors
      outputDim: 3  // normal, warning, critical
    },
    { realTimeAdaptation: true, edgeOptimized: true }
  );

  // Monitor loop
  setInterval(async () => {
    const metrics = await collectSystemMetrics();
    const input = [
      metrics.cpu / 100,
      metrics.memory / 100,
      metrics.disk / 100,
      metrics.network / 1000,
      metrics.errors / 100
    ];

    // Get prediction
    const result = await service.forward(agent.id, input);
    const [normal, warning, critical] = result.output;

    // Determine state
    const state = normal > warning && normal > critical ? 'normal' :
                  warning > critical ? 'warning' : 'critical';

    // Adapt if prediction was wrong
    const actualState = await getActualSystemState();
    if (state !== actualState) {
      // Online learning: adapt to new pattern
      const target = actualState === 'normal' ? [1, 0, 0] :
                     actualState === 'warning' ? [0, 1, 0] : [0, 0, 1];

      await service.adapt(agent.id, input, target);
      console.log(`Adapted to new pattern: ${actualState}`);
    }

    // Alert if critical
    if (state === 'critical') {
      await sendAlert('System critical!', metrics);
    }

  }, 1000);  // Check every second

  return agent;
}
```

### Tutorial: Edge Deployment

Deploy LNN agent to edge device:

```typescript
async function deployToEdge(agentId) {
  const service = new LNNCoreService(eventStream);

  // Optimize for edge constraints
  const edgeProfile = {
    device: 'embedded',  // Raspberry Pi class
    memoryBudget: 50,     // 50 MB
    powerBudget: 1000,    // 1W
    latencyRequirement: 50,  // 50ms
    quantizationBits: 8,   // Int8 quantization
    pruningRatio: 0.5    // Remove 50% of connections
  };

  const metrics = await service.optimizeForEdge(agentId, edgeProfile);

  console.log('Edge optimization complete:');
  console.log(`  Parameters: ${metrics.parameters}`);
  console.log(`  Size: ${(metrics.sizeBytes / 1024).toFixed(2)} KB`);
  console.log(`  Memory: ${metrics.memoryMB.toFixed(2)} MB`);
  console.log(`  vs Transformer: ${(metrics.vsTransformerRatio * 100).toFixed(0)}% smaller`);

  // Export for deployment
  const agent = service.getAgent(agentId);
  const state = service.getState(agentId);

  await exportForEdgeDeployment({
    agent,
    state,
    destination: 'edge-device-001'
  });
}
```

---

## Multi-Module Integration

**Combining Multiple Research Modules**

### Use Case: Autonomous Compliance Agent

Combine Neuro-Symbolic + Constitutional AI + Speculative Execution:

```typescript
async function autonomousComplianceAgent() {
  // Initialize services
  const neuroSymbolic = new HybridReasoningService(llmClient);
  const constitutional = new ConstitutionalAIService(llmClient, constitutionRepo, eventStream);
  const speculative = new SpeculativeExecutionService(stateSimulator, eventStream);

  // Load AML rules
  neuroSymbolic.loadDomainRuleset(amlRuleset);

  // Process transaction
  async function processTransaction(tx) {
    // Step 1: Neuro-Symbolic analysis
    const complianceCheck = await neuroSymbolic.checkCompliance({
      checkType: 'aml',
      subject: tx,
      context: await buildContext(tx)
    });

    // Step 2: Constitutional review of proposed action
    const actionReview = await constitutional.reviewAction(
      {
        id: `tx-${tx.id}`,
        type: complianceCheck.passed ? 'allow' : 'block',
        content: JSON.stringify({ transaction: tx, violations: complianceCheck.violations })
      },
      { agentId: 'compliance-agent', organizationId: 1 }
    );

    // Step 3: Speculative planning for resolution
    if (!complianceCheck.passed && actionReview.approved) {
      const resolutionPlan = await speculative.plan({
        goal: 'Resolve compliance violation while minimizing customer impact',
        availableActions: [
          { id: 'request_docs', type: 'communication' },
          { id: 'escalate', type: 'human_handoff' },
          { id: 'block', type: 'action' },
          { id: 'monitor', type: 'observation' }
        ],
        constraints: { maxCost: 100, timeLimit: 24 }
      });

      return {
        action: resolutionPlan.bestPlan[0],
        explanation: complianceCheck.explanation,
        confidence: resolutionPlan.successProbability
      };
    }

    return { action: 'allow' };
  }

  return { processTransaction };
}
```

---

## Quick Reference

### Module Selection Guide

| Use Case | Primary Module | Secondary Modules |
|----------|---------------|-------------------|
| Knowledge Q&A | Graph RAG | - |
| Agent Safety | Constitutional AI | Neuro-Symbolic |
| Document OCR | Multi-Modal | - |
| Mission Planning | Speculative Execution | - |
| Compliance Check | Neuro-Symbolic | Constitutional AI |
| Cross-Org Learning | Federated Learning | - |
| Marketing ROI | Causal Reasoning | - |
| Real-time Monitoring | Liquid Neural Networks | - |

### Performance Expectations

| Module | Latency | Throughput | Accuracy |
|--------|---------|------------|----------|
| Graph RAG | 200-500ms | 100 QPS | 85-95% |
| Constitutional AI | 100-300ms | 200 QPS | 90-95% |
| Multi-Modal | 1-5s | 20 QPS | 80-90% |
| Speculative Execution | 500ms-2s | 50 QPS | 75-85% |
| Neuro-Symbolic | 300-800ms | 100 QPS | 90-98% |
| Federated Learning | Hours (training) | N/A | +20% vs isolated |
| Causal Reasoning | 200-500ms | 100 QPS | 80-90% |
| LNN | 10-50ms | 1000 QPS | 85-95% |
