# Oddjob Priority 1 Research Implementation Plan

**Scope**: Graph RAG, Constitutional AI, Multi-Modal Agents, Speculative Execution  
**Timeline**: 12 weeks (Q2-Q3 2026)  
**Team**: 4 engineers (2 senior, 2 mid-level)  
**Status**: Approved for Implementation

---

## Sprint Overview

```
Week 1-3   │ Graph RAG Foundation
Week 4-6   │ Constitutional AI Safety Layer
Week 7-9   │ Multi-Modal Agent Capabilities
Week 10-12 │ Speculative Execution & Integration
```

---

## Sprint 1-3: Graph RAG Implementation

### Goal
Enhance knowledge retrieval by combining vector similarity with graph traversal, delivering 30% better accuracy for relationship-heavy queries.

### Week 1: Architecture & Setup

#### Day 1-2: Project Structure
```
server/domain/knowledge/core/graph-rag/
├── graph-rag.service.ts          # Main service
├── hybrid-search.engine.ts       # Vector + Graph combination
├── path-traversal.service.ts     # Multi-hop traversal
├── ranking.service.ts            # Result ranking & scoring
├── types.ts                      # Interfaces & types
├── index.ts                      # Public exports
└── tests/
    ├── graph-rag.service.test.ts
    └── hybrid-search.test.ts
```

#### Day 3-4: Core Types & Interfaces

**File**: `server/domain/knowledge/core/graph-rag/types.ts`

```typescript
// Graph RAG Query Types
export interface GraphRAGQuery {
  query: string;
  organizationId: number;
  maxHops: number;              // 1-3 hops (default: 2)
  topK: number;                 // Vector search seeds (default: 5)
  traversalStrategy: 'bfs' | 'dfs' | 'bidirectional';
  entityTypes?: string[];       // Filter: ['Ticket', 'Feature', 'Person']
  minRelationshipWeight: number; // Edge weight threshold
  includePaths: boolean;        // Return explanation paths
}

export interface GraphRAGResult {
  answer: string;               // Generated answer
  contextNodes: ContextNode[];  // Retrieved knowledge nodes
  traversedPaths: GraphPath[];  // Explanation trails
  metrics: GraphRAGMetrics;
}

export interface ContextNode {
  node: KnowledgeNode;
  relevanceScore: number;       // Combined vector + graph score
  hopDistance: number;          // Distance from seed entities
  incomingPaths: GraphPath[];   // How we reached this node
}

export interface GraphPath {
  edges: KnowledgeEdge[];
  pathScore: number;
  explanation: string;          // Human-readable path description
}

export interface GraphRAGMetrics {
  vectorSearchTimeMs: number;
  graphTraversalTimeMs: number;
  totalNodesVisited: number;
  totalPathsExplored: number;
  cacheHitRate: number;
}
```

#### Day 5: Hybrid Search Engine Foundation

**File**: `server/domain/knowledge/core/graph-rag/hybrid-search.engine.ts`

**Key Methods**:
- `hybridSearch(query: GraphRAGQuery): Promise<HybridSearchResult>`
- `combineScores(vectorScores: Score[], graphScores: Score[]): CombinedScore[]`
- `rankByRelevance(combined: CombinedScore[]): RankedResult[]`

### Week 2: Graph Traversal & Path Finding

#### Day 1-2: Path Traversal Service

**File**: `server/domain/knowledge/core/graph-rag/path-traversal.service.ts`

**Algorithms to Implement**:
1. **BFS Traversal**: Breadth-first for widest coverage
2. **DFS Traversal**: Depth-first for deep relationships
3. **Bidirectional**: From both seed and target (when target known)

**Optimization**:
- Early stopping when relevance drops below threshold
- Cycle detection to avoid infinite loops
- Parallel traversal for performance

#### Day 3-4: Multi-Hop Reasoning

```typescript
// 2-3 hop traversal example:
// Query: "What features are related to ticket PROJ-123?"
//
// Hop 1: Find ticket PROJ-123 (vector search)
// Hop 2: Find linked features via "RELATED_TO" edges
// Hop 3: Find epics linked to those features
// Result: Complete context chain
```

**Implementation**:
- `traverseFromSeeds(seeds: Node[], maxHops: number): TraversalResult`
- `calculatePathRelevance(path: Edge[]): number`
- `pruneLowRelevancePaths(paths: Path[], threshold: number): Path[]`

#### Day 5: Path Explanation Generation

```typescript
// Convert graph paths to human-readable explanations
// Example:
// Path: PROJ-123 --[reported_by]--> Alice --[manages]--> Team Alpha
// Explanation: "Ticket PROJ-123 was reported by Alice, who manages Team Alpha"

interface PathExplanationGenerator {
  generateExplanation(path: GraphPath): string;
  generateCitation(path: GraphPath): string; // For attribution
}
```

### Week 3: Integration & Optimization

#### Day 1-2: Graph RAG Service Integration

**File**: `server/domain/knowledge/core/graph-rag/graph-rag.service.ts`

```typescript
export class GraphRAGService {
  constructor(
    private qdrantClient: QdrantClient,
    private graphService: GraphService,
    private aiService: AIService,
    private cache: RedisCache
  ) {}

  async retrieveContext(query: GraphRAGQuery): Promise<GraphRAGResult> {
    // 1. Vector search for seed entities
    const seedEntities = await this.vectorSearch(query);
    
    // 2. Graph traversal from seeds
    const traversal = await this.traverseGraph(seedEntities, query.maxHops);
    
    // 3. Rank combined results
    const ranked = await this.rankResults(seedEntities, traversal);
    
    // 4. Generate answer with context
    const answer = await this.generateAnswer(query.query, ranked);
    
    return {
      answer,
      contextNodes: ranked.nodes,
      traversedPaths: ranked.paths,
      metrics: traversal.metrics
    };
  }
}
```

#### Day 3-4: Caching & Performance

**Optimization Strategies**:
1. **Query Result Cache**: Cache frequent queries (TTL: 1 hour)
2. **Graph Subgraph Cache**: Cache commonly traversed subgraphs
3. **Vector Index Warming**: Pre-load hot vectors
4. **Lazy Loading**: Load node details on-demand

```typescript
interface GraphRAGCache {
  // Cache key: hash of query + orgId
  getCachedResult(queryHash: string): GraphRAGResult | null;
  cacheResult(queryHash: string, result: GraphRAGResult): void;
  
  // Subgraph cache
  getSubgraphCache(nodeId: string, depth: number): Subgraph | null;
  cacheSubgraph(nodeId: string, depth: number, subgraph: Subgraph): void;
}
```

#### Day 5: API Routes & Testing

**New Routes** (`server/domain/knowledge/knowledge.route.ts`):
```typescript
// Graph RAG Query
POST /api/knowledge/graph-rag/query
Body: GraphRAGQuery
Response: GraphRAGResult

// Graph RAG Explain (show paths without generating answer)
POST /api/knowledge/graph-rag/explain
Body: { query: string, organizationId: number }
Response: { paths: GraphPath[], nodes: ContextNode[] }

// Graph RAG Metrics
GET /api/knowledge/graph-rag/metrics
Response: { avgLatency: number, cacheHitRate: number, topQueries: string[] }
```

**Tests** (`graph-rag.service.test.ts`):
- Test 2-hop traversal accuracy
- Test path explanation quality
- Test performance under load
- Test cache effectiveness

### Sprint 1 Deliverables

✅ Graph RAG service with 2-3 hop traversal  
✅ Hybrid scoring (vector + graph)  
✅ Path explanation generation  
✅ REST API endpoints  
✅ Integration tests  

---

## Sprint 4-6: Constitutional AI

### Goal
Implement agent safety layer with constitutional principles, reducing hallucinations by 50% and enabling enterprise trust.

### Week 4: Constitution Framework

#### Day 1-2: Core Types & Constitution Definition

**File**: `server/domain/agents/core/constitutional-ai/types.ts`

```typescript
// Constitutional Principle
export interface ConstitutionalPrinciple {
  id: string;
  name: string;           // e.g., "Privacy Protection"
  description: string;    // Human-readable explanation
  rule: string;          // LLM-evaluable rule
  severity: 'advisory' | 'warning' | 'blocking';
  category: 'privacy' | 'security' | 'accuracy' | 'ethics' | 'compliance';
  examples: {
    compliant: string[];
    violating: string[];
  };
}

// Pre-defined Constitutions
export const DEFAULT_CONSTITUTION: ConstitutionalPrinciple[] = [
  {
    id: 'privacy-1',
    name: 'PII Protection',
    description: 'Never expose personally identifiable information',
    rule: 'Actions must not expose PII (names, emails, SSNs, phone numbers) in outputs unless explicitly authorized',
    severity: 'blocking',
    category: 'privacy',
    examples: {
      compliant: ['The user with ID 12345 submitted feedback'],
      violating: ['John Doe (john@email.com) submitted feedback']
    }
  },
  {
    id: 'accuracy-1',
    name: 'Fact Verification',
    description: 'Verify facts before stating them as truth',
    rule: 'When making factual claims, verify against knowledge graph or indicate uncertainty',
    severity: 'warning',
    category: 'accuracy',
    examples: {
      compliant: ['According to the knowledge base, revenue was $5M (confidence: 0.92)'],
      violating: ['Revenue was exactly $5,234,123.45']
    }
  },
  {
    id: 'security-1',
    name: 'No Code Injection',
    description: 'Prevent code injection in generated outputs',
    rule: 'Generated code must not contain SQL injection, XSS, or command injection vulnerabilities',
    severity: 'blocking',
    category: 'security',
    examples: {
      compliant: ['const query = "SELECT * FROM users WHERE id = ?"; // parameterized'],
      violating: ['const query = `SELECT * FROM users WHERE id = ${userInput}`;']
    }
  }
];

export interface ConstitutionalCheck {
  action: AgentAction;
  constitution: ConstitutionalPrinciple;
  critique: string;           // LLM-generated critique
  revisedAction?: AgentAction; // Self-corrected version
  compliant: boolean;
  confidence: number;
}

export interface ConstitutionalReview {
  originalAction: AgentAction;
  checks: ConstitutionalCheck[];
  finalAction: AgentAction;
  violations: ConstitutionalCheck[];
  reviewTimeMs: number;
}
```

#### Day 3-4: Critique Engine

**File**: `server/domain/agents/core/constitutional-ai/critique.engine.ts`

```typescript
export class CritiqueEngine {
  constructor(private llmClient: LLMClient) {}

  async critiqueAction(
    action: AgentAction,
    constitution: ConstitutionalPrinciple[],
    context: AgentContext
  ): Promise<ConstitutionalCheck[]> {
    const checks: ConstitutionalCheck[] = [];
    
    for (const principle of constitution) {
      const critique = await this.generateCritique(action, principle, context);
      checks.push(critique);
    }
    
    return checks;
  }

  private async generateCritique(
    action: AgentAction,
    principle: ConstitutionalPrinciple,
    context: AgentContext
  ): Promise<ConstitutionalCheck> {
    const prompt = this.buildCritiquePrompt(action, principle, context);
    
    const response = await this.llmClient.generateStructured({
      prompt,
      schema: CritiqueSchema,
      temperature: 0.2  // Low temperature for consistent evaluation
    });
    
    return {
      action,
      constitution: principle,
      critique: response.critique,
      compliant: response.compliant,
      confidence: response.confidence,
      revisedAction: response.revisedAction
    };
  }

  private buildCritiquePrompt(
    action: AgentAction,
    principle: ConstitutionalPrinciple,
    context: AgentContext
  ): string {
    return `
You are a constitutional AI reviewer. Evaluate if the following action complies with the constitutional principle.

CONSTITUTIONAL PRINCIPLE: ${principle.name}
RULE: ${principle.rule}
SEVERITY: ${principle.severity}

AGENT ACTION:
Type: ${action.type}
Description: ${action.description}
Parameters: ${JSON.stringify(action.parameters, null, 2)}
Expected Output: ${action.expectedOutput}

CONTEXT:
Mission: ${context.missionDescription}
Organization: ${context.organizationId}
Previous Actions: ${context.history.length} steps

EXAMPLES:
Compliant: ${principle.examples.compliant.join('\n')}
Violating: ${principle.examples.violating.join('\n')}

Evaluate this action against the principle. Provide:
1. Compliant: true/false
2. Confidence: 0-1 score
3. Critique: Explanation of compliance or violation
4. Revised Action: If violating, suggest a compliant alternative
`;
  }
}
```

#### Day 5: Constitution Service

**File**: `server/domain/agents/core/constitutional-ai/constitutional-ai.service.ts`

```typescript
export class ConstitutionalAIService {
  constructor(
    private critiqueEngine: CritiqueEngine,
    private constitutionRepo: ConstitutionRepository,
    private eventStream: EventStreamService
  ) {}

  async reviewAction(
    agentId: string,
    action: AgentAction,
    organizationId: number
  ): Promise<ConstitutionalReview> {
    const startTime = Date.now();
    
    // Load organization's constitution
    const constitution = await this.constitutionRepo.load(organizationId);
    
    // Get agent context
    const context = await this.buildAgentContext(agentId);
    
    // Run critique
    const checks = await this.critiqueEngine.critiqueAction(
      action,
      constitution,
      context
    );
    
    // Determine final action
    const violations = checks.filter(c => !c.compliant && c.constitution.severity === 'blocking');
    const warnings = checks.filter(c => !c.compliant && c.constitution.severity === 'warning');
    
    let finalAction = action;
    
    if (violations.length > 0) {
      // Blocking violation: must revise or escalate
      finalAction = await this.handleBlockingViolation(action, violations);
    } else if (warnings.length > 0) {
      // Warning: revise if possible, proceed with caution
      finalAction = await this.handleWarnings(action, warnings);
    }
    
    const review: ConstitutionalReview = {
      originalAction: action,
      checks,
      finalAction,
      violations,
      reviewTimeMs: Date.now() - startTime
    };
    
    // Emit event for monitoring
    await this.eventStream.publish({
      type: 'constitutional.review_completed',
      payload: {
        agentId,
        organizationId,
        violations: violations.length,
        warnings: warnings.length,
        reviewTimeMs: review.reviewTimeMs
      }
    });
    
    return review;
  }

  private async handleBlockingViolation(
    action: AgentAction,
    violations: ConstitutionalCheck[]
  ): Promise<AgentAction> {
    // Try to use LLM to revise the action
    const revised = violations.find(v => v.revisedAction)?.revisedAction;
    
    if (revised) {
      // Re-review the revised action
      const reReview = await this.reviewAction(action.agentId, revised, action.organizationId);
      if (reReview.violations.length === 0) {
        return revised;
      }
    }
    
    // If can't revise, escalate to human
    throw new ConstitutionalViolationError({
      action,
      violations,
      message: 'Action violates constitutional principles and cannot be automatically corrected'
    });
  }
}
```

### Week 5: Integration & UI

#### Day 1-2: Agent Integration

**File**: `server/domain/agents/core/constitutional-ai/agent-integration.ts`

```typescript
// Wrap existing agent execution with constitutional review
export function withConstitutionalReview(
  agentService: AgentService,
  constitutionalService: ConstitutionalAIService
): AgentService {
  return new Proxy(agentService, {
    get(target, prop) {
      if (prop === 'executeAction') {
        return async (action: AgentAction, context: AgentContext) => {
          // Pre-execution review
          const review = await constitutionalService.reviewAction(
            context.agentId,
            action,
            context.organizationId
          );
          
          // Execute the (possibly revised) action
          const result = await target.executeAction(review.finalAction, context);
          
          // Post-execution review (outcome analysis)
          await constitutionalService.reviewOutcome(result, context);
          
          return {
            ...result,
            constitutionalReview: review
          };
        };
      }
      return target[prop];
    }
  });
}
```

#### Day 3-4: Constitution Management UI

**New Components**:

```typescript
// Constitution Editor
// File: client/src/modules/agents/components/ConstitutionEditor.tsx

interface ConstitutionEditorProps {
  organizationId: number;
  onSave: (constitution: ConstitutionalPrinciple[]) => void;
}

// Components:
// - PrincipleList: Display all principles
// - PrincipleEditor: Edit individual principle
// - RuleTester: Test actions against constitution
// - ViolationLog: View recent violations
```

**Routes**:
```typescript
// GET /api/agents/constitution - Get organization's constitution
// PUT /api/agents/constitution - Update constitution
// POST /api/agents/constitution/test - Test action against constitution
// GET /api/agents/constitution/violations - Get violation history
```

#### Day 5: Testing & Validation

**Test Cases**:
```typescript
// constitutional-ai.service.test.ts
describe('ConstitutionalAI', () => {
  it('should block PII exposure', async () => {
    const action = createAction({ output: 'User email: john@example.com' });
    const review = await service.reviewAction(agentId, action, orgId);
    expect(review.violations.length).toBeGreaterThan(0);
    expect(review.violations[0].constitution.category).toBe('privacy');
  });
  
  it('should auto-correct minor violations', async () => {
    const action = createAction({ type: 'sql_query', params: { query: 'SELECT * FROM users' } });
    const review = await service.reviewAction(agentId, action, orgId);
    expect(review.violations).toHaveLength(0);
    expect(review.finalAction).not.toEqual(action); // Was revised
  });
  
  it('should escalate blocking violations to human', async () => {
    const action = createAction({ type: 'delete_database', params: {} });
    await expect(service.reviewAction(agentId, action, orgId))
      .rejects.toThrow(ConstitutionalViolationError);
  });
});
```

### Week 6: Advanced Features

#### Day 1-2: Dynamic Constitution Learning

```typescript
// Learn from human feedback to improve constitution
export class ConstitutionLearningService {
  async analyzeFeedback(
    violation: ConstitutionalViolation,
    humanResolution: HumanResolution
  ): Promise<ConstitutionSuggestion> {
    // If humans consistently override a principle
    // → Suggest relaxing the principle
    
    // If humans consistently add new constraints
    // → Suggest adding new principles
    
    return {
      suggestionType: 'modify' | 'add' | 'remove',
      principle: ConstitutionalPrinciple,
      confidence: number
    };
  }
}
```

#### Day 3-4: Violation Analytics Dashboard

```typescript
// Metrics to track:
// - Violation rate by principle
// - False positive rate (human overrides)
// - Auto-correction success rate
// - Time spent on constitutional review
// - Most common violations by agent type

interface ViolationAnalytics {
  getViolationTrends(timeRange: DateRange): ViolationTrend[];
  getPrincipleEffectiveness(): PrincipleMetrics[];
  getAgentComplianceScores(): AgentCompliance[];
}
```

#### Day 5: Performance Optimization

**Optimization Strategies**:
1. **Parallel Critique**: Check all principles in parallel
2. **Caching**: Cache critique results for similar actions
3. **Early Exit**: Stop checking if blocking violation found
4. **Batch Review**: Review multiple actions together

### Sprint 2 Deliverables

✅ Constitutional AI service with 5+ principles  
✅ Auto-correction for minor violations  
✅ Escalation for blocking violations  
✅ Constitution management UI  
✅ Violation analytics dashboard  
✅ Integration with existing agent types  

---

## Sprint 7-9: Multi-Modal Agents

### Goal
Enable agents to process images, documents, and visual content for expanded automation capabilities.

### Week 7: Vision Foundation

#### Day 1-2: Vision Service Architecture

**File**: `server/domain/agents/core/multimodal/vision.service.ts`

```typescript
export interface VisionCapabilities {
  imageUnderstanding: boolean;
  ocr: boolean;
  objectDetection: boolean;
  visualQuestionAnswering: boolean;
  documentLayoutAnalysis: boolean;
}

export interface VisionRequest {
  images: ImageInput[];
  prompt: string;           // What to do with the images
  model: 'gpt-4-vision' | 'gemini-pro-vision' | 'claude-3-opus';
  maxTokens: number;
}

export interface VisionResponse {
  description: string;
  extractedText?: string;
  detectedObjects?: DetectedObject[];
  structuredData?: Record<string, any>;
  confidence: number;
}

export class VisionService {
  constructor(
    private openAIClient: OpenAIClient,
    private geminiClient: GeminiClient,
    private anthropicClient: AnthropicClient
  ) {}

  async analyzeImages(request: VisionRequest): Promise<VisionResponse> {
    const model = this.selectModel(request.model);
    
    switch (model) {
      case 'gpt-4-vision':
        return this.analyzeWithGPT4V(request);
      case 'gemini-pro-vision':
        return this.analyzeWithGemini(request);
      case 'claude-3-opus':
        return this.analyzeWithClaude(request);
    }
  }

  private async analyzeWithGPT4V(request: VisionRequest): Promise<VisionResponse> {
    const response = await this.openAIClient.chat.completions.create({
      model: 'gpt-4-vision-preview',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: request.prompt },
            ...request.images.map(img => ({
              type: 'image_url',
              image_url: { url: img.base64Data }
            }))
          ]
        }
      ],
      max_tokens: request.maxTokens
    });
    
    return {
      description: response.choices[0].message.content,
      confidence: 0.9
    };
  }
}
```

#### Day 3-4: Document Processing

**File**: `server/domain/agents/core/multimodal/document.service.ts`

```typescript
export interface DocumentProcessingRequest {
  document: Buffer;         // PDF, Word, etc.
  format: 'pdf' | 'docx' | 'doc' | 'tiff';
  extractLayout: boolean; // Preserve document structure
  extractTables: boolean;
  extractImages: boolean;
  ocrLanguage: string;
}

export interface ProcessedDocument {
  text: string;
  pages: Page[];
  tables: Table[];
  images: Image[];
  metadata: DocumentMetadata;
  structuredContent: DocumentNode[]; // Hierarchical structure
}

export class DocumentProcessingService {
  async processDocument(
    request: DocumentProcessingRequest
  ): Promise<ProcessedDocument> {
    // 1. Convert to images (for layout analysis)
    const pageImages = await this.convertToImages(request.document);
    
    // 2. OCR with layout preservation
    const ocrResult = await this.performLayoutAwareOCR(
      pageImages,
      request.ocrLanguage
    );
    
    // 3. Table extraction
    const tables = request.extractTables 
      ? await this.extractTables(pageImages)
      : [];
    
    // 4. Structure analysis (headings, paragraphs, lists)
    const structure = await this.analyzeDocumentStructure(ocrResult);
    
    return {
      text: ocrResult.fullText,
      pages: ocrResult.pages,
      tables,
      images: [], // Extracted images from document
      metadata: this.extractMetadata(request.document),
      structuredContent: structure
    };
  }
}
```

#### Day 5: Smart Selenium Selectors

**File**: `server/domain/agents/core/multimodal/selenium-vision.service.ts`

```typescript
// Replace brittle XPath/CSS with visual understanding
export class SeleniumVisionService {
  async findElement(
    driver: WebDriver,
    description: string,     // e.g., "blue Submit button"
    hints?: SelectorHints
  ): Promise<WebElement> {
    // 1. Take screenshot
    const screenshot = await driver.takeScreenshot();
    
    // 2. Get all interactive elements
    const elements = await driver.findElements(
      By.css('button, a, input, select, textarea')
    );
    
    // 3. Get element metadata (location, size, text)
    const elementMetadata = await Promise.all(
      elements.map(async el => ({
        element: el,
        rect: await el.getRect(),
        text: await el.getText(),
        tagName: await el.getTagName()
      }))
    );
    
    // 4. Use vision model to identify target
    const targetIndex = await this.identifyTargetWithVision(
      screenshot,
      elementMetadata,
      description
    );
    
    return elements[targetIndex];
  }

  private async identifyTargetWithVision(
    screenshot: string,
    elements: ElementMetadata[],
    description: string
  ): Promise<number> {
    // Build prompt with element locations and description
    const prompt = this.buildVisualSelectorPrompt(
      elements,
      description
    );
    
    const response = await this.visionService.analyzeImages({
      images: [{ base64Data: screenshot }],
      prompt,
      model: 'gpt-4-vision'
    });
    
    // Parse response to get element index
    return this.parseTargetIndex(response.description);
  }
}

// Usage in Selenium jobs
// Instead of: By.css("#submit-button")
// Use: await seleniumVision.findElement(driver, "blue Submit button at bottom right")
```

### Week 8: Multi-Modal Agent Integration

#### Day 1-2: Multimodal Agent Job Type

**File**: `server/domain/agents/core/multimodal/multimodal-agent.job.ts`

```typescript
export interface MultimodalAgentJobConfig {
  // Agent configuration
  systemPrompt: string;
  goal: string;
  
  // Vision capabilities
  visionEnabled: boolean;
  visionModel: 'gpt-4-vision' | 'gemini-pro-vision';
  
  // Document processing
  documentProcessingEnabled: boolean;
  documentTypes: string[];  // ['pdf', 'docx', 'tiff']
  
  // Input handling
  inputSources: {
    text?: string;
    imageUrls?: string[];
    documentIds?: number[];  // Reference to File records
    screenshots?: boolean;   // Auto-capture during Selenium
  };
  
  // Output configuration
  outputFormat: 'text' | 'structured' | 'document';
}

export class MultimodalAgentJobExecutor {
  constructor(
    private visionService: VisionService,
    private documentService: DocumentProcessingService,
    private agentService: AgentService
  ) {}

  async execute(config: MultimodalAgentJobConfig): Promise<JobResult> {
    // 1. Gather all inputs
    const inputs = await this.gatherInputs(config.inputSources);
    
    // 2. Process documents if any
    const processedDocs = config.documentProcessingEnabled
      ? await this.processDocuments(inputs.documents)
      : [];
    
    // 3. Analyze images if any
    const imageAnalysis = config.visionEnabled && inputs.images.length > 0
      ? await this.analyzeImages(inputs.images, config.goal)
      : null;
    
    // 4. Build rich context for agent
    const context = this.buildMultimodalContext(
      inputs.text,
      processedDocs,
      imageAnalysis
    );
    
    // 5. Execute agent with multimodal context
    const result = await this.agentService.execute({
      systemPrompt: config.systemPrompt,
      goal: config.goal,
      context,
      tools: this.getMultimodalTools(config)
    });
    
    return {
      output: result.output,
      metadata: {
        documentsProcessed: processedDocs.length,
        imagesAnalyzed: inputs.images.length,
        tokensUsed: result.tokensUsed
      }
    };
  }
}
```

#### Day 3-4: Visual Knowledge Extraction

**File**: `server/domain/agents/core/multimodal/visual-knowledge.service.ts`

```typescript
// Extract knowledge graph entities from visual content
export class VisualKnowledgeExtractionService {
  async extractFromImage(
    image: ImageInput,
    context: ExtractionContext
  ): Promise<ExtractedKnowledge> {
    // 1. Analyze image with vision model
    const analysis = await this.visionService.analyzeImages({
      images: [image],
      prompt: `
        Analyze this image and identify:
        1. People (names if visible)
        2. Organizations
        3. Locations
        4. Events
        5. Documents/forms
        6. Key objects or artifacts
        
        Also identify relationships between these entities.
      `,
      model: 'gpt-4-vision'
    });
    
    // 2. Parse structured entities
    const entities = this.parseEntities(analysis.description);
    
    // 3. Create knowledge nodes
    const nodes = await Promise.all(
      entities.map(e => this.createKnowledgeNode(e, context))
    );
    
    // 4. Create relationships
    const edges = await this.createRelationships(entities, nodes);
    
    return { nodes, edges };
  }

  // Example use case:
  // Upload a photo from a conference
  // → Extract: People met, companies represented, topics discussed
  // → Auto-populate knowledge graph with relationships
}
```

#### Day 5: API & Integration

**New Routes**:
```typescript
// Vision analysis
POST /api/agents/multimodal/vision
Body: { images: string[], prompt: string, model: string }
Response: VisionResponse

// Document processing
POST /api/agents/multimodal/documents
Body: { fileId: number, extractLayout: boolean, extractTables: boolean }
Response: ProcessedDocument

// Visual Selenium selector
POST /api/agents/multimodal/selenium/select
Body: { sessionId: string, description: string }
Response: { selector: string, confidence: number }

// Visual knowledge extraction
POST /api/agents/multimodal/extract-knowledge
Body: { imageUrl: string, context: object }
Response: { nodes: KnowledgeNode[], edges: KnowledgeEdge[] }
```

### Week 9: Testing & Optimization

#### Day 1-3: Comprehensive Testing

**Test Scenarios**:
```typescript
// Vision tests
describe('VisionService', () => {
  it('should identify UI elements from screenshots', async () => {
    const screenshot = await loadTestImage('login-page.png');
    const result = await visionService.analyzeImages({
      images: [screenshot],
      prompt: 'Find the username input field'
    });
    expect(result.description).toContain('username');
  });
  
  it('should extract text from document images', async () => {
    const invoice = await loadTestImage('invoice.png');
    const result = await visionService.analyzeImages({
      images: [invoice],
      prompt: 'Extract the invoice number, date, and total amount'
    });
    expect(result.structuredData).toHaveProperty('invoiceNumber');
  });
});

// Document processing tests
describe('DocumentProcessingService', () => {
  it('should preserve table structure in PDFs', async () => {
    const pdf = await loadTestPDF('report.pdf');
    const result = await documentService.processDocument({
      document: pdf,
      format: 'pdf',
      extractTables: true
    });
    expect(result.tables).toHaveLength(3);
    expect(result.tables[0].rows).toBeDefined();
  });
});

// Selenium vision tests
describe('SeleniumVisionService', () => {
  it('should find elements by visual description', async () => {
    const mockDriver = createMockDriver();
    const element = await seleniumVision.findElement(
      mockDriver,
      'blue Submit button'
    );
    expect(element).toBeDefined();
  });
});
```

#### Day 4-5: Cost Optimization & Caching

**Strategies**:
```typescript
// Vision result caching
interface VisionCache {
  key: string;  // hash of image + prompt
  result: VisionResponse;
  ttl: number;  // 24 hours
}

// Model selection based on task complexity
function selectVisionModel(task: VisionTask): VisionModel {
  if (task.requiresOCR && task.hasComplexLayout) {
    return 'gpt-4-vision';  // Best accuracy
  }
  if (task.isSimpleClassification) {
    return 'gemini-pro-vision';  // Faster, cheaper
  }
  return 'claude-3-opus';  // Balanced
}

// Batch processing for cost efficiency
async function batchProcessImages(
  images: ImageInput[],
  prompt: string
): Promise<VisionResponse[]> {
  // Process multiple images in single API call when possible
  // Reduces per-image overhead
}
```

### Sprint 3 Deliverables

✅ Vision service with GPT-4V, Gemini, Claude support  
✅ Document processing with layout preservation  
✅ Smart Selenium selectors (visual-based)  
✅ Visual knowledge extraction  
✅ Multimodal agent job type  
✅ Cost optimization & caching  

---

## Sprint 10-12: Speculative Execution

### Goal
Implement MCTS-based speculative planning for agents to explore multiple futures and select optimal action sequences.

### Week 10: MCTS Foundation

#### Day 1-2: MCTS Core Algorithm

**File**: `server/domain/agents/core/speculative/mcts.engine.ts`

```typescript
// Monte Carlo Tree Search for Agent Planning

interface MCTSNode {
  state: AgentState;
  action?: AgentAction;
  parent?: MCTSNode;
  children: MCTSNode[];
  visits: number;
  reward: number;
  untriedActions: AgentAction[];
}

interface MCTSConfig {
  iterations: number;       // Number of simulations (default: 100)
  explorationConstant: number; // UCB1 exploration parameter (default: 1.414)
  maxDepth: number;         // Maximum simulation depth
  rolloutPolicy: 'random' | 'heuristic' | 'llm-guided';
}

export class MCTSEngine {
  constructor(
    private agentSimulator: AgentSimulator,
    private rewardFunction: RewardFunction,
    private config: MCTSConfig
  ) {}

  async search(rootState: AgentState): Promise<AgentAction> {
    const root: MCTSNode = {
      state: rootState,
      children: [],
      visits: 0,
      reward: 0,
      untriedActions: await this.getPossibleActions(rootState)
    };

    for (let i = 0; i < this.config.iterations; i++) {
      // 1. Selection: Traverse tree using UCB1
      const node = this.select(root);
      
      // 2. Expansion: Add child if untried actions exist
      const expanded = await this.expand(node);
      
      // 3. Simulation: Rollout to terminal state
      const reward = await this.simulate(expanded);
      
      // 4. Backpropagation: Update rewards up the tree
      this.backpropagate(expanded, reward);
    }

    // Return action with highest visit count (most robust)
    return this.bestAction(root);
  }

  private select(node: MCTSNode): MCTSNode {
    // UCB1 formula: reward/visits + c * sqrt(ln(parent_visits) / visits)
    while (node.children.length > 0 && node.untriedActions.length === 0) {
      node = this.selectBestChild(node);
    }
    return node;
  }

  private async expand(node: MCTSNode): Promise<MCTSNode> {
    if (node.untriedActions.length === 0) return node;
    
    const action = node.untriedActions.pop()!;
    const newState = await this.agentSimulator.simulateAction(
      node.state,
      action
    );
    
    const child: MCTSNode = {
      state: newState,
      action,
      parent: node,
      children: [],
      visits: 0,
      reward: 0,
      untriedActions: await this.getPossibleActions(newState)
    };
    
    node.children.push(child);
    return child;
  }

  private async simulate(node: MCTSNode): Promise<number> {
    // Rollout: simulate random/heuristic actions to terminal state
    let currentState = node.state;
    let depth = 0;
    
    while (!this.isTerminal(currentState) && depth < this.config.maxDepth) {
      const actions = await this.getPossibleActions(currentState);
      const action = this.selectRolloutAction(actions);
      currentState = await this.agentSimulator.simulateAction(currentState, action);
      depth++;
    }
    
    return this.rewardFunction.calculate(currentState);
  }

  private backpropagate(node: MCTSNode, reward: number): void {
    let current: MCTSNode | undefined = node;
    while (current) {
      current.visits++;
      current.reward += reward;
      current = current.parent;
    }
  }
}
```

#### Day 3-4: Agent Simulator

**File**: `server/domain/agents/core/speculative/agent-simulator.ts`

```typescript
// Fast-forward agent execution for simulation
export class AgentSimulator {
  constructor(
    private toolSimulator: ToolSimulator,
    private llmClient: LLMClient
  ) {}

  async simulateAction(
    state: AgentState,
    action: AgentAction
  ): Promise<AgentState> {
    // Simulate without actual side effects
    switch (action.type) {
      case 'tool_call':
        return this.simulateToolCall(state, action);
      case 'llm_thinking':
        return this.simulateLLMThinking(state, action);
      case 'api_call':
        return this.simulateAPICall(state, action);
      default:
        return state;
    }
  }

  private async simulateToolCall(
    state: AgentState,
    action: AgentAction
  ): Promise<AgentState> {
    // Use tool simulator (mock or cached results)
    const result = await this.toolSimulator.simulate(
      action.toolName,
      action.parameters
    );
    
    return {
      ...state,
      toolResults: [...state.toolResults, result],
      stepCount: state.stepCount + 1
    };
  }

  private async simulateLLMThinking(
    state: AgentState,
    action: AgentAction
  ): Promise<AgentState> {
    // Fast LLM call for simulation (lower quality, faster speed)
    const thought = await this.llmClient.generate({
      prompt: action.prompt,
      model: 'gpt-3.5-turbo',  // Cheaper for simulation
      maxTokens: 150
    });
    
    return {
      ...state,
      thoughts: [...state.thoughts, thought],
      stepCount: state.stepCount + 1
    };
  }
}
```

#### Day 5: Reward Function

**File**: `server/domain/agents/core/speculative/reward-function.ts`

```typescript
export interface RewardFunction {
  calculate(state: AgentState): number;  // 0-1 score
}

export class CompositeRewardFunction implements RewardFunction {
  constructor(private components: RewardComponent[]) {}

  calculate(state: AgentState): number {
    let totalReward = 0;
    let totalWeight = 0;
    
    for (const component of this.components) {
      const reward = component.calculate(state);
      totalReward += reward * component.weight;
      totalWeight += component.weight;
    }
    
    return totalReward / totalWeight;
  }
}

// Reward Components
export class SuccessReward implements RewardComponent {
  calculate(state: AgentState): number {
    return state.goalAchieved ? 1.0 : 0.0;
  }
  weight = 0.5;
}

export class EfficiencyReward implements RewardComponent {
  calculate(state: AgentState): number {
    // Reward fewer steps, less token usage
    const stepEfficiency = 1 / (1 + state.stepCount * 0.1);
    const costEfficiency = 1 / (1 + state.tokensUsed * 0.0001);
    return (stepEfficiency + costEfficiency) / 2;
  }
  weight = 0.3;
}

export class SafetyReward implements RewardComponent {
  constructor(private constitutionService: ConstitutionalAIService) {}
  
  async calculate(state: AgentState): Promise<number> {
    // Check if all actions were constitutionally compliant
    const violations = await this.constitutionService.checkViolations(
      state.actionHistory
    );
    return violations.length === 0 ? 1.0 : 0.0;
  }
  weight = 0.2;
}
```

### Week 11: Speculative Execution Service

#### Day 1-2: Speculative Planner

**File**: `server/domain/agents/core/speculative/speculative-planner.service.ts`

```typescript
export class SpeculativePlannerService {
  constructor(
    private mctsEngine: MCTSEngine,
    private agentSimulator: AgentSimulator,
    private eventStream: EventStreamService
  ) {}

  async planWithSpeculation(
    goal: string,
    initialState: AgentState,
    options: SpeculativeOptions
  ): Promise<SpeculativePlan> {
    // 1. Build MCTS tree
    const bestAction = await this.mctsEngine.search(initialState);
    
    // 2. Generate full plan by recursively applying MCTS
    const plan = await this.generateFullPlan(
      initialState,
      bestAction,
      options.depth
    );
    
    // 3. Calculate rollback points
    const rollbackPoints = this.identifyRollbackPoints(plan);
    
    return {
      actions: plan,
      rollbackPoints,
      expectedReward: plan.expectedReward,
      alternatives: plan.alternativeBranches
    };
  }

  async executeWithRollback(
    plan: SpeculativePlan,
    onStepComplete: (step: number, result: StepResult) => void
  ): Promise<ExecutionResult> {
    const executedSteps: ExecutedStep[] = [];
    
    for (let i = 0; i < plan.actions.length; i++) {
      const action = plan.actions[i];
      
      try {
        const result = await this.executeAction(action);
        executedSteps.push({ action, result, success: true });
        onStepComplete(i, result);
        
        // Check if we need to switch to alternative branch
        if (this.shouldSwitchBranch(result, plan, i)) {
          const alternative = this.findAlternativeBranch(plan, i);
          if (alternative) {
            // Rollback and switch
            await this.rollbackToPoint(plan.rollbackPoints[i]);
            return this.executeWithRollback(alternative, onStepComplete);
          }
        }
      } catch (error) {
        // Execution failed - try to rollback and retry
        const rollbackPoint = plan.rollbackPoints[i];
        if (rollbackPoint) {
          await this.rollbackToPoint(rollbackPoint);
          const retryPlan = this.generateRetryPlan(plan, i, error);
          return this.executeWithRollback(retryPlan, onStepComplete);
        }
        throw error;
      }
    }
    
    return { steps: executedSteps, success: true };
  }
}
```

#### Day 3-4: Rollback & Recovery

```typescript
interface RollbackPoint {
  stepIndex: number;
  stateSnapshot: AgentState;
  sideEffectsToUndo: SideEffect[];
}

interface SideEffect {
  type: 'database_write' | 'api_call' | 'file_operation' | 'notification';
  undoAction: UndoAction;
  executedAt: Date;
}

export class RollbackService {
  async createRollbackPoint(
    state: AgentState,
    pendingAction: AgentAction
  ): Promise<RollbackPoint> {
    // 1. Snapshot current state
    const snapshot = await this.snapshotService.create(state);
    
    // 2. Record potential side effects
    const sideEffects = this.predictSideEffects(pendingAction);
    
    return {
      stepIndex: state.stepCount,
      stateSnapshot: snapshot,
      sideEffectsToUndo: sideEffects
    };
  }

  async rollbackToPoint(point: RollbackPoint): Promise<void> {
    // 1. Undo side effects in reverse order
    for (const effect of point.sideEffectsToUndo.reverse()) {
      await this.undoSideEffect(effect);
    }
    
    // 2. Restore state
    await this.snapshotService.restore(point.stateSnapshot);
  }

  private async undoSideEffect(effect: SideEffect): Promise<void> {
    switch (effect.type) {
      case 'database_write':
        await this.undoDatabaseWrite(effect.undoAction);
        break;
      case 'api_call':
        await this.undoAPICall(effect.undoAction);
        break;
      // ... other cases
    }
  }
}
```

#### Day 5: Visualization & Monitoring

```typescript
// Real-time speculative execution visualization
interface SpeculativeExecutionView {
  currentPlan: PlanView;
  alternativeBranches: BranchView[];
  exploredPaths: number;
  simulationAccuracy: number;
  currentRollbackPoint?: RollbackPoint;
}

// Dashboard components:
// - Decision tree visualization
// - Live simulation results
// - Rollback event log
// - Performance metrics
```

### Week 12: Integration & Final Testing

#### Day 1-3: Integration with Existing Systems

**Integration Points**:
1. **Mission System**: Speculative planning for complex missions
2. **Agent Jobs**: Speculative execution option in agent job config
3. **Pipeline Steps**: Speculative node for conditional planning
4. **HIL Integration**: Human approval for branch switches

```typescript
// New job type: speculative_agent
interface SpeculativeAgentJob extends AgentJob {
  speculationConfig: {
    enabled: boolean;
    iterations: number;
    maxDepth: number;
    allowRollback: boolean;
    requireApprovalForBranchSwitch: boolean;
  };
}
```

#### Day 4: Performance Optimization

**Optimizations**:
- **Parallel Simulation**: Run multiple rollouts in parallel
- **Cached Simulations**: Reuse simulation results
- **Early Termination**: Stop unpromising branches early
- **Approximate Models**: Use faster, approximate models for simulation

#### Day 5: Final Testing & Documentation

**Test Scenarios**:
- Simple 2-step planning
- Complex 10-step mission with branches
- Rollback and recovery scenarios
- Performance under load
- Comparison with non-speculative execution

**Documentation**:
- API reference
- Configuration guide
- Best practices
- Troubleshooting

### Sprint 4 Deliverables

✅ MCTS planning engine  
✅ Agent simulator for fast rollouts  
✅ Speculative execution service  
✅ Rollback and recovery mechanisms  
✅ Real-time visualization  
✅ Integration with mission system  

---

## Integration & Cross-Cutting Concerns

### Shared Infrastructure

#### Caching Layer
```typescript
// Redis-based caching for all research features
interface ResearchCache {
  // Graph RAG: Cache query results and subgraphs
  graphRAG: GraphRAGCache;
  
  // Constitutional AI: Cache critique results
  constitutional: ConstitutionalCache;
  
  // Multi-Modal: Cache vision analysis results
  multimodal: MultimodalCache;
  
  // Speculative: Cache simulation results
  speculative: SpeculativeCache;
}
```

#### Event Integration
```typescript
// Unified event types for research features
type ResearchEvent =
  | { type: 'graph_rag.query_completed', payload: GraphRAGMetrics }
  | { type: 'constitutional.violation_detected', payload: ViolationEvent }
  | { type: 'multimodal.image_analyzed', payload: VisionMetrics }
  | { type: 'speculative.branch_explored', payload: BranchMetrics };
```

#### Monitoring & Analytics
```typescript
// Research feature analytics dashboard
interface ResearchAnalytics {
  // Graph RAG
  graphRAGLatency: Metric;
  graphRAGAccuracy: Metric;
  
  // Constitutional AI
  violationRate: Metric;
  autoCorrectionRate: Metric;
  
  // Multi-Modal
  visionCost: Metric;
  documentProcessingVolume: Metric;
  
  // Speculative
  simulationAccuracy: Metric;
  rollbackFrequency: Metric;
}
```

### Testing Strategy

#### Unit Tests
- Each service tested in isolation
- Mock external dependencies
- 80%+ code coverage target

#### Integration Tests
- Cross-service workflows
- End-to-end scenarios
- Performance benchmarks

#### A/B Testing
```typescript
// Compare research features vs baseline
interface ABTest {
  feature: 'graph_rag' | 'constitutional' | 'speculative';
  metric: 'accuracy' | 'success_rate' | 'cost' | 'latency';
  controlGroup: number;
  treatmentGroup: number;
  duration: number;  // days
}
```

### Deployment Plan

#### Phase 1 (Week 4): Graph RAG
- Deploy to staging
- Load testing
- Customer beta

#### Phase 2 (Week 7): Constitutional AI
- Deploy alongside Graph RAG
- Security review
- Compliance validation

#### Phase 3 (Week 10): Multi-Modal
- GPU resource provisioning
- Vision API integration
- Cost monitoring setup

#### Phase 4 (Week 12): Speculative Execution
- Compute resource scaling
- Simulation optimization
- Production rollout

---

## Success Metrics

### Technical Metrics
| Feature | Metric | Target | Measurement |
|---------|--------|--------|-------------|
| Graph RAG | Accuracy improvement | +30% | A/B test vs vector-only |
| Graph RAG | Latency | <500ms | p95 response time |
| Constitutional | Violation detection rate | >95% | Manual validation |
| Constitutional | False positive rate | <5% | User feedback |
| Multi-Modal | Vision accuracy | >90% | Human evaluation |
| Multi-Modal | Document processing speed | <2s/page | Benchmark |
| Speculative | Mission success rate | +40% | A/B test |
| Speculative | Rollback success rate | >90% | Production metrics |

### Business Metrics
- Customer adoption: 50% of orgs using ≥1 research feature within 3 months
- Competitive win rate: Track deals where research features were decisive
- Customer satisfaction: NPS improvement from AI capabilities
- Cost efficiency: Monitor API spend, optimize for ROI

---

## Risk Mitigation

### Technical Risks
1. **LLM API reliability**: Implement fallbacks, caching, circuit breakers
2. **Performance degradation**: Load testing, optimization, graceful degradation
3. **Integration complexity**: Modular architecture, feature flags

### Business Risks
1. **Cost overruns**: Usage monitoring, budget alerts, optimization sprints
2. **Adoption challenges**: Documentation, training, customer success support
3. **Competitive response**: Continuous research monitoring, fast iteration

---

## Resources Required

### Team
- 2 Senior Engineers (architecture, complex features)
- 2 Mid-Level Engineers (implementation, testing)
- 1 ML Engineer (model selection, optimization)
- 0.5 PM (coordination, customer feedback)

### Infrastructure
- GPU instances for vision processing
- Redis cluster for caching
- Load balancers for scaling
- Monitoring stack (Prometheus, Grafana)

### Budget
- LLM API costs: ~$50K/month (at scale)
- Infrastructure: ~$10K/month
- Team: ~$150K/month
- **Total**: ~$210K/month for 3 months = $630K

---

## Next Steps

### Immediate (This Week)
1. ✅ Finalize team assignments
2. ✅ Set up development environments
3. ✅ Create feature branches
4. ✅ Schedule kickoff meeting

### Week 1
1. Begin Graph RAG implementation
2. Set up monitoring infrastructure
3. Create test datasets

### Ongoing
- Weekly standups
- Bi-weekly demos
- Monthly stakeholder updates

---

**Approval Status**: Approved for implementation  
**Start Date**: Week of May 5, 2026  
**Target Completion**: August 4, 2026  
**Review Meeting**: Weekly Fridays at 2pm
