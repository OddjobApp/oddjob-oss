/**
 * Hybrid Reasoning Service
 * 
 * Combines neural (LLM) and symbolic (Datalog) reasoning.
 * Natural language understanding + formal verification.
 */

import { DatalogEngine } from './datalog-engine.js';
import {
  NeuroSymbolicQuery,
  NeuroSymbolicResponse,
  LogicTranslation,
  InferenceResult,
  Explanation,
  ExplanationStep,
  NeuroSymbolicConfig,
  DEFAULT_NEURO_SYMBOLIC_CONFIG,
  NeuroSymbolicError,
  NeuroSymbolicErrorType,
  NeuroSymbolicMetrics,
  ComplianceCheckRequest,
  ComplianceCheckResult,
  ComplianceViolation,
  SymbolicFact,
  LogicAtom,
  LogicTerm,
  DomainRuleset,
  DatalogProgram,
  ProofTreeNode,
  LogicRule
} from './types.js';
import { createLogger } from '../../../../utils/logger.js';
import { randomUUID } from 'crypto';

const logger = createLogger('HybridReasoningService');

/**
 * LLM Client Interface
 */
interface LLMClient {
  generate(params: {
    prompt: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string>;
  
  generateStructured<T>(params: {
    prompt: string;
    schema: object;
    temperature?: number;
  }): Promise<T>;
}

/**
 * Hybrid Reasoning Service
 */
export class HybridReasoningService {
  private datalogEngine: DatalogEngine;
  private config: NeuroSymbolicConfig;
  private llmClient: LLMClient;
  private domainRulesets: Map<string, DomainRuleset> = new Map();
  private cache: Map<string, { response: NeuroSymbolicResponse; expiresAt: Date }> = new Map();
  private metrics: NeuroSymbolicMetrics;

  constructor(llmClient: LLMClient, config?: Partial<NeuroSymbolicConfig>) {
    this.llmClient = llmClient;
    this.config = { ...DEFAULT_NEURO_SYMBOLIC_CONFIG, ...config };
    this.datalogEngine = new DatalogEngine();
    this.metrics = {
      totalQueries: 0,
      successfulInferences: 0,
      failedInferences: 0,
      avgProcessingTimeMs: 0,
      avgInferenceTimeMs: 0,
      cacheHitRate: 0,
      hallucinationRate: 0,
      verificationSuccessRate: 0
    };

    logger.info('Hybrid Reasoning Service initialized', {
      enableVerification: this.config.enableVerification,
      defaultMaxDepth: this.config.defaultMaxDepth
    });
  }

  /**
   * Process a neuro-symbolic query
   */
  async query(query: NeuroSymbolicQuery): Promise<NeuroSymbolicResponse> {
    const startTime = Date.now();
    const queryId = query.id || randomUUID();

    logger.info(`[${queryId}] Processing query: ${query.naturalLanguage.substring(0, 100)}`);

    try {
      // A required guarantee must never be satisfied by a cache hit or a disabled/stub verifier.
      if (query.requiresVerification) {
        throw new NeuroSymbolicError(
          NeuroSymbolicErrorType.VERIFICATION_FAILED,
          'Formal verification is unavailable; this request cannot be executed with the required guarantee',
          queryId
        );
      }
      // Check cache
      if (this.config.enableCache) {
        const cached = this.getCachedResult(query);
        if (cached) {
          logger.info(`[${queryId}] Cache hit`);
          return {
            ...cached,
            metadata: {
              ...cached.metadata,
              totalTimeMs: Date.now() - startTime
            }
          };
        }
      }

      // Step 1: Neural - Parse and translate natural language to logic
      const parsingStart = Date.now();
      const translation = await this.translateToLogic(query);
      const parsingTimeMs = Date.now() - parsingStart;

      logger.debug(`[${queryId}] Translation complete: ${translation.logicLanguage}`);


      // Step 3: Parse and load Datalog program
      // Each request owns its engine: concurrent LLM calls cannot overwrite another request's facts.
      const engine = new DatalogEngine();
      const program = engine.parseDatalog(translation.logicForm);
      program.rules.push(...(this.domainRulesets.get(query.domain)?.rules ?? []));
      
      // Add extracted facts
      for (const entity of translation.entities) {
        program.facts.push({
          id: `entity-${randomUUID()}`,
          predicate: 'entity',
          arguments: [entity.normalized, entity.type],
          negated: false,
          source: 'extracted',
          confidence: entity.confidence,
          timestamp: new Date(),
          metadata: { originalText: entity.text }
        });
      }

      for (const relation of translation.relations) {
        program.facts.push({
          id: `relation-${randomUUID()}`,
          predicate: relation.type,
          arguments: [relation.subject, relation.object],
          negated: false,
          source: 'extracted',
          confidence: relation.confidence,
          timestamp: new Date()
        });
      }

      engine.loadProgram({
        id: queryId,
        ...program,
        domain: query.domain,
        version: '1.0',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Step 4: Symbolic - Run inference
      const inferenceStart = Date.now();
      
      // Build query atom from translation
      const queryAtom = this.buildQueryAtom(translation);
      
      const inferenceResult = await engine.query(queryAtom, {
        maxDepth: query.maxDepth || this.config.defaultMaxDepth,
        timeoutMs: query.timeoutMs || this.config.defaultTimeoutMs,
        includeProof: query.includeProof
      });
      
      const inferenceTimeMs = Date.now() - inferenceStart;

      // Step 5: Verification (if requested)
      const verificationResult: NeuroSymbolicResponse['verification'] = undefined;


      // Step 6: Neural - Generate natural language answer
      const nlAnswer = await this.generateNaturalLanguageAnswer(
        query,
        translation,
        inferenceResult
      );

      // Build explanation
      const explanation = this.buildExplanation(translation, inferenceResult);

      // Calculate confidence
      const confidence = this.calculateConfidence(translation, inferenceResult);

      // Build response
      const totalTimeMs = Date.now() - startTime;
      
      const response: NeuroSymbolicResponse = {
        queryId,
        naturalAnswer: nlAnswer,
        formalAnswer: inferenceResult.derivedFacts.map(f => ({
          predicate: f.predicate,
          arguments: f.arguments.map((arg, i) => ({
            type: 'constant',
            value: arg
          })),
          negated: f.negated
        })),
        inference: inferenceResult,
        verification: verificationResult,
        explanation,
        confidence,
        metadata: {
          totalTimeMs,
          parsingTimeMs,
          translationTimeMs: parsingTimeMs,  // Combined in this implementation
          inferenceTimeMs,
          verificationTimeMs: undefined,
          logicLanguage: translation.logicLanguage,
          factsConsidered: engine.getStats().totalFacts,
          rulesConsidered: engine.getStats().rules
        }
      };

      // Cache result
      if (this.config.enableCache) {
        this.cacheResult(query, response);
      }

      // Update metrics
      this.updateMetrics(response, true, totalTimeMs);

      logger.info(`[${queryId}] Query complete: ${inferenceResult.derivedFacts.length} facts, ${totalTimeMs}ms`);

      return response;

    } catch (error) {
      logger.error(`[${queryId}] Query failed:`, error);
      this.updateMetrics(null, false, Date.now() - startTime);
      if (error instanceof NeuroSymbolicError) throw error;
      throw new NeuroSymbolicError(
        NeuroSymbolicErrorType.INFERENCE_FAILED,
        `Query processing failed: ${(error as Error).message}`,
        queryId,
        error as Error
      );
    }
  }

  /**
   * Translate natural language to logic
   */
  private async translateToLogic(
    query: NeuroSymbolicQuery
  ): Promise<LogicTranslation> {
    const prompt = this.buildTranslationPrompt(query);

    const result = await this.llmClient.generateStructured<{
      logicForm: string;
      logicLanguage: string;
      entities: { text: string; type: string; normalized: string; start: number; end: number; confidence: number }[];
      relations: { type: string; subject: string; object: string; confidence: number }[];
      confidence: number;
      alternatives: string[];
    }>({
      prompt,
      schema: {
        type: 'object',
        properties: {
          logicForm: { type: 'string', description: 'Datalog logic program representing the query' },
          logicLanguage: { type: 'string', enum: ['datalog', 'prolog', 'fol'] },
          entities: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                type: { type: 'string' },
                normalized: { type: 'string' },
                start: { type: 'number' },
                end: { type: 'number' },
                confidence: { type: 'number' }
              }
            }
          },
          relations: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                subject: { type: 'string' },
                object: { type: 'string' },
                confidence: { type: 'number' }
              }
            }
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          alternatives: { type: 'array', items: { type: 'string' } }
        },
        required: ['logicForm', 'logicLanguage', 'confidence']
      },
      temperature: this.config.translationTemperature
    });

    return {
      originalText: query.naturalLanguage,
      logicForm: result.logicForm,
      logicLanguage: result.logicLanguage,
      entities: result.entities || [],
      relations: result.relations || [],
      confidence: result.confidence,
      alternatives: result.alternatives || []
    };
  }

  /**
   * Build translation prompt
   */
  private buildTranslationPrompt(query: NeuroSymbolicQuery): string {
    const domain = query.domain || 'general';
    
    return `Translate the following natural language query into Datalog logic programming syntax.

Domain: ${domain}
Query: "${query.naturalLanguage}"

Instructions:
1. Identify all entities mentioned in the query
2. Identify relationships between entities
3. Convert the query intent into Datalog rules
4. Use standard Datalog syntax: predicate(arg1, arg2, ...)
5. Variables should start with uppercase or use ? prefix
6. Facts should end with a period: fact(arg).
7. Rules should use :- notation: head(arg) :- body(arg).

Example translations:
- "Who manages Alice?" → manages(X, alice)?
- "Is this transaction suspicious?" → suspicious(transaction123)?
- "Find all customers with high risk" → customer(X), risk_score(X, R), R > 80?

Respond with a structured translation including:
- logicForm: The complete Datalog program
- entities: Extracted entities with positions
- relations: Semantic relations found
- confidence: Your confidence in this translation (0-1)
- alternatives: Alternative interpretations if ambiguous`;
  }

  /**
   * Build query atom from translation
   */
  private buildQueryAtom(translation: LogicTranslation): LogicAtom {
    const lines = translation.logicForm.split('\n').map(line => line.trim()).filter(Boolean);
    const explicit = lines.find(line => line.startsWith('?-') || /\)\s*\?$/.test(line));
    if (explicit) return this.datalogEngine.parseQuery(explicit);
    const program = this.datalogEngine.parseDatalog(translation.logicForm);
    const rule = program.rules.at(-1);
    if (rule) return rule.head;
    const fact = program.facts.at(-1);
    if (fact) return { predicate: fact.predicate, arguments: fact.arguments.map(value => ({ type: 'constant' as const, value })), negated: false };
    throw new NeuroSymbolicError(NeuroSymbolicErrorType.TRANSLATION_FAILED, 'Translation contains no query');
  }

  /**
   * Generate natural language answer
   */
  private async generateNaturalLanguageAnswer(
    query: NeuroSymbolicQuery,
    translation: LogicTranslation,
    inference: InferenceResult
  ): Promise<string> {
    const facts = inference.derivedFacts;
    
    if (facts.length === 0) {
      return `I could not find any information to answer: "${query.naturalLanguage}"`;
    }

    const prompt = `Given the query "${query.naturalLanguage}" and the following facts:
${facts.map(f => `- ${f.predicate}(${f.arguments.join(', ')})`).join('\n')}

Generate a natural language answer that:
1. Directly answers the original question
2. Mentions specific facts found
3. Provides confidence level
4. Is concise but complete`;

    const answer = await this.llmClient.generate({
      prompt,
      temperature: 0.3,
      maxTokens: 500
    });

    return answer.trim();
  }

  /**
   * Build explanation
   */
  private buildExplanation(
    translation: LogicTranslation,
    inference: InferenceResult
  ): Explanation {
    const steps: ExplanationStep[] = [
      {
        step: 1,
        text: `Analyzed the query: "${translation.originalText}"`,
        formal: translation.logicForm,
        reference: 'translation'
      },
      {
        step: 2,
        text: `Extracted ${translation.entities.length} entities and ${translation.relations.length} relations`,
        formal: `Entities: ${translation.entities.map(e => e.normalized).join(', ')}`,
        reference: 'extraction'
      },
      {
        step: 3,
        text: `Ran symbolic inference and derived ${inference.derivedFacts.length} facts`,
        formal: inference.derivedFacts.map(f => `${f.predicate}(${f.arguments.join(', ')})`).join('; '),
        reference: 'inference'
      }
    ];

    let proofTree: ProofTreeNode | undefined = undefined;
    if (inference.derivedFacts.length > 0) {
      try {
        const program = this.datalogEngine.export();
        const allFactsCombined = [
          ...program.facts,
          ...inference.proofTrace.map(p => p.result)
        ];
        const uniqueFacts = Array.from(new Map(allFactsCombined.map(f => [f.id, f])).values());
        proofTree = this.buildProofTree(inference.derivedFacts[0], uniqueFacts, program.rules);
      } catch (err) {
        logger.error("Failed to build proof tree for explanation:", err);
      }
    }

    return {
      summary: `Answer derived through neuro-symbolic reasoning combining LLM translation with Datalog inference.`,
      steps,
      keyFacts: inference.derivedFacts,
      rulesApplied: inference.proofTrace.map(p => p.rule),
      proofTree
    };
  }

  /**
   * Recursively build proof tree node from a derived or EDB fact
   */
  private buildProofTree(
    fact: SymbolicFact,
    allFacts: SymbolicFact[],
    rules: LogicRule[]
  ): ProofTreeNode {
    const conclusion: LogicAtom = {
      predicate: fact.predicate,
      arguments: fact.arguments.map(arg => ({ type: 'constant', value: arg })),
      negated: fact.negated
    };

    const ruleId = fact.metadata?.ruleId;
    const sourceFactId = fact.metadata?.sourceFactId;

    if (ruleId && sourceFactId) {
      const rule = rules.find(r => r.id === ruleId);
      const sourceFact = allFacts.find(f => f.id === sourceFactId);

      const premises: ProofTreeNode[] = [];
      if (sourceFact) {
        premises.push(this.buildProofTree(sourceFact, allFacts, rules));
      }

      return {
        conclusion,
        premises,
        rule,
        isLeaf: false
      };
    }

    return {
      conclusion,
      premises: [],
      isLeaf: true
    };
  }

  /**
   * Calculate overall confidence
   */
  private calculateConfidence(
    translation: LogicTranslation,
    inference: InferenceResult
  ): number {
    const translationConfidence = translation.confidence;
    const inferenceConfidence = inference.derivedFacts.length > 0
      ? inference.derivedFacts.reduce((sum, f) => sum + f.confidence, 0) / inference.derivedFacts.length
      : 0;
    
    return (translationConfidence * 0.4 + inferenceConfidence * 0.6);
  }

  /**
   * Verify inference result
   */
  /**
   * Load domain ruleset
   */
  loadDomainRuleset(ruleset: DomainRuleset): void {
    this.domainRulesets.set(ruleset.domain, ruleset);
    
    // Convert ruleset to Datalog program
    const program: DatalogProgram = {
      id: `domain-${ruleset.domain}`,
      facts: [],
      rules: ruleset.rules,
      domain: ruleset.domain,
      version: ruleset.version,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.datalogEngine.loadProgram(program);
    logger.info(`Loaded domain ruleset: ${ruleset.domain} (${ruleset.rules.length} rules)`);
  }

  /**
   * Compliance check (financial example)
   */
  async checkCompliance(
    request: ComplianceCheckRequest
  ): Promise<ComplianceCheckResult> {
    // Load compliance domain
    const complianceDomain = this.domainRulesets.get(request.checkType);
    if (!complianceDomain) {
      throw new NeuroSymbolicError(
        NeuroSymbolicErrorType.UNKNOWN,
        `Unknown compliance check type: ${request.checkType}`
      );
    }

    this.loadDomainRuleset(complianceDomain);

    // Convert subject to facts
    const subjectFacts: SymbolicFact[] = [];
    for (const [key, value] of Object.entries(request.subject)) {
      subjectFacts.push({
        id: `subject-${key}`,
        predicate: key,
        arguments: [String(value)],
        negated: false,
        source: 'extracted',
        confidence: 1.0,
        timestamp: new Date()
      });
    }

    // Add context facts
    this.datalogEngine.loadProgram({
      id: `compliance-${randomUUID()}`,
      facts: [...subjectFacts, ...request.context],
      rules: complianceDomain.rules,
      domain: request.checkType,
      version: '1.0',
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Query for violations
    const violationQuery: LogicAtom = {
      predicate: 'violation',
      arguments: [{ type: 'variable', name: 'X' }],
      negated: false
    };

    const inference = await this.datalogEngine.query(violationQuery, {
      maxDepth: 10,
      timeoutMs: 5000,
      includeProof: true
    });

    // Build violations
    const violations: ComplianceViolation[] = inference.derivedFacts.map((fact, i) => ({
      id: `violation-${i}`,
      rule: inference.proofTrace[i]?.rule || {
        id: 'unknown',
        name: 'Unknown Rule',
        head: violationQuery,
        body: [],
        defeasible: false,
        priority: 0,
        source: 'domain',
        explanationTemplate: 'Violation detected'
      },
      severity: 'major',  // Would determine from rule metadata
      description: `Violation: ${fact.predicate}(${fact.arguments.join(', ')})`,
      remediation: 'Review and address the violation'
    }));

    const riskScore = Math.min(100, violations.length * 25);

    return {
      passed: violations.length === 0,
      violations,
      riskScore,
      recommendations: violations.map(v => v.remediation),
      regulatoryRefs: ['Compliance Framework v1.0'],
      explanation: this.buildExplanation(
        { 
          originalText: `${request.checkType} check`,
          logicForm: '',
          logicLanguage: 'datalog',
          entities: [],
          relations: [],
          confidence: 1,
          alternatives: []
        },
        inference
      ),
      auditTrail: inference.proofTrace
    };
  }

  /**
   * Get cached result
   */
  private getCachedResult(query: NeuroSymbolicQuery): NeuroSymbolicResponse | null {
    const key = this.getCacheKey(query);
    const entry = this.cache.get(key);
    
    if (!entry) return null;
    
    if (new Date() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.response;
  }

  /**
   * Cache result
   */
  private cacheResult(query: NeuroSymbolicQuery, response: NeuroSymbolicResponse): void {
    const key = this.getCacheKey(query);
    const expiresAt = new Date(Date.now() + this.config.cacheTtl * 1000);
    
    this.cache.set(key, { response, expiresAt });
  }

  /**
   * Get cache key
   */
  private getCacheKey(query: NeuroSymbolicQuery): string {
    return `ns-${query.domain}-${query.naturalLanguage}`;
  }

  /**
   * Update metrics
   */
  private updateMetrics(
    response: NeuroSymbolicResponse | null,
    success: boolean,
    totalTimeMs: number
  ): void {
    this.metrics.totalQueries++;
    
    if (success && response) {
      this.metrics.successfulInferences++;
      
      // Update averages
      const n = this.metrics.totalQueries;
      this.metrics.avgProcessingTimeMs = 
        (this.metrics.avgProcessingTimeMs * (n - 1) + totalTimeMs) / n;
      this.metrics.avgInferenceTimeMs = 
        (this.metrics.avgInferenceTimeMs * (n - 1) + response.metadata.inferenceTimeMs) / n;
      
      // Hallucination rate (facts with low confidence)
      const lowConfidenceFacts = response.inference.derivedFacts.filter(f => f.confidence < 0.5).length;
      const totalFacts = response.inference.derivedFacts.length;
      if (totalFacts > 0) {
        this.metrics.hallucinationRate = 
          (this.metrics.hallucinationRate * (n - 1) + (lowConfidenceFacts / totalFacts)) / n;
      }
    } else {
      this.metrics.failedInferences++;
    }
  }

  /**
   * Get metrics
   */
  getMetrics(): NeuroSymbolicMetrics {
    return { ...this.metrics };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Cache cleared');
  }
}
