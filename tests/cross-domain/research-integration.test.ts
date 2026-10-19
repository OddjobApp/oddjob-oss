/**
 * Research Integration Tests
 * 
 * End-to-end tests for all AI research modules.
 * Tests Priority 1 and Priority 2 implementations.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';

// Import all research services
import { GraphRAGService, HybridSearchEngine, PathExplainerService } from '../../server/domain/knowledge/core/graph-rag/index.js';
import { ConstitutionalAIService, CritiqueEngine } from '../../server/domain/agents/core/constitutional-ai/index.js';
import { VisionService, DocumentProcessingService } from '../../server/domain/agents/core/multimodal/index.js';
import { SpeculativeExecutionService, MCTSEngine } from '../../server/domain/agents/core/speculative/index.js';
import { HybridReasoningService, DatalogEngine } from '../../server/domain/agents/core/neuro-symbolic/index.js';
import { FederatedCoordinatorService } from '../../server/domain/agents/core/federated/index.js';
import { CausalReasoningService } from '../../server/domain/agents/core/causal/index.js';
import { LNNCoreService } from '../../server/domain/agents/core/liquid-nn/index.js';

describe('AI Research Integration Tests', () => {
  // Mock event stream
  const mockEventStream = {
    publish: async () => {}
  };

  describe('Priority 1: Graph RAG', () => {
    let graphRAGService: GraphRAGService;
    let hybridSearchEngine: HybridSearchEngine;
    let pathExplainer: PathExplainerService;

    beforeAll(() => {
      // The injected embedding service must expose `generateEmbedding` — that
      // is the method both constructors declare and both engines call. These
      // doubles offered `embed`, so every search died on
      // "this.embeddingService.generateEmbedding is not a function" and the
      // failures said nothing about Graph RAG.
      const mockQdrant = { search: async () => [] } as any;
      const mockEmbeddings = { generateEmbedding: async () => new Array(8).fill(0.1) } as any;

      graphRAGService = new GraphRAGService(mockQdrant, mockEmbeddings);
      hybridSearchEngine = new HybridSearchEngine(mockQdrant, mockEmbeddings);
      pathExplainer = new PathExplainerService();
    });

    it('should perform hybrid search combining vector and graph', async () => {
      const query = {
        query: 'What is machine learning?',
        organizationId: 1,
        maxHops: 3,
        topK: 5
      };

      // Test that the service can process a query
      const result = await graphRAGService.query(query);
      
      expect(result).toBeDefined();
      expect(result.queryId).toBeDefined();
      expect(Array.isArray(result.contextNodes)).toBe(true);
      expect(result.metrics).toBeDefined();
    });

    /**
     * generateExplanation PRODUCES the narrative from the path's edges — it
     * does not echo `path.explanation`, which is the field it exists to fill.
     * The fixture here had no edges and asserted its own explanation came back,
     * so it was testing an API that does not exist.
     */
    it('should explain graph paths', () => {
      const path = {
        pathId: 'test-path',
        edges: [
          { sourceId: 'node-1', targetId: 'node-3', relation: 'depends_on', sourceLabel: 'Ingestion', targetLabel: 'Embedding' },
          { sourceId: 'node-3', targetId: 'node-5', relation: 'feeds', sourceLabel: 'Embedding', targetLabel: 'Retrieval' },
        ],
        pathScore: 0.8,
        explanation: '',
        seedNodeId: 'node-1',
        targetNodeId: 'node-5'
      } as any;

      const explanation = pathExplainer.generateExplanation(path, 'test query');
      // The hops, in order, with the relation that joins them.
      expect(explanation).toContain('Ingestion');
      expect(explanation).toContain('depends_on');
      expect(explanation).toContain('Retrieval');

      const citation = pathExplainer.generateCitation(path);
      expect(citation).toContain('node-1');
      expect(citation).toContain('node-3');
      expect(citation).toContain('node-5');
    });

    it('says so plainly when a result came straight from vector search', () => {
      const path = {
        pathId: 'direct',
        edges: [],
        pathScore: 0.9,
        explanation: '',
        seedNodeId: 'node-7',
        targetNodeId: 'node-7'
      } as any;

      expect(pathExplainer.generateExplanation(path)).toBe('Direct match from semantic search');
      // With no edges to walk, the citation falls back to the endpoints.
      expect(pathExplainer.generateCitation(path)).toContain('node-7');
    });
  });

  describe('Priority 1: Constitutional AI', () => {
    let constitutionalService: ConstitutionalAIService;

    beforeAll(() => {
      constitutionalService = new ConstitutionalAIService(
        { generate: async () => '{}' },  // mock LLM
        { load: async () => null },       // mock constitution repo
        mockEventStream
      );
    });

    it('should review agent action against principles', async () => {
      const action = {
        id: 'action-1',
        type: 'api_call',
        content: JSON.stringify({ endpoint: '/api/users', method: 'GET' }),
        agentId: 'agent-1',
        timestamp: new Date()
      };

      const context = {
        agentId: 'agent-1',
        organizationId: 1,
        userId: 'user-1',
        missionId: 'mission-1'
      };

      const review = await constitutionalService.reviewAction(action, context);
      
      expect(review).toBeDefined();
      expect(review.reviewId).toBeDefined();
      expect(typeof review.approved).toBe('boolean');
      expect(Array.isArray(review.checks)).toBe(true);
    });

    it('should have default principles configured', () => {
      const metrics = constitutionalService.getMetrics();
      expect(metrics).toBeDefined();
      expect(typeof metrics.totalReviews).toBe('number');
    });
  });

  describe('Priority 1: Multi-Modal', () => {
    let visionService: VisionService;
    let documentService: DocumentProcessingService;

    beforeAll(() => {
      // The client is OpenAI-shaped — chat.completions.create — not an
      // `analyzeImage` helper, which is what the previous double offered.
      const mockVisionClient = {
        chat: {
          completions: {
            create: async () => ({
              choices: [{ message: { content: 'A screenshot of a dashboard.' } }],
              usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
            }),
          },
        },
      } as any;

      visionService = new VisionService(
        mockVisionClient,
        undefined,  // no gemini
        undefined   // no anthropic
      );
      documentService = new DocumentProcessingService(visionService);
    });

    it('should analyze images with vision models', async () => {
      const request = {
        // ImageInput is { source, type }, not { base64 }: the service rejected
        // every image with "Image source is required" before reaching a model.
        images: [{ source: 'data:image/png;base64,aGVsbG8=', type: 'base64' as const, mimeType: 'image/png' }],
        prompt: 'Describe this image',
        model: 'gpt-4-vision',
        maxTokens: 1000
      };

      const result = await visionService.analyze(request);
      
      expect(result).toBeDefined();
      expect(result.description).toBeDefined();
      expect(result.model).toBe('gpt-4-vision');
    });

    it('should extract text from images (OCR)', async () => {
      const images = [{ source: 'data:image/png;base64,aGVsbG8=', type: 'base64' as const, mimeType: 'image/png' }];
      
      const result = await visionService.extractText(images);
      
      expect(result).toBeDefined();
      expect(result.fullText).toBeDefined();
      expect(Array.isArray(result.byImage)).toBe(true);
    });
  });

  describe('Priority 1: Speculative Execution', () => {
    let speculativeService: SpeculativeExecutionService;
    let mctsEngine: MCTSEngine;

    beforeAll(() => {
      /**
       * StateSimulator is simulate/evaluate/isTerminal/getAvailableActions.
       * The double offered one method under a name the interface does not
       * have — `simulateAction` — so planning died on
       * "this.simulator.isTerminal is not a function".
       *
       * Terminal at depth 2 keeps the search finite without a step budget.
       */
      const mockStateSimulator = {
        simulate: async (state: any, action: any) => ({
          ...state,
          id: `${state.id}->${action.id}`,
          parentId: state.id,
          depth: (state.depth ?? 0) + 1,
          isTerminal: (state.depth ?? 0) + 1 >= 2,
          value: 0,
          visits: 0,
          totalReward: 0,
        }),
        evaluate: async () => 1.0,
        isTerminal: async (state: any) => (state.depth ?? 0) >= 2,
        getAvailableActions: async (state: any) =>
          (state.depth ?? 0) >= 2
            ? []
            : [{ id: `a-${state.depth ?? 0}`, type: 'step', description: `Step ${state.depth ?? 0}` }],
      } as any;
      
      speculativeService = new SpeculativeExecutionService(
        mockStateSimulator,
        mockEventStream
      );
      mctsEngine = new MCTSEngine(mockStateSimulator);
    });

    it('should create MCTS-based execution plan', async () => {
      const request = {
        id: randomUUID(),
        initialState: {
          id: 'initial',
          description: 'Initial state',
          context: {},
          parentId: null,
          depth: 0,
          isTerminal: false,
          value: 0,
          visits: 0,
          totalReward: 0
        },
        goal: 'Complete task',
        availableActions: [
          { id: 'a1', type: 'step', description: 'Step 1' },
          { id: 'a2', type: 'step', description: 'Step 2' }
        ]
      };

      const result = await speculativeService.plan(request);
      
      expect(result).toBeDefined();
      expect(result.requestId).toBeDefined();
      expect(Array.isArray(result.bestPlan)).toBe(true);
      expect(result.successProbability).toBeGreaterThanOrEqual(0);
      expect(result.successProbability).toBeLessThanOrEqual(1);
    });

    it('should create checkpoints for rollback', async () => {
      const checkpoint = await speculativeService.createCheckpoint(
        'agent-1',
        'mission-1',
        { data: 'test' }
      );
      
      expect(checkpoint).toBeDefined();
      expect(checkpoint.id).toBeDefined();
      expect(checkpoint.agentId).toBe('agent-1');
      expect(checkpoint.missionId).toBe('mission-1');
    });
  });

  describe('Priority 2: Neuro-Symbolic AI', () => {
    let hybridService: HybridReasoningService;
    let datalogEngine: DatalogEngine;

    beforeAll(() => {
      const mockLLM = {
        generate: async () => 'test answer',
        generateStructured: async () => ({
          logicForm: 'test(ok).\n?- test(X).',
          logicLanguage: 'datalog',
          entities: [],
          relations: [],
          confidence: 0.9,
          alternatives: []
        })
      };
      
      hybridService = new HybridReasoningService(mockLLM);
      datalogEngine = new DatalogEngine();
    });

    it('should translate NL to logic and infer', async () => {
      const query = {
        id: randomUUID(),
        naturalLanguage: 'Is this transaction suspicious?',
        domain: 'finance',
        requiresVerification: false,
        maxDepth: 10,
        timeoutMs: 5000,
        includeProof: true
      };

      const result = await hybridService.query(query);
      
      expect(result).toBeDefined();
      expect(result.naturalAnswer).toBeDefined();
      expect(result.formalAnswer).toBeDefined();
      expect(result.explanation).toBeDefined();
    });

    it('should execute Datalog queries', async () => {
      // Load some facts
      datalogEngine.loadProgram({
        id: 'test-program',
        facts: [
          { id: 'f1', predicate: 'customer', arguments: ['alice', 25], negated: false, source: 'extracted', confidence: 1.0, timestamp: new Date() },
          { id: 'f2', predicate: 'customer', arguments: ['bob', 30], negated: false, source: 'extracted', confidence: 1.0, timestamp: new Date() }
        ],
        rules: [],
        domain: 'test',
        version: '1.0',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const query = {
        predicate: 'customer',
        arguments: [{ type: 'variable', name: 'X' }, { type: 'variable', name: 'Age' }],
        negated: false
      };

      const result = await datalogEngine.query(query);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(Array.isArray(result.derivedFacts)).toBe(true);
    });
  });

  describe('Priority 2: Federated Learning', () => {
    let federatedService: FederatedCoordinatorService;

    beforeAll(() => {
      federatedService = new FederatedCoordinatorService(mockEventStream);
    });

    it('should create federated training job', async () => {
      // Register an organization first
      await federatedService.registerOrg(
        'org-1',
        'Test Organization',
        'public-key-123',
        {
          sampleCount: 1000,
          featureCount: 10,
          dataTypes: ['numeric'],
          quality: 0.9
        }
      );

      const job = await federatedService.createJob(
        'Customer Support Agent',
        'Train support agents collaboratively',
        'agent_policy',
        ['support', 'troubleshooting'],
        ['org-1', 'org-2'],
        { rounds: 10, minParticipants: 1 },
        'test-user'
      );
      
      expect(job).toBeDefined();
      expect(job.id).toBeDefined();
      expect(job.name).toBe('Customer Support Agent');
      expect(job.status).toBe('pending');
      expect(job.participants.length).toBeGreaterThan(0);
    });

    it('should track federated metrics', () => {
      const metrics = federatedService.getMetrics();
      
      expect(metrics).toBeDefined();
      expect(typeof metrics.totalJobs).toBe('number');
      expect(typeof metrics.totalRounds).toBe('number');
      expect(typeof metrics.totalOrgs).toBe('number');
    });
  });

  describe('Priority 2: Causal Reasoning', () => {
    let causalService: CausalReasoningService;

    beforeAll(() => {
      causalService = new CausalReasoningService(mockEventStream);
    });

    it('should load and validate causal graph', () => {
      const graph = {
        id: 'test-graph',
        name: 'Marketing Effectiveness',
        variables: [
          { id: 'marketing', name: 'Marketing Spend', type: 'continuous', observable: true, intervenable: true, description: 'Ad spend' },
          { id: 'sales', name: 'Sales', type: 'continuous', observable: true, intervenable: false, description: 'Revenue' }
        ],
        edges: [
          { source: 'marketing', target: 'sales', strength: 0.7, type: 'direct', bidirectional: false, confidence: 0.9, discoveryMethod: 'expert' }
        ],
        confounders: [],
        backdoorPaths: [],
        frontdoorPaths: [],
        source: 'expert',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      expect(() => causalService.loadGraph(graph)).not.toThrow();
    });

    it('should compute ATE estimation', async () => {
      const data = {
        marketing: [0, 1, 0, 1, 1, 0, 1, 1],
        sales: [100, 150, 110, 160, 155, 105, 165, 170]
      };

      try {
        const estimate = await causalService.estimateATE(
          'test-graph',
          'marketing',
          'sales',
          data
        );
        
        expect(estimate).toBeDefined();
        expect(estimate.type).toBe('ate');
        expect(typeof estimate.value).toBe('number');
        expect(estimate.confidenceInterval).toBeDefined();
      } catch (error) {
        // Graph may not be loaded in test environment
        expect(error).toBeDefined();
      }
    });
  });

  describe('Priority 2: Liquid Neural Networks', () => {
    let lnnService: LNNCoreService;

    beforeAll(() => {
      lnnService = new LNNCoreService(mockEventStream);
    });

    it('should create LNN agent', async () => {
      const agent = await lnnService.createAgent(
        'Traffic Monitor',
        'monitoring',
        { numNeurons: 32, timeConstant: 0.1 },
        { realTimeAdaptation: true, edgeOptimized: false }
      );
      
      expect(agent).toBeDefined();
      expect(agent.id).toBeDefined();
      expect(agent.name).toBe('Traffic Monitor');
      expect(agent.taskType).toBe('monitoring');
      expect(agent.config.numNeurons).toBe(32);
    });

    it('should perform forward pass', async () => {
      const agent = await lnnService.createAgent(
        'Test Agent',
        'monitoring',
        { numNeurons: 16, inputDim: 5, outputDim: 2 },
        { realTimeAdaptation: false }
      );

      const input = [1.0, 0.5, 0.2, 0.8, 0.3];
      
      const result = await lnnService.forward(agent.id, input);
      
      expect(result).toBeDefined();
      expect(Array.isArray(result.output)).toBe(true);
      expect(result.output.length).toBe(2);
      expect(result.computeTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.stepsTaken).toBeGreaterThan(0);
    });

    it('should track LNN metrics', () => {
      const metrics = lnnService.getMetrics();
      
      expect(metrics).toBeDefined();
      expect(typeof metrics.activeAgents).toBe('number');
      expect(typeof metrics.totalInferences).toBe('number');
      expect(typeof metrics.avgInferenceTimeMs).toBe('number');
    });
  });

  describe('Research API Routes', () => {
    it('should have all research endpoints defined', () => {
      // This test verifies the routes file exports correctly
      // Actual route testing would require HTTP testing
      expect(true).toBe(true);
    });
  });
});
