/**
 * Research API Routes
 * 
 * Exposes Priority 1 AI research services:
 * - Graph RAG (enhanced hybrid search)
 * - Constitutional AI (agent safety)
 * - Multi-Modal (vision + documents)
 * - Speculative Execution (MCTS planning)
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../domain/core/auth/security.service.js';
import { asyncHandler } from '../middleware/error-handler.js';
import { ValidationError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { getUserOrgContext } from '../utils/auth-context.js';
import { randomUUID } from 'crypto';

// Graph RAG imports
import { GraphRAGService } from '../domain/knowledge/core/graph-rag/graph-rag.service.js';
import { HybridSearchEngine } from '../domain/knowledge/core/graph-rag/hybrid-search.engine.js';
import { PathExplainerService } from '../domain/knowledge/core/graph-rag/path-explainer.service.js';
import { DEFAULT_GRAPH_RAG_QUERY } from '../domain/knowledge/core/graph-rag/types.js';

// Constitutional AI imports
import { ConstitutionalAIService } from '../domain/agents/core/constitutional-ai/constitutional-ai.service.js';
import { DEFAULT_CONSTITUTION } from '../domain/agents/core/constitutional-ai/types.js';

// Multi-Modal imports
import { VisionService } from '../domain/agents/core/multimodal/vision.service.js';
import { DocumentProcessingService } from '../domain/agents/core/multimodal/document.service.js';
import { DEFAULT_MULTIMODAL_CONFIG } from '../domain/agents/core/multimodal/types.js';

// Speculative Execution imports
import { SpeculativeExecutionService } from '../domain/agents/core/speculative/speculative-execution.service.js';
import { DEFAULT_SPECULATIVE_CONFIG } from '../domain/agents/core/speculative/types.js';

// Neuro-Symbolic imports
import { HybridReasoningService } from '../domain/agents/core/neuro-symbolic/hybrid-reasoning.service.js';
import { DatalogEngine } from '../domain/agents/core/neuro-symbolic/datalog-engine.js';
import { amlRuleset, getHighRiskCountryFacts } from '../domain/agents/core/neuro-symbolic/domains/finance/aml-rules.js';
import { clinicalRuleset, getDrugInteractionFacts, getContraindicationFacts } from '../domain/agents/core/neuro-symbolic/domains/healthcare/clinical-rules.js';
import { legalRuleset, getGDPRClauseFacts, getHighRiskTermFacts } from '../domain/agents/core/neuro-symbolic/domains/legal/contract-rules.js';
import { DEFAULT_NEURO_SYMBOLIC_CONFIG } from '../domain/agents/core/neuro-symbolic/types.js';

// Federated Learning imports
import { FederatedCoordinatorService } from '../domain/agents/core/federated/coordinator.service.js';
import { DEFAULT_FEDERATED_CONFIG } from '../domain/agents/core/federated/types.js';

// Causal Reasoning imports
import { CausalReasoningService } from '../domain/agents/core/causal/causal-reasoning.service.js';
import { DEFAULT_CAUSAL_CONFIG } from '../domain/agents/core/causal/types.js';

// Liquid Neural Networks imports
import { LNNCoreService } from '../domain/agents/core/liquid-nn/lnn-core.service.js';
import { DEFAULT_LNN_CONFIG } from '../domain/agents/core/liquid-nn/types.js';

const logger = createLogger('ResearchAPI');
const router = Router();

// Initialize services (would be injected in production)
let graphRAGService: GraphRAGService | null = null;
let constitutionalAIService: ConstitutionalAIService | null = null;
let visionService: VisionService | null = null;
let documentService: DocumentProcessingService | null = null;
let speculativeExecutionService: SpeculativeExecutionService | null = null;
let neuroSymbolicService: HybridReasoningService | null = null;
let federatedService: FederatedCoordinatorService | null = null;
let causalService: CausalReasoningService | null = null;
let lnnService: LNNCoreService | null = null;

/**
 * Initialize services with dependencies
 */
export function initializeResearchServices(deps: {
  qdrantClient: any;
  embeddingService: any;
  llmClient: any;
  constitutionRepo: any;
  eventStream: any;
  stateSimulator: any;
}) {
  // Graph RAG
  const pathExplainer = new PathExplainerService();
  graphRAGService = new GraphRAGService(
    deps.qdrantClient,
    deps.embeddingService
  );

  // Constitutional AI
  constitutionalAIService = new ConstitutionalAIService(
    deps.llmClient,
    deps.constitutionRepo,
    deps.eventStream
  );

  // Multi-Modal
  visionService = new VisionService(
    deps.llmClient,
    undefined,  // geminiClient
    undefined   // anthropicClient
  );
  documentService = new DocumentProcessingService(visionService);

  // Speculative Execution
  speculativeExecutionService = new SpeculativeExecutionService(
    deps.stateSimulator,
    deps.eventStream
  );

  // Neuro-Symbolic
  neuroSymbolicService = new HybridReasoningService(
    deps.llmClient,
    DEFAULT_NEURO_SYMBOLIC_CONFIG
  );
  // Load default domain rulesets
  neuroSymbolicService.loadDomainRuleset(amlRuleset);
  neuroSymbolicService.loadDomainRuleset(clinicalRuleset);
  neuroSymbolicService.loadDomainRuleset(legalRuleset);

  // Federated Learning
  federatedService = new FederatedCoordinatorService(deps.eventStream);

  // Causal Reasoning
  causalService = new CausalReasoningService(deps.eventStream, DEFAULT_CAUSAL_CONFIG);

  // Liquid Neural Networks
  lnnService = new LNNCoreService(deps.eventStream);

  logger.info('Research services initialized');
}

// ============================================================================
// Graph RAG Routes
// ============================================================================

/**
 * POST /api/research/graph-rag/query
 * Execute hybrid graph + vector search
 */
router.post('/graph-rag/query', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const {
    query,
    maxHops = 3,
    topK = 5,
    traversalStrategy = 'bfs',
    entityTypes,
    minRelationshipWeight = 0.5,
    includePaths = true,
    generateAnswer = false
  } = req.body;

  if (!query || typeof query !== 'string') {
    throw new ValidationError('Query string is required', { field: 'query' });
  }

  const orgContext = await getUserOrgContext(req);

  logger.info('GraphRAG query', {
    correlationId: req.correlationId,
    query: query.substring(0, 100),
    organizationId: orgContext.organizationId,
    maxHops,
    topK
  });

  if (!graphRAGService) {
    return res.status(503).json({
      error: 'Graph RAG service not initialized',
      message: 'Service is temporarily unavailable'
    });
  }

  if (!orgContext.organizationId) {
    throw new ValidationError('Organization ID is required', { field: 'organizationId' });
  }

  const result = await graphRAGService.query({
    query,
    organizationId: orgContext.organizationId,
    maxHops,
    topK,
    traversalStrategy,
    entityTypes,
    minRelationshipWeight,
    includePaths,
    generateAnswer
  });

  logger.info('GraphRAG query complete', {
    correlationId: req.correlationId,
    nodesFound: result.contextNodes.length,
    pathsFound: result.traversedPaths?.length || 0
  });

  res.json({
    success: true,
    query,
    result: {
      answer: result.answer,
      contextNodes: result.contextNodes,
      traversedPaths: result.traversedPaths,
      metrics: result.metrics
    }
  });
}));

/**
 * POST /api/research/graph-rag/explain-path
 * Generate human-readable explanation of a graph path
 */
router.post('/graph-rag/explain-path', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { path, query } = req.body;

  if (!path) {
    throw new ValidationError('Path is required', { field: 'path' });
  }

  const pathExplainer = new PathExplainerService();
  const explanation = pathExplainer.generateExplanation(path, query);
  const citation = pathExplainer.generateCitation(path);
  const structured = pathExplainer.generateStructuredExplanation(path);

  res.json({
    success: true,
    explanation,
    citation,
    structured
  });
}));

/**
 * GET /api/research/graph-rag/metrics
 * Get Graph RAG service metrics
 */
router.get('/graph-rag/metrics', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!graphRAGService) {
    return res.status(503).json({ error: 'Service not initialized' });
  }

  // Access private metrics through service method
  const metrics = (graphRAGService as any).metrics || [];

  res.json({
    success: true,
    metrics: {
      totalQueries: metrics.length,
      avgLatencyMs: metrics.length > 0
        ? metrics.reduce((sum: number, m: any) => sum + m.totalTimeMs, 0) / metrics.length
        : 0,
      cacheHitRate: metrics.length > 0
        ? metrics.filter((m: any) => m.cacheHitRate === 1.0).length / metrics.length
        : 0
    }
  });
}));

// ============================================================================
// Constitutional AI Routes
// ============================================================================

/**
 * POST /api/research/constitutional/review
 * Review an agent action against constitutional principles
 */
router.post('/constitutional/review', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const {
    action,
    context,
    constitutionId = 'default'
  } = req.body;

  if (!action || !context) {
    throw new ValidationError('Action and context are required', { fields: ['action', 'context'] });
  }

  const orgContext = await getUserOrgContext(req);

  logger.info('Constitutional review', {
    correlationId: req.correlationId,
    actionId: action.id,
    actionType: action.type,
    organizationId: orgContext.organizationId
  });

  if (!constitutionalAIService) {
    return res.status(503).json({ error: 'Constitutional AI service not initialized' });
  }

  const enrichedContext = {
    ...context,
    organizationId: orgContext.organizationId,
    agentId: context.agentId || req.user?.id,
    userId: req.user?.id
  };

  const review = await constitutionalAIService.reviewAction(
    action,
    enrichedContext,
    constitutionId
  );

  logger.info('Constitutional review complete', {
    correlationId: req.correlationId,
    reviewId: review.reviewId,
    approved: review.approved,
    violations: review.blockingViolations.length
  });

  res.json({
    success: true,
    review: {
      reviewId: review.reviewId,
      approved: review.approved,
      requiresEscalation: review.requiresEscalation,
      checks: review.checks.map(c => ({
        principleId: c.principle.id,
        principleName: c.principle.name,
        compliant: c.compliant,
        confidence: c.confidence,
        critique: c.critique,
        severity: c.principle.severity,
        hasRevisedAction: !!c.revisedAction
      })),
      blockingViolations: review.blockingViolations.map(v => ({
        principleId: v.principle.id,
        principleName: v.principle.name,
        critique: v.critique
      })),
      warnings: review.warnings.map(w => ({
        principleId: w.principle.id,
        principleName: w.principle.name,
        critique: w.critique
      })),
      finalAction: review.finalAction,
      reviewTimeMs: review.totalReviewTimeMs
    }
  });
}));

/**
 * GET /api/research/constitutional/principles
 * Get constitutional principles
 */
router.get('/constitutional/principles', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { category, severity } = req.query;

  let principles = DEFAULT_CONSTITUTION.principles;

  if (category) {
    principles = principles.filter(p => p.category === category);
  }

  if (severity) {
    principles = principles.filter(p => p.severity === severity);
  }

  res.json({
    success: true,
    constitution: {
      id: DEFAULT_CONSTITUTION.id,
      name: DEFAULT_CONSTITUTION.name,
      description: DEFAULT_CONSTITUTION.description,
      principles: principles.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        category: p.category,
        severity: p.severity,
        rule: p.rule,
        autoCorrect: p.autoCorrect
      }))
    }
  });
}));

/**
 * GET /api/research/constitutional/metrics
 * Get Constitutional AI metrics
 */
router.get('/constitutional/metrics', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!constitutionalAIService) {
    return res.status(503).json({ error: 'Service not initialized' });
  }

  const metrics = constitutionalAIService.getMetrics();

  res.json({
    success: true,
    metrics
  });
}));

// ============================================================================
// Multi-Modal Routes
// ============================================================================

/**
 * POST /api/research/multimodal/vision
 * Analyze images with vision models
 */
router.post('/multimodal/vision', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const {
    images,
    prompt,
    model = DEFAULT_MULTIMODAL_CONFIG.defaultVisionModel,
    maxTokens = 1000,
    temperature = 0.7,
    outputFormat = 'text'
  } = req.body;

  if (!images || !Array.isArray(images) || images.length === 0) {
    throw new ValidationError('Images array is required', { field: 'images' });
  }

  if (!prompt) {
    throw new ValidationError('Prompt is required', { field: 'prompt' });
  }

  logger.info('Vision analysis', {
    correlationId: req.correlationId,
    imageCount: images.length,
    model,
    prompt: prompt.substring(0, 100)
  });

  if (!visionService) {
    return res.status(503).json({ error: 'Vision service not initialized' });
  }

  const result = await visionService.analyze({
    images,
    prompt,
    model,
    maxTokens,
    temperature,
    outputFormat
  });

  logger.info('Vision analysis complete', {
    correlationId: req.correlationId,
    confidence: result.confidence,
    tokensUsed: result.tokensUsed
  });

  res.json({
    success: true,
    result: {
      description: result.description,
      extractedText: result.extractedText,
      detectedObjects: result.detectedObjects,
      structuredData: result.structuredData,
      confidence: result.confidence,
      model: result.model,
      tokensUsed: result.tokensUsed,
      processingTimeMs: result.processingTimeMs
    }
  });
}));

/**
 * POST /api/research/multimodal/ocr
 * Extract text from images (OCR)
 */
router.post('/multimodal/ocr', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { images, language } = req.body;

  if (!images || !Array.isArray(images)) {
    throw new ValidationError('Images array is required', { field: 'images' });
  }

  if (!visionService) {
    return res.status(503).json({ error: 'Vision service not initialized' });
  }

  const result = await visionService.extractText(images, language);

  res.json({
    success: true,
    fullText: result.fullText,
    byImage: result.byImage
  });
}));

/**
 * POST /api/research/multimodal/document
 * Process documents (PDF, Word, images)
 */
router.post('/multimodal/document', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const {
    source,
    type,
    extractLayout = true,
    extractTables = true,
    extractImages = false,
    ocr = true
  } = req.body;

  if (!source || !type) {
    throw new ValidationError('Source and type are required', { fields: ['source', 'type'] });
  }

  logger.info('Document processing', {
    correlationId: req.correlationId,
    type,
    extractLayout,
    extractTables,
    ocr
  });

  if (!documentService) {
    return res.status(503).json({ error: 'Document service not initialized' });
  }

  const result = await documentService.processDocument({
    source,
    type,
    extractLayout,
    extractTables,
    extractImages,
    ocr
  });

  logger.info('Document processing complete', {
    correlationId: req.correlationId,
    pages: result.pages.length,
    tables: result.tables.length,
    chars: result.metrics.charactersExtracted
  });

  res.json({
    success: true,
    document: {
      text: result.text,
      pages: result.pages.map(p => ({
        pageNumber: p.pageNumber,
        text: p.text.substring(0, 1000),  // Truncate for response
        textBlocks: p.textBlocks.length,
        images: p.images.length
      })),
      tables: result.tables,
      metadata: result.metadata,
      metrics: result.metrics
    }
  });
}));

/**
 * POST /api/research/multimodal/ui-element
 * Find UI element visually in screenshot
 */
router.post('/multimodal/ui-element', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { screenshot, description, elementType, hints } = req.body;

  if (!screenshot || !description) {
    throw new ValidationError('Screenshot and description are required', { fields: ['screenshot', 'description'] });
  }

  if (!visionService) {
    return res.status(503).json({ error: 'Vision service not initialized' });
  }

  const result = await visionService.findUIElement(screenshot, description, {
    elementType,
    hints
  });

  res.json({
    success: true,
    result
  });
}));

// ============================================================================
// Speculative Execution Routes
// ============================================================================

/**
 * POST /api/research/speculative/plan
 * Create MCTS-based execution plan
 */
router.post('/speculative/plan', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const {
    initialState,
    goal,
    availableActions,
    constraints,
    horizon = 'medium',
    successCriteria,
    mctsConfig
  } = req.body;

  if (!initialState || !goal || !availableActions) {
    throw new ValidationError('initialState, goal, and availableActions are required', {
      fields: ['initialState', 'goal', 'availableActions']
    });
  }

  const orgContext = await getUserOrgContext(req);

  logger.info('Speculative planning', {
    correlationId: req.correlationId,
    goal: goal.substring(0, 100),
    actionCount: availableActions.length,
    organizationId: orgContext.organizationId
  });

  if (!speculativeExecutionService) {
    return res.status(503).json({ error: 'Speculative execution service not initialized' });
  }

  const requestId = randomUUID();

  const result = await speculativeExecutionService.plan({
    id: requestId,
    initialState: {
      id: 'initial',
      description: 'Initial planning state',
      context: initialState,
      parentId: null,
      depth: 0,
      isTerminal: false,
      value: 0,
      visits: 0,
      totalReward: 0
    },
    goal,
    availableActions,
    constraints,
    horizon,
    successCriteria,
    mctsConfig
  });

  logger.info('Speculative planning complete', {
    correlationId: req.correlationId,
    requestId,
    planLength: result.bestPlan.length,
    expectedValue: result.expectedValue
  });

  res.json({
    success: true,
    result: {
      requestId: result.requestId,
      bestPlan: result.bestPlan,
      expectedValue: result.expectedValue,
      successProbability: result.successProbability,
      expectedCost: result.expectedCost,
      alternativePlans: result.alternativePlans,
      treeStats: result.treeStats,
      planningTimeMs: result.planningTimeMs,
      statesExplored: result.statesExplored,
      confidence: result.confidence
    }
  });
}));

/**
 * POST /api/research/speculative/execute
 * Speculatively execute an action with rollback capability
 */
router.post('/speculative/execute', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const {
    action,
    currentState,
    speculationDepth = 3,
    enableRollback = true
  } = req.body;

  if (!action || !currentState) {
    throw new ValidationError('Action and currentState are required', { fields: ['action', 'currentState'] });
  }

  const orgContext = await getUserOrgContext(req);

  logger.info('Speculative execution', {
    correlationId: req.correlationId,
    actionId: action.id,
    actionType: action.type,
    enableRollback
  });

  if (!speculativeExecutionService) {
    return res.status(503).json({ error: 'Speculative execution service not initialized' });
  }

  // Create checkpoint if rollback enabled
  let checkpointId: string | undefined;
  if (enableRollback) {
    const checkpoint = await speculativeExecutionService.createCheckpoint(
      req.user?.id || 'unknown',
      req.body.missionId || 'unknown',
      currentState
    );
    checkpointId = checkpoint.id;
  }

  const requestId = randomUUID();

  const result = await speculativeExecutionService.speculate({
    id: requestId,
    agentId: req.user?.id || 'unknown',
    missionId: req.body.missionId || 'unknown',
    organizationId: orgContext.organizationId || 0,
    currentState,
    action,
    checkpointId,
    speculationDepth,
    enableRollback
  });

  logger.info('Speculative execution complete', {
    correlationId: req.correlationId,
    requestId,
    success: result.success,
    recommendExecution: result.recommendExecution
  });

  res.json({
    success: true,
    result: {
      requestId: result.requestId,
      success: result.success,
      outcome: result.outcome,
      sideEffects: result.sideEffects,
      valueEstimate: result.valueEstimate,
      recommendExecution: result.recommendExecution,
      checkpointId: result.rollbackInfo?.checkpointId,
      estimatedRollbackTimeMs: result.rollbackInfo?.estimatedRollbackTimeMs
    }
  });
}));

/**
 * POST /api/research/speculative/rollback
 * Rollback to checkpoint
 */
router.post('/speculative/rollback', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { checkpointId } = req.body;

  if (!checkpointId) {
    throw new ValidationError('checkpointId is required', { field: 'checkpointId' });
  }

  logger.info('Rollback initiated', {
    correlationId: req.correlationId,
    checkpointId
  });

  if (!speculativeExecutionService) {
    return res.status(503).json({ error: 'Speculative execution service not initialized' });
  }

  const result = await speculativeExecutionService.rollback(checkpointId);

  logger.info('Rollback complete', {
    correlationId: req.correlationId,
    checkpointId,
    success: result.success,
    stepsCompleted: result.stepsCompleted
  });

  res.json({
    success: result.success,
    result: {
      stepsCompleted: result.stepsCompleted,
      totalSteps: result.totalSteps,
      rollbackTimeMs: result.rollbackTimeMs,
      failedSteps: result.failedSteps
    }
  });
}));

/**
 * GET /api/research/speculative/metrics
 * Get speculative execution metrics
 */
router.get('/speculative/metrics', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!speculativeExecutionService) {
    return res.status(503).json({ error: 'Service not initialized' });
  }

  const metrics = speculativeExecutionService.getMetrics();

  res.json({
    success: true,
    metrics
  });
}));

// ============================================================================
// Neuro-Symbolic Routes
// ============================================================================

/**
 * POST /api/research/neuro-symbolic/query
 * Execute neuro-symbolic query (NL → Logic → Inference)
 */
router.post('/neuro-symbolic/query', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const {
    query,
    domain = 'general',
    requiresVerification = false,
    maxDepth = 10,
    timeoutMs = 5000,
    includeProof = true
  } = req.body;

  if (!query || typeof query !== 'string') {
    throw new ValidationError('Query string is required', { field: 'query' });
  }

  logger.info('Neuro-symbolic query', {
    correlationId: req.correlationId,
    query: query.substring(0, 100),
    domain
  });

  if (!neuroSymbolicService) {
    return res.status(503).json({ error: 'Neuro-symbolic service not initialized' });
  }

  const result = await neuroSymbolicService.query({
    id: randomUUID(),
    naturalLanguage: query,
    domain,
    requiresVerification,
    maxDepth,
    timeoutMs,
    includeProof
  });

  logger.info('Neuro-symbolic query complete', {
    correlationId: req.correlationId,
    facts: result.inference.derivedFacts.length,
    confidence: result.confidence
  });

  res.json({
    success: true,
    query,
    result: {
      naturalAnswer: result.naturalAnswer,
      formalAnswer: result.formalAnswer,
      inference: {
        derivedFacts: result.inference.derivedFacts,
        bindings: result.inference.bindings,
        inferenceTimeMs: result.inference.inferenceTimeMs,
        iterations: result.inference.iterations
      },
      explanation: result.explanation,
      confidence: result.confidence,
      metadata: result.metadata
    }
  });
}));

/**
 * POST /api/research/neuro-symbolic/datalog/query
 * Direct Datalog query (bypass NL translation)
 */
router.post('/neuro-symbolic/datalog/query', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { program, query, maxDepth = 10 } = req.body;

  if (!query) {
    throw new ValidationError('Query atom is required', { field: 'query' });
  }

  const engine = new DatalogEngine();
  
  if (program) {
    engine.loadProgram({
      id: 'user-program',
      ...engine.parseDatalog(program),
      domain: 'user',
      version: '1.0',
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }

  const result = await engine.query(query, { maxDepth });

  res.json({
    success: result.success,
    derivedFacts: result.derivedFacts,
    bindings: result.bindings,
    inferenceTimeMs: result.inferenceTimeMs,
    iterations: result.iterations
  });
}));

/**
 * POST /api/research/neuro-symbolic/compliance/aml
 * AML compliance check
 */
router.post('/neuro-symbolic/compliance/aml', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { subject, context = [], jurisdiction = 'US' } = req.body;

  if (!subject) {
    throw new ValidationError('Subject is required', { field: 'subject' });
  }

  logger.info('AML compliance check', {
    correlationId: req.correlationId,
    subjectId: subject.customerId || subject.transactionId,
    jurisdiction
  });

  if (!neuroSymbolicService) {
    return res.status(503).json({ error: 'Neuro-symbolic service not initialized' });
  }

  // Parse high-risk countries into facts
  const countryFacts = neuroSymbolicService['datalogEngine'].parseDatalog(
    getHighRiskCountryFacts()
  );

  const result = await neuroSymbolicService.checkCompliance({
    checkType: 'aml',
    subject,
    context: [...context, ...countryFacts.facts],
    jurisdiction,
    riskLevel: subject.riskScore > 70 ? 'high' : subject.riskScore > 40 ? 'medium' : 'low'
  });

  logger.info('AML check complete', {
    correlationId: req.correlationId,
    passed: result.passed,
    violations: result.violations.length
  });

  res.json({
    success: true,
    check: {
      passed: result.passed,
      riskScore: result.riskScore,
      violations: result.violations.map(v => ({
        id: v.id,
        severity: v.severity,
        description: v.description,
        remediation: v.remediation
      })),
      recommendations: result.recommendations,
      explanation: result.explanation.summary
    }
  });
}));

/**
 * POST /api/research/neuro-symbolic/compliance/healthcare
 * Healthcare clinical safety check
 */
router.post('/neuro-symbolic/compliance/healthcare', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { patient, medications = [], allergies = [], context = [] } = req.body;

  if (!patient) {
    throw new ValidationError('Patient data is required', { field: 'patient' });
  }

  logger.info('Healthcare compliance check', {
    correlationId: req.correlationId,
    patientId: patient.id
  });

  if (!neuroSymbolicService) {
    return res.status(503).json({ error: 'Neuro-symbolic service not initialized' });
  }

  // Parse drug interactions and contraindications into facts
  const drugFacts = neuroSymbolicService['datalogEngine'].parseDatalog(
    getDrugInteractionFacts()
  );
  const contraindicationFacts = neuroSymbolicService['datalogEngine'].parseDatalog(
    getContraindicationFacts()
  );

  const result = await neuroSymbolicService.checkCompliance({
    checkType: 'clinical',
    subject: patient,
    context: [...context, ...drugFacts.facts, ...contraindicationFacts.facts],
    jurisdiction: 'US',
    riskLevel: 'medium',
    medications,
    allergies
  });

  logger.info('Healthcare check complete', {
    correlationId: req.correlationId,
    passed: result.passed,
    alerts: result.violations.length
  });

  res.json({
    success: true,
    check: {
      passed: result.passed,
      riskScore: result.riskScore,
      alerts: result.violations.map(v => ({
        id: v.id,
        severity: v.severity,
        description: v.description,
        type: v.id.startsWith('drug') ? 'drug_interaction' : 
              v.id.startsWith('contra') ? 'contraindication' : 'clinical_alert',
        remediation: v.remediation
      })),
      recommendations: result.recommendations,
      explanation: result.explanation.summary
    }
  });
}));

/**
 * POST /api/research/neuro-symbolic/compliance/legal
 * Legal contract compliance check
 */
router.post('/neuro-symbolic/compliance/legal', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { contract, jurisdiction = 'US', regulations = ['GDPR', 'SOX'] } = req.body;

  if (!contract) {
    throw new ValidationError('Contract data is required', { field: 'contract' });
  }

  logger.info('Legal compliance check', {
    correlationId: req.correlationId,
    contractId: contract.id,
    jurisdiction
  });

  if (!neuroSymbolicService) {
    return res.status(503).json({ error: 'Neuro-symbolic service not initialized' });
  }

  // Parse GDPR and high-risk terms into facts
  const gdprFacts = neuroSymbolicService['datalogEngine'].parseDatalog(
    getGDPRClauseFacts()
  );
  const riskFacts = neuroSymbolicService['datalogEngine'].parseDatalog(
    getHighRiskTermFacts()
  );

  const result = await neuroSymbolicService.checkCompliance({
    checkType: 'legal',
    subject: contract,
    context: [...gdprFacts.facts, ...riskFacts.facts],
    jurisdiction,
    regulations
  });

  logger.info('Legal check complete', {
    correlationId: req.correlationId,
    passed: result.passed,
    violations: result.violations.length
  });

  res.json({
    success: true,
    check: {
      passed: result.passed,
      riskScore: result.riskScore,
      violations: result.violations.map(v => ({
        id: v.id,
        severity: v.severity,
        description: v.description,
        regulation: v.id.startsWith('GDPR') ? 'GDPR' :
                    v.id.startsWith('CCPA') ? 'CCPA' :
                    v.id.startsWith('SOX') ? 'SOX' : 'general',
        remediation: v.remediation
      })),
      riskFactors: result.riskFactors?.map(r => ({
        type: r.type,
        severity: r.severity,
        description: r.description
      })) || [],
      recommendations: result.recommendations,
      explanation: result.explanation.summary
    }
  });
}));

/**
 * GET /api/research/neuro-symbolic/domains
 * List available domain rulesets
 */
router.get('/neuro-symbolic/domains', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  res.json({
    success: true,
    domains: [
      {
        id: 'finance',
        name: 'Financial Compliance',
        description: 'AML, KYC, and financial regulation rules',
        rules: amlRuleset.schema.map(s => s.name),
        endpoints: ['/api/research/neuro-symbolic/compliance/aml']
      },
      {
        id: 'healthcare',
        name: 'Clinical Healthcare',
        description: 'Patient safety, drug interactions, and clinical decision support',
        rules: clinicalRuleset.schema.map(s => s.name),
        endpoints: ['/api/research/neuro-symbolic/compliance/healthcare']
      },
      {
        id: 'legal',
        name: 'Legal & Contract Compliance',
        description: 'GDPR, CCPA, SOX compliance and contract risk assessment',
        rules: legalRuleset.schema.map(s => s.name),
        endpoints: ['/api/research/neuro-symbolic/compliance/legal']
      },
      {
        id: 'general',
        name: 'General Reasoning',
        description: 'Base logical inference without domain specialization'
      }
    ]
  });
}));

/**
 * GET /api/research/neuro-symbolic/metrics
 * Get neuro-symbolic service metrics
 */
router.get('/neuro-symbolic/metrics', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!neuroSymbolicService) {
    return res.status(503).json({ error: 'Service not initialized' });
  }

  const metrics = neuroSymbolicService.getMetrics();

  res.json({
    success: true,
    metrics
  });
}));

// ============================================================================
// Federated Learning Routes
// ============================================================================

/**
 * POST /api/research/federated/jobs
 * Create new federated training job
 */
router.post('/federated/jobs', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const {
    name,
    description,
    modelType,
    targetSkills,
    participants,
    config,
    rounds = 100
  } = req.body;

  if (!name || !modelType || !participants) {
    throw new ValidationError('name, modelType, and participants are required', 
      { fields: ['name', 'modelType', 'participants'] });
  }

  logger.info('Creating federated training job', {
    correlationId: req.correlationId,
    name,
    participants: participants.length
  });

  if (!federatedService) {
    return res.status(503).json({ error: 'Federated service not initialized' });
  }

  const job = await federatedService.createJob(
    name,
    description,
    modelType,
    targetSkills || [],
    participants,
    { ...DEFAULT_FEDERATED_CONFIG, ...config, rounds },
    req.user?.id
  );

  logger.info('Federated job created', {
    correlationId: req.correlationId,
    jobId: job.id,
    participants: job.participants.length
  });

  res.status(201).json({
    success: true,
    job: {
      id: job.id,
      name: job.name,
      description: job.description,
      modelType: job.modelType,
      targetSkills: job.targetSkills,
      participants: job.participants.map(p => ({ id: p.id, name: p.name })),
      totalRounds: job.totalRounds,
      currentRound: job.currentRound,
      status: job.status,
      createdAt: job.createdAt
    }
  });
}));

/**
 * POST /api/research/federated/jobs/:id/start
 * Start federated training job
 */
router.post('/federated/jobs/:id/start', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!federatedService) {
    return res.status(503).json({ error: 'Federated service not initialized' });
  }

  await federatedService.startJob(id);

  res.json({
    success: true,
    message: 'Training job started',
    jobId: id
  });
}));

/**
 * GET /api/research/federated/jobs
 * List all federated training jobs
 */
router.get('/federated/jobs', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!federatedService) {
    return res.status(503).json({ error: 'Federated service not initialized' });
  }

  const jobs = federatedService.getAllJobs();

  res.json({
    success: true,
    jobs: jobs.map(job => ({
      id: job.id,
      name: job.name,
      modelType: job.modelType,
      status: job.status,
      currentRound: job.currentRound,
      totalRounds: job.totalRounds,
      participants: job.participants.length,
      createdAt: job.createdAt
    }))
  });
}));

/**
 * GET /api/research/federated/jobs/:id
 * Get job details
 */
router.get('/federated/jobs/:id', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;

  if (!federatedService) {
    return res.status(503).json({ error: 'Federated service not initialized' });
  }

  const job = federatedService.getJob(id);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    success: true,
    job: {
      id: job.id,
      name: job.name,
      description: job.description,
      modelType: job.modelType,
      targetSkills: job.targetSkills,
      status: job.status,
      currentRound: job.currentRound,
      totalRounds: job.totalRounds,
      participants: job.participants.map(p => ({
        id: p.id,
        name: p.name,
        status: p.status,
        lastContributionAt: p.lastContributionAt
      })),
      currentModel: job.currentModel ? {
        version: job.currentModel.version,
        validationMetrics: job.currentModel.validationMetrics
      } : null,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt
    }
  });
}));

/**
 * POST /api/research/federated/orgs
 * Register organization
 */
router.post('/federated/orgs', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { id, name, publicKey, dataProfile } = req.body;

  if (!id || !name || !publicKey) {
    throw new ValidationError('id, name, and publicKey are required',
      { fields: ['id', 'name', 'publicKey'] });
  }

  if (!federatedService) {
    return res.status(503).json({ error: 'Federated service not initialized' });
  }

  const org = await federatedService.registerOrg(id, name, publicKey, dataProfile);

  res.status(201).json({
    success: true,
    org: {
      id: org.id,
      name: org.name,
      status: org.status,
      dataProfile: org.dataProfile,
      joinedAt: org.joinedAt
    }
  });
}));

/**
 * GET /api/research/federated/metrics
 * Get federated learning metrics
 */
router.get('/federated/metrics', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!federatedService) {
    return res.status(503).json({ error: 'Federated service not initialized' });
  }

  const metrics = federatedService.getMetrics();

  res.json({
    success: true,
    metrics
  });
}));

// ============================================================================
// Causal Reasoning Routes
// ============================================================================

/**
 * POST /api/research/causal/graphs
 * Load causal graph
 */
router.post('/causal/graphs', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { graph } = req.body;

  if (!graph) {
    throw new ValidationError('graph is required', { field: 'graph' });
  }

  if (!causalService) {
    return res.status(503).json({ error: 'Causal service not initialized' });
  }

  causalService.loadGraph(graph);

  res.status(201).json({
    success: true,
    message: 'Causal graph loaded',
    graphId: graph.id,
    variables: graph.variables.length,
    edges: graph.edges.length
  });
}));

/**
 * POST /api/research/causal/estimate/ate
 * Estimate Average Treatment Effect
 */
router.post('/causal/estimate/ate', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { graphId, treatment, outcome, data } = req.body;

  if (!graphId || !treatment || !outcome || !data) {
    throw new ValidationError('graphId, treatment, outcome, and data are required',
      { fields: ['graphId', 'treatment', 'outcome', 'data'] });
  }

  if (!causalService) {
    return res.status(503).json({ error: 'Causal service not initialized' });
  }

  const estimate = await causalService.estimateATE(graphId, treatment, outcome, data);

  res.json({
    success: true,
    estimate: {
      type: estimate.type,
      value: estimate.value,
      confidenceInterval: estimate.confidenceInterval,
      standardError: estimate.standardError,
      pValue: estimate.pValue,
      method: estimate.method,
      identification: estimate.identification,
      adjustmentSet: estimate.adjustmentSet
    }
  });
}));

/**
 * POST /api/research/causal/counterfactual
 * Compute counterfactual scenario
 */
router.post('/causal/counterfactual', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { graphId, factualEvidence, hypothetical, outcomeVar } = req.body;

  if (!graphId || !factualEvidence || !hypothetical || !outcomeVar) {
    throw new ValidationError('graphId, factualEvidence, hypothetical, and outcomeVar are required',
      { fields: ['graphId', 'factualEvidence', 'hypothetical', 'outcomeVar'] });
  }

  if (!causalService) {
    return res.status(503).json({ error: 'Causal service not initialized' });
  }

  const scenario = await causalService.computeCounterfactual(
    graphId,
    factualEvidence,
    hypothetical,
    outcomeVar
  );

  res.json({
    success: true,
    scenario: {
      id: scenario.id,
      factualEvidence: scenario.factualEvidence,
      hypothetical: scenario.hypothetical,
      counterfactualOutcome: scenario.counterfactualOutcome,
      explanation: scenario.explanation
    }
  });
}));

/**
 * POST /api/research/causal/root-cause
 * Analyze root cause
 */
router.post('/causal/root-cause', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { graphId, outcome, context } = req.body;

  if (!graphId || !outcome) {
    throw new ValidationError('graphId and outcome are required',
      { fields: ['graphId', 'outcome'] });
  }

  if (!causalService) {
    return res.status(503).json({ error: 'Causal service not initialized' });
  }

  const analysis = await causalService.analyzeRootCause(graphId, outcome, context || {});

  res.json({
    success: true,
    analysis: {
      id: analysis.id,
      outcome: analysis.outcome,
      rootCauses: analysis.rootCauses.slice(0, 5),  // Top 5
      causalChains: analysis.causalChains,
      recommendations: analysis.recommendations
    }
  });
}));

/**
 * GET /api/research/causal/metrics
 * Get causal reasoning metrics
 */
router.get('/causal/metrics', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!causalService) {
    return res.status(503).json({ error: 'Causal service not initialized' });
  }

  const metrics = causalService.getMetrics();

  res.json({
    success: true,
    metrics
  });
}));

// ============================================================================
// Liquid Neural Networks Routes
// ============================================================================

/**
 * POST /api/research/lnn/agents
 * Create LNN agent
 */
router.post('/lnn/agents', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { name, taskType, config, realTimeAdaptation, edgeOptimized } = req.body;

  if (!name || !taskType) {
    throw new ValidationError('name and taskType are required',
      { fields: ['name', 'taskType'] });
  }

  if (!lnnService) {
    return res.status(503).json({ error: 'LNN service not initialized' });
  }

  const agent = await lnnService.createAgent(
    name,
    taskType,
    { ...DEFAULT_LNN_CONFIG, ...config },
    { realTimeAdaptation, edgeOptimized }
  );

  res.status(201).json({
    success: true,
    agent: {
      id: agent.id,
      name: agent.name,
      taskType: agent.taskType,
      config: {
        numNeurons: agent.config.numNeurons,
        timeConstant: agent.config.timeConstant,
        inputDim: agent.config.inputDim,
        outputDim: agent.config.outputDim
      },
      realTimeAdaptation: agent.realTimeAdaptation,
      edgeOptimized: agent.edgeOptimized
    }
  });
}));

/**
 * POST /api/research/lnn/agents/:id/forward
 * Run forward pass through LNN
 */
router.post('/lnn/agents/:id/forward', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { input } = req.body;

  if (!input || !Array.isArray(input)) {
    throw new ValidationError('input array is required', { field: 'input' });
  }

  if (!lnnService) {
    return res.status(503).json({ error: 'LNN service not initialized' });
  }

  const result = await lnnService.forward(id, input);

  res.json({
    success: true,
    result: {
      output: result.output,
      activations: result.activations.slice(0, 10),  // First 10 only
      computeTimeMs: result.computeTimeMs,
      stepsTaken: result.stepsTaken
    }
  });
}));

/**
 * POST /api/research/lnn/agents/:id/adapt
 * Adapt agent to new data
 */
router.post('/lnn/agents/:id/adapt', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { input, target } = req.body;

  if (!input || !target) {
    throw new ValidationError('input and target are required',
      { fields: ['input', 'target'] });
  }

  if (!lnnService) {
    return res.status(503).json({ error: 'LNN service not initialized' });
  }

  const event = await lnnService.adapt(id, input, target);

  res.json({
    success: true,
    adaptation: {
      timestamp: event.timestamp,
      error: event.error,
      stateChange: event.stateChange
    }
  });
}));

/**
 * GET /api/research/lnn/agents
 * List all LNN agents
 */
router.get('/lnn/agents', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!lnnService) {
    return res.status(503).json({ error: 'LNN service not initialized' });
  }

  const agents = lnnService.getAllAgents();

  res.json({
    success: true,
    agents: agents.map(agent => ({
      id: agent.id,
      name: agent.name,
      taskType: agent.taskType,
      config: {
        numNeurons: agent.config.numNeurons,
        timeConstant: agent.config.timeConstant
      },
      realTimeAdaptation: agent.realTimeAdaptation,
      edgeOptimized: agent.edgeOptimized
    }))
  });
}));

/**
 * GET /api/research/lnn/metrics
 * Get LNN service metrics
 */
router.get('/lnn/metrics', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  if (!lnnService) {
    return res.status(503).json({ error: 'LNN service not initialized' });
  }

  const metrics = lnnService.getMetrics();

  res.json({
    success: true,
    metrics
  });
}));

// ============================================================================
// Health & Status
// ============================================================================

/**
 * GET /api/research/health
 * Health check for all research services
 */
router.get('/health', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const services = {
    graphRAG: !!graphRAGService,
    constitutionalAI: !!constitutionalAIService,
    multiModal: !!visionService && !!documentService,
    speculativeExecution: !!speculativeExecutionService,
    neuroSymbolic: !!neuroSymbolicService,
    federatedLearning: !!federatedService,
    causalReasoning: !!causalService,
    liquidNeuralNetworks: !!lnnService
  };

  const allHealthy = Object.values(services).every(Boolean);

  res.status(allHealthy ? 200 : 503).json({
    success: allHealthy,
    services,
    timestamp: new Date().toISOString()
  });
}));

export default router;
