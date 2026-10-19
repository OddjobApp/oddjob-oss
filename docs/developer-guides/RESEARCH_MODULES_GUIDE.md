# Oddjob AI Research Modules - Developer Guide

Complete guide for using Priority 1 and Priority 2 AI research implementations.

---

## Table of Contents

1. [Overview](#overview)
2. [Priority 1: Immediate Implementation](#priority-1-immediate-implementation)
   - [Graph RAG](#graph-rag)
   - [Constitutional AI](#constitutional-ai)
   - [Multi-Modal](#multi-modal)
   - [Speculative Execution](#speculative-execution)
3. [Priority 2: Medium-Term Implementation](#priority-2-medium-term-implementation)
   - [Neuro-Symbolic AI](#neuro-symbolic-ai)
   - [Federated Learning](#federated-learning)
   - [Causal Reasoning](#causal-reasoning)
   - [Liquid Neural Networks](#liquid-neural-networks)
4. [Common Patterns](#common-patterns)
5. [Troubleshooting](#troubleshooting)

---

## Overview

The Oddjob Research API provides 8 advanced AI research modules organized into two priority tiers:

### Priority 1 (Immediate - 8-12 weeks)
- **Graph RAG**: Hybrid vector + graph search for multi-hop reasoning
- **Constitutional AI**: Agent safety with principled review
- **Multi-Modal**: Vision analysis and document processing
- **Speculative Execution**: MCTS-based planning with rollback

### Priority 2 (Medium-term - 12-24 months)
- **Neuro-Symbolic AI**: NL to logic translation with formal verification
- **Federated Learning**: Privacy-preserving collaborative training
- **Causal Reasoning**: Do-calculus for causal inference
- **Liquid Neural Networks**: Continuous-time adaptive agents

**Base URL**: `https://api.oddjob.io/v1/research`

**Authentication**: Bearer token required for all endpoints

---

## Priority 1: Immediate Implementation

### Graph RAG

**Purpose**: Combines vector similarity search with knowledge graph traversal for multi-hop reasoning and explainable retrieval.

**Use Cases**:
- Complex knowledge queries requiring context
- Explainable document retrieval
- Multi-hop fact finding
- Relationship discovery

**Quick Start**:

```typescript
import { GraphRAGService } from '@oddjob/research';

const service = new GraphRAGService(qdrantClient, embeddingService);

const result = await service.query({
  query: "What is the relationship between Alice and the Finance Department?",
  organizationId: 1,
  maxHops: 3,
  topK: 5,
  includePaths: true
});

console.log(result.answer);
console.log(result.traversedPaths);  // Explainable reasoning chain
```

**API Example**:

```bash
curl -X POST https://api.oddjob.io/v1/research/graph-rag/query \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is machine learning?",
    "maxHops": 3,
    "topK": 5,
    "traversalStrategy": "bfs",
    "includePaths": true
  }'
```

**Key Concepts**:
- **Hybrid Search**: Combines Qdrant vector search with graph traversal
- **Context Nodes**: Retrieved knowledge with relevance scores
- **Traversed Paths**: Explainable reasoning chains
- **Path Explainer**: Generates human-readable explanations

**Configuration Options**:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxHops` | 3 | Maximum graph traversal depth |
| `topK` | 5 | Number of results |
| `traversalStrategy` | bfs | dfs, bfs, or hybrid |
| `minRelationshipWeight` | 0.5 | Edge weight threshold |
| `includePaths` | true | Include reasoning paths |
| `generateAnswer` | false | Generate LLM summary |

---

### Constitutional AI

**Purpose**: Reviews agent actions against constitutional principles (privacy, security, ethics, accuracy, transparency, accountability).

**Use Cases**:
- Agent safety verification
- Compliance checking
- Action audit trails
- Automatic violation detection

**Quick Start**:

```typescript
import { ConstitutionalAIService } from '@oddjob/research';

const service = new ConstitutionalAIService(llmClient, constitutionRepo, eventStream);

const review = await service.reviewAction(
  {
    id: 'action-1',
    type: 'api_call',
    content: JSON.stringify({ endpoint: '/api/users', method: 'GET' }),
    agentId: 'agent-1'
  },
  {
    agentId: 'agent-1',
    organizationId: 1,
    userId: 'user-1',
    missionId: 'mission-1'
  }
);

if (!review.approved) {
  console.log('Violations:', review.blockingViolations);
  console.log('Revised action:', review.finalAction);
}
```

**API Example**:

```bash
curl -X POST https://api.oddjob.io/v1/research/constitutional/review \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": {
      "id": "action-1",
      "type": "data_access",
      "content": "{\"table\": \"customers\", \"columns\": [\"ssn\", \"credit_card\"]}"
    },
    "context": {
      "agentId": "agent-1",
      "organizationId": 1,
      "missionId": "mission-1"
    }
  }'
```

**Constitutional Principles**:

1. **Privacy**: No PII access without explicit consent
2. **Security**: Validate credentials and permissions
3. **Ethics**: Avoid harm, bias, discrimination
4. **Accuracy**: Verify facts before claiming
5. **Transparency**: Explain decisions and reasoning
6. **Accountability**: Log all actions with audit trail

**Review Outcomes**:
- **Approved**: Action complies with all principles
- **Auto-corrected**: Issues fixed automatically
- **Requires escalation**: Human review needed
- **Blocked**: Violations cannot be resolved

---

### Multi-Modal

**Purpose**: Vision analysis and document processing using GPT-4V, Gemini, and Claude.

**Use Cases**:
- Image analysis and description
- OCR text extraction
- PDF/Word document processing
- UI element detection
- Layout analysis

**Quick Start**:

```typescript
import { VisionService, DocumentProcessingService } from '@oddjob/research';

// Vision analysis
const vision = new VisionService(gpt4vClient);

const analysis = await vision.analyze({
  images: [{ base64: imageBase64, mimeType: 'image/png' }],
  prompt: "Extract all text and identify UI elements",
  model: 'gpt-4-vision',
  maxTokens: 2000
});

// Document processing
const documentService = new DocumentProcessingService(vision);

const doc = await documentService.processDocument({
  source: { base64: pdfBase64 },
  type: 'pdf',
  extractTables: true,
  extractLayout: true
});
```

**API Examples**:

```bash
# Vision analysis
curl -X POST https://api.oddjob.io/v1/research/multimodal/vision \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "images": [{"base64": "...", "mimeType": "image/png"}],
    "prompt": "Describe this dashboard screenshot",
    "model": "gpt-4-vision"
  }'

# OCR
curl -X POST https://api.oddjob.io/v1/research/multimodal/ocr \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "images": [{"base64": "..."}],
    "language": "auto"
  }'

# Document processing
curl -X POST https://api.oddjob.io/v1/research/multimodal/document \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "source": {"base64": "..."},
    "type": "pdf",
    "extractTables": true,
    "extractLayout": true
  }'
```

**Supported Models**:
- GPT-4V (OpenAI)
- Gemini Pro Vision (Google)
- Claude 3 Vision (Anthropic)

**Supported Document Types**:
- PDF (with OCR)
- Microsoft Word (.docx)
- Images (PNG, JPG, TIFF)

---

### Speculative Execution

**Purpose**: MCTS-based lookahead planning with speculative execution and rollback capabilities.

**Use Cases**:
- Mission planning with uncertainty
- Action sequence optimization
- Self-healing agents
- Risk assessment

**Quick Start**:

```typescript
import { SpeculativeExecutionService, MCTSEngine } from '@oddjob/research';

const service = new SpeculativeExecutionService(stateSimulator, eventStream);

// Create plan
const plan = await service.plan({
  id: 'plan-1',
  initialState: initialState,
  goal: "Complete customer onboarding",
  availableActions: [
    { id: 'a1', type: 'email', description: 'Send welcome email' },
    { id: 'a2', type: 'form', description: 'Collect KYC info' },
    { id: 'a3', type: 'verify', description: 'Verify identity' }
  ]
});

console.log('Best plan:', plan.bestPlan);
console.log('Success probability:', plan.successProbability);

// Speculative execution with checkpoint
const checkpoint = await service.createCheckpoint('agent-1', 'mission-1', currentState);

const result = await service.speculate({
  id: 'spec-1',
  agentId: 'agent-1',
  missionId: 'mission-1',
  currentState: currentState,
  action: action,
  checkpointId: checkpoint.id
});

if (!result.recommendExecution) {
  // Rollback if speculation failed
  await service.rollback(checkpoint.id);
}
```

**API Examples**:

```bash
# Create plan
curl -X POST https://api.oddjob.io/v1/research/speculative/plan \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "initialState": {...},
    "goal": "Complete customer onboarding",
    "availableActions": [...]
  }'

# Speculative execution
curl -X POST https://api.oddjob.io/v1/research/speculative/execute \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": {...},
    "currentState": {...},
    "enableRollback": true
  }'

# Rollback
curl -X POST https://api.oddjob.io/v1/research/speculative/rollback \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"checkpointId": "checkpoint-1"}'
```

**MCTS Algorithm**:
1. **Selection**: UCB1 to select promising nodes
2. **Expansion**: Add child nodes for unexplored actions
3. **Simulation**: Rollout to estimate value
4. **Backpropagation**: Update statistics up the tree

---

## Priority 2: Medium-Term Implementation

### Neuro-Symbolic AI

**Purpose**: Combines neural language understanding with symbolic reasoning for verifiable, explainable AI.

**Use Cases**:
- Financial compliance (AML/KYC)
- Legal reasoning
- Medical diagnosis verification
- Any domain requiring formal verification

**Quick Start**:

```typescript
import { HybridReasoningService, DatalogEngine } from '@oddjob/research';

const service = new HybridReasoningService(llmClient);

// Load domain ruleset
service.loadDomainRuleset(amlRuleset);

// Query with natural language
const result = await service.query({
  naturalLanguage: "Is this transaction suspicious?",
  domain: "finance",
  requiresVerification: true
});

console.log(result.naturalAnswer);
console.log(result.formalAnswer);  // Formal logic proof
console.log(result.explanation.steps);  // Step-by-step reasoning

// Direct Datalog query
const engine = new DatalogEngine();
engine.loadProgram(program);

const inference = await engine.query({
  predicate: 'suspicious',
  arguments: [{ type: 'variable', name: 'X' }]
});
```

**API Examples**:

```bash
# Neuro-symbolic query
curl -X POST https://api.oddjob.io/v1/research/neuro-symbolic/query \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Is this transaction suspicious?",
    "domain": "finance",
    "requiresVerification": true
  }'

# AML compliance
curl -X POST https://api.oddjob.io/v1/research/neuro-symbolic/compliance/aml \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": {"customerId": "C123", "amount": 50000},
    "context": [...],
    "jurisdiction": "US"
  }'
```

**Architecture**:
```
NL Query → LLM Translation → Datalog → Inference → Verified Answer
```

---

### Federated Learning

**Purpose**: Privacy-preserving collaborative machine learning across organizations.

**Use Cases**:
- Multi-organization agent training
- Privacy-preserving model improvement
- Cross-silo learning without data sharing
- Regulatory compliance (GDPR, HIPAA)

**Quick Start**:

```typescript
import { FederatedCoordinatorService } from '@oddjob/research';

const coordinator = new FederatedCoordinatorService(eventStream);

// Register organizations
await coordinator.registerOrg(
  'org-acme',
  'Acme Corp',
  publicKey,
  {
    sampleCount: 10000,
    featureCount: 50,
    dataTypes: ['numeric', 'categorical'],
    quality: 0.95
  }
);

// Create training job
const job = await coordinator.createJob(
  'Customer Support Agent',
  'Train support agents collaboratively',
  'agent_policy',
  ['support', 'troubleshooting'],
  ['org-acme', 'org-coyote'],
  { rounds: 100, aggregationMethod: 'fedavg' }
);

// Start training
await coordinator.startJob(job.id);

// Monitor progress
const metrics = coordinator.getMetrics();
```

**API Examples**:

```bash
# Register organization
curl -X POST https://api.oddjob.io/v1/research/federated/orgs \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "org-acme",
    "name": "Acme Corp",
    "publicKey": "...",
    "dataProfile": {...}
  }'

# Create job
curl -X POST https://api.oddjob.io/v1/research/federated/jobs \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Support Agent",
    "modelType": "agent_policy",
    "targetSkills": ["support"],
    "participants": ["org-acme"]
  }'

# Start job
curl -X POST https://api.oddjob.io/v1/research/federated/jobs/JOB_ID/start \
  -H "Authorization: Bearer ${TOKEN}"
```

**Privacy Guarantees**:
- Differential Privacy: ε < 1 (strong privacy)
- Secure Aggregation: Encrypted model updates
- No raw data sharing: Only gradients/models exchanged

---

### Causal Reasoning

**Purpose**: Judea Pearl's do-calculus for causal inference, counterfactuals, and root cause analysis.

**Use Cases**:
- ATE/ATT estimation
- "What if" scenario analysis
- Root cause analysis
- Marketing effectiveness

**Quick Start**:

```typescript
import { CausalReasoningService } from '@oddjob/research';

const service = new CausalReasoningService(eventStream);

// Load causal graph
service.loadGraph({
  id: 'marketing-graph',
  variables: [
    { id: 'marketing', name: 'Marketing Spend', type: 'continuous' },
    { id: 'sales', name: 'Sales', type: 'continuous' }
  ],
  edges: [
    { source: 'marketing', target: 'sales', strength: 0.7 }
  ]
});

// Estimate ATE
const ate = await service.estimateATE(
  'marketing-graph',
  'marketing',
  'sales',
  data
);

console.log(`Marketing causes ${ate.value} increase in sales`);

// Counterfactual
const scenario = await service.computeCounterfactual(
  'marketing-graph',
  { marketing: 1000, sales: 5000 },  // factual
  { target: 'marketing', value: 2000 },  // hypothetical
  'sales'
);

console.log(`If marketing was $2000, sales would be ${scenario.counterfactualOutcome.expectedValue}`);

// Root cause analysis
const causes = await service.analyzeRootCause(
  'mission-graph',
  { variable: 'failure_rate', value: 0.3, expectedValue: 0.1 },
  context
);
```

**API Examples**:

```bash
# Load graph
curl -X POST https://api.oddjob.io/v1/research/causal/graphs \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"graph": {...}}'

# Estimate ATE
curl -X POST https://api.oddjob.io/v1/research/causal/estimate/ate \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "graphId": "marketing-graph",
    "treatment": "marketing",
    "outcome": "sales",
    "data": {...}
  }'

# Counterfactual
curl -X POST https://api.oddjob.io/v1/research/causal/counterfactual \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "graphId": "marketing-graph",
    "factualEvidence": {...},
    "hypothetical": {"target": "marketing", "value": 2000},
    "outcomeVar": "sales"
  }'

# Root cause
curl -X POST https://api.oddjob.io/v1/research/causal/root-cause \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "graphId": "mission-graph",
    "outcome": {"variable": "failure_rate", "value": 0.3}
  }'
```

---

### Liquid Neural Networks

**Purpose**: MIT Liquid Neural Networks for real-time adaptive agents with continuous-time dynamics.

**Use Cases**:
- Real-time monitoring
- Adaptive prediction
- Edge deployment
- Time-series analysis

**Quick Start**:

```typescript
import { LNNCoreService } from '@oddjob/research';

const service = new LNNCoreService(eventStream);

// Create agent
const agent = await service.createAgent(
  'Traffic Monitor',
  'monitoring',
  {
    numNeurons: 64,
    timeConstant: 0.1,  // Fast adaptation
    inputDim: 10,
    outputDim: 5
  },
  { realTimeAdaptation: true, edgeOptimized: false }
);

// Real-time inference
const result = await service.forward(agent.id, inputData);
console.log(`Prediction: ${result.output}`);
console.log(`Latency: ${result.computeTimeMs}ms`);

// Adapt to new conditions
await service.adapt(agent.id, inputData, targetData);

// Optimize for edge deployment
await service.optimizeForEdge(agent.id, {
  device: 'embedded',
  memoryBudget: 50,  // MB
  latencyRequirement: 50,  // ms
  quantizationBits: 8
});
```

**API Examples**:

```bash
# Create agent
curl -X POST https://api.oddjob.io/v1/research/lnn/agents \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Traffic Monitor",
    "taskType": "monitoring",
    "config": {"numNeurons": 64, "timeConstant": 0.1}
  }'

# Forward pass
curl -X POST https://api.oddjob.io/v1/research/lnn/agents/AGENT_ID/forward \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"input": [1.0, 0.5, 0.2, 0.8, 0.3]}'

# Adapt
curl -X POST https://api.oddjob.io/v1/research/lnn/agents/AGENT_ID/adapt \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "input": [1.0, 0.5, 0.2],
    "target": [0.8, 0.3]
  }'
```

**Neural ODE Dynamics**:
```
τ * dx/dt = -x + tanh(W*x + I)
```

**Advantages over Transformers**:
- 10x smaller model size
- Real-time adaptation
- Continuous-time modeling
- Better for time-series

---

## Common Patterns

### Error Handling

All services use consistent error types:

```typescript
try {
  const result = await service.query(...);
} catch (error) {
  if (error.type === 'timeout') {
    // Handle timeout
  } else if (error.type === 'validation_failed') {
    // Handle validation error
  }
}
```

### Event Streaming

All services publish events for monitoring:

```typescript
eventStream.subscribe((event) => {
  switch (event.type) {
    case 'graphrag.query_complete':
      // Handle Graph RAG completion
      break;
    case 'constitutional.review_complete':
      // Handle review completion
      break;
  }
});
```

### Metrics Collection

```typescript
// Get metrics from any service
const metrics = service.getMetrics();

// Or via API
const response = await fetch('/api/research/{service}/metrics');
const metrics = await response.json();
```

---

## Troubleshooting

### Common Issues

**Graph RAG - No Results**
- Check `maxHops` setting (try increasing)
- Verify knowledge graph has relevant nodes
- Check `minRelationshipWeight` threshold

**Constitutional AI - Slow Reviews**
- Enable caching for repeated action types
- Use batched reviews for multiple actions
- Consider reducing number of principles checked

**Multi-Modal - Vision Errors**
- Verify image format (PNG, JPG supported)
- Check base64 encoding is correct
- Ensure image size < 10MB

**Speculative Execution - Planning Fails**
- Increase `maxDepth` for complex scenarios
- Check state simulator is properly configured
- Verify action definitions are valid

**Neuro-Symbolic - Translation Errors**
- Use simpler, more explicit natural language
- Verify domain ruleset is loaded
- Check Datalog syntax if using direct queries

**Federated Learning - Job Won't Start**
- Verify minimum participants (default: 3)
- Check all orgs are active and registered
- Verify privacy parameters are valid

**Causal Reasoning - Can't Identify Effect**
- Check for confounders in graph
- Verify backdoor paths can be blocked
- Consider using frontdoor criterion

**LNN - Divergence**
- Reduce learning rate
- Check input normalization
- Verify network size is appropriate

### Debug Mode

Enable debug logging:

```typescript
import { createLogger } from '@oddjob/utils';

const logger = createLogger('ResearchAPI', { level: 'debug' });
```

### Support

For issues and questions:
- API Documentation: `/docs/api/research-api.openapi.yaml`
- Integration Tests: `/tests/cross-domain/research-integration.test.ts`
- Admin Dashboard: `/admin/research`
