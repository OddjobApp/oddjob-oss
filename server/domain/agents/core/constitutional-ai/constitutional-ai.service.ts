/**
 * Constitutional AI Service
 * 
 * Main service for agent safety with constitutional principles.
 * Provides review, critique, auto-correction, and escalation.
 */

import { CritiqueEngine } from './critique.engine.js';
import {
  AgentAction,
  AgentContext,
  Constitution,
  ConstitutionalPrinciple,
  ConstitutionalReview,
  ConstitutionalCheck,
  ConstitutionalAIConfig,
  DEFAULT_CONSTITUTIONAL_AI_CONFIG,
  DEFAULT_CONSTITUTION,
  ViolationReport,
  EscalationRequest,
  ConstitutionalAIMetrics,
  ConstitutionalAIError,
  ConstitutionalAIErrorType
} from './types.js';
import { createLogger } from '../../../../utils/logger.js';
import { randomUUID } from 'crypto';
import { debateMechanismService } from './debate-mechanism.service.js';

const logger = createLogger('ConstitutionalAIService');

/**
 * Constitution Repository Interface
 */
interface ConstitutionRepository {
  getById(id: string, organizationId: number): Promise<Constitution | null>;
  getDefault(organizationId: number): Promise<Constitution>;
  save(constitution: Constitution): Promise<void>;
  list(organizationId: number): Promise<Constitution[]>;
}

/**
 * Event Stream Service Interface
 */
interface EventStreamService {
  publish(event: { type: string; payload: any }): Promise<void>;
}

/**
 * Constitutional AI Service
 */
export class ConstitutionalAIService {
  private critiqueEngine: CritiqueEngine;
  private config: ConstitutionalAIConfig;
  private reviews: Map<string, ConstitutionalReview> = new Map();
  private violationReports: Map<string, ViolationReport> = new Map();
  private metrics: ConstitutionalAIMetrics;

  constructor(
    private llmClient: LLMClient,
    private constitutionRepo: ConstitutionRepository,
    private eventStream: EventStreamService,
    config?: Partial<ConstitutionalAIConfig>
  ) {
    this.config = { ...DEFAULT_CONSTITUTIONAL_AI_CONFIG, ...config };
    
    this.critiqueEngine = new CritiqueEngine(llmClient, {
      model: this.config.critiqueModel,
      temperature: this.config.critiqueTemperature,
      timeoutMs: this.config.critiqueTimeoutMs
    });

    this.metrics = {
      totalReviews: 0,
      totalViolations: 0,
      violationsByCategory: {},
      violationsBySeverity: {},
      autoCorrectionRate: 0,
      averageReviewTimeMs: 0,
      falsePositiveRate: 0,
      humanOverrideRate: 0
    };

    logger.info('Constitutional AI Service initialized', {
      enabled: this.config.enabled,
      defaultConstitutionId: this.config.defaultConstitutionId
    });
  }

  /**
   * Review an agent action against the constitution
   */
  async reviewAction(
    action: AgentAction,
    context: AgentContext,
    constitutionId?: string
  ): Promise<ConstitutionalReview> {
    const reviewId = randomUUID();
    const startTime = Date.now();

    logger.info(`[${reviewId}] Starting constitutional review for action ${action.id}`);

    // Emit review started event
    await this.eventStream.publish({
      type: 'constitutional.review_started',
      payload: { reviewId, actionId: action.id }
    });

    try {
      // Skip if disabled
      if (!this.config.enabled) {
        logger.info(`[${reviewId}] Constitutional AI disabled, auto-approving`);
        return this.createAutoApprovedReview(reviewId, action);
      }

      // Load constitution
      const constitution = await this.loadConstitution(
        constitutionId || this.config.defaultConstitutionId,
        context.organizationId
      );

      // Select principles to check (respect max limit)
      const principlesToCheck = constitution.principles
        .slice(0, this.config.maxPrinciplesPerCheck);

      logger.debug(`[${reviewId}] Checking against ${principlesToCheck.length} principles`);

      // Run constitutional checks
      const checks = await this.critiqueEngine.critiqueAgainstPrinciples(
        action,
        principlesToCheck,
        context,
        this.config.parallelChecking
      );

      // Apply debate mechanism if enabled for enhanced safety
      if (this.config.enableDebateMechanism && action.output) {
        logger.debug(`[${reviewId}] Applying debate mechanism for enhanced safety`);
        
        const constitutionText = principlesToCheck
          .map(p => p.rule)
          .join('\n\n');
        
        const debateResult = await debateMechanismService.debateSafety(
          action.output,
          constitutionText,
          { taskId: reviewId, actionId: action.id }
        );

        // Incorporate debate results into checks
        if (debateResult.finalVerdict === "unsafe") {
          // Add a synthetic blocking violation from the debate
          const debateViolation: ConstitutionalCheck = {
            principle: {
              id: "debate-mechanism",
              name: "Multi-Agent Debate",
              description: "Generated from debate mechanism",
              rule: "Output must be safe according to multi-agent debate evaluation",
              category: "safety",
              severity: "blocking",
              autoCorrect: false,
              examples: { compliant: [], violating: [] }
            },
            compliant: false,
            critique: debateResult.finalArgument,
            action: action,
            confidence: 1 - debateResult.safetyScore,
            revisedAction: undefined,
            checkedAt: new Date(),
            reviewTimeMs: 0
          };
          checks.push(debateViolation);
        } else if (debateResult.finalVerdict === "needs_revision" && debateResult.requiredChanges.length > 0) {
          // Add a warning with required changes
          const debateWarning: ConstitutionalCheck = {
            principle: {
              id: "debate-mechanism",
              name: "Multi-Agent Debate",
              description: "Generated from debate mechanism",
              rule: "Output may need revision based on debate evaluation",
              category: "safety",
              severity: "warning",
              autoCorrect: true,
              examples: { compliant: [], violating: [] }
            },
            compliant: false,
            critique: `Required changes: ${debateResult.requiredChanges.join('; ')}`,
            action: action,
            confidence: 1 - debateResult.safetyScore,
            revisedAction: {
              ...action,
              output: this.applyRequiredChanges(action.output || "", debateResult.requiredChanges)
            },
            checkedAt: new Date(),
            reviewTimeMs: 0
          };
          checks.push(debateWarning);
        }
      }

      // Categorize violations
      const blockingViolations = checks.filter(c => 
        !c.compliant && 
        (c.principle.severity === 'blocking' || c.principle.severity === 'critical')
      );
      
      const warnings = checks.filter(c => 
        !c.compliant && 
        c.principle.severity !== 'blocking' && 
        c.principle.severity !== 'critical'
      );

      // Determine final action
      let finalAction = action;
      let approved = true;
      let requiresEscalation = false;

      if (blockingViolations.length > 0) {
        // Try auto-correction
        if (this.config.enableAutoCorrection) {
          finalAction = await this.handleBlockingViolations(
            action,
            blockingViolations
          );
          
          // If auto-correction succeeded, approve with revision
          approved = finalAction !== action;
        } else {
          approved = false;
          requiresEscalation = true;
        }
      }

      // Build review result
      const review: ConstitutionalReview = {
        reviewId,
        originalAction: action,
        checks,
        finalAction,
        blockingViolations,
        warnings,
        totalReviewTimeMs: Date.now() - startTime,
        approved,
        requiresEscalation,
        reviewedAt: new Date()
      };

      // Store review
      this.reviews.set(reviewId, review);

      // Update metrics
      this.updateMetrics(review);

      // Emit events
      await this.emitReviewEvents(review);

      // Create violation reports for blocking violations
      if (blockingViolations.length > 0) {
        await this.createViolationReports(review, blockingViolations);
      }

      logger.info(`[${reviewId}] Review complete: ${approved ? 'APPROVED' : 'REJECTED'} (${review.totalReviewTimeMs}ms)`);

      return review;

    } catch (error) {
      logger.error(`[${reviewId}] Review failed:`, error);
      
      // Fail-safe: reject on error
      return {
        reviewId,
        originalAction: action,
        checks: [],
        finalAction: action,
        blockingViolations: [],
        warnings: [],
        totalReviewTimeMs: Date.now() - startTime,
        approved: false,
        requiresEscalation: true,
        reviewedAt: new Date()
      };
    }
  }

  /**
   * Review outcome of an action (post-execution)
   */
  async reviewOutcome(
    action: AgentAction,
    actualOutcome: any,
    expectedOutcome?: string
  ): Promise<{
    aligned: boolean;
    issues: string[];
    recommendation?: string;
  }> {
    // Compare actual vs expected outcome
    const issues: string[] = [];
    
    if (expectedOutcome && actualOutcome !== expectedOutcome) {
      issues.push(`Outcome mismatch: expected "${expectedOutcome}", got "${actualOutcome}"`);
    }

    // Check for unexpected side effects
    // This would require outcome analysis logic

    return {
      aligned: issues.length === 0,
      issues,
      recommendation: issues.length > 0 
        ? 'Review action parameters and expected outcomes'
        : undefined
    };
  }

  /**
   * Get review by ID
   */
  getReview(reviewId: string): ConstitutionalReview | undefined {
    return this.reviews.get(reviewId);
  }

  /**
   * Get all reviews for an action
   */
  getReviewsForAction(actionId: string): ConstitutionalReview[] {
    return Array.from(this.reviews.values())
      .filter(r => r.originalAction.id === actionId)
      .sort((a, b) => b.reviewedAt.getTime() - a.reviewedAt.getTime());
  }

  /**
   * Get violation reports
   */
  getViolationReports(options?: {
    organizationId?: number;
    status?: string;
    category?: string;
  }): ViolationReport[] {
    let reports = Array.from(this.violationReports.values());

    if (options?.organizationId) {
      reports = reports.filter(r => 
        r.action.organizationId === options.organizationId
      );
    }

    if (options?.status) {
      reports = reports.filter(r => r.status === options.status);
    }

    if (options?.category) {
      reports = reports.filter(r => 
        r.principle.category === options.category
      );
    }

    return reports.sort((a, b) => 
      b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  /**
   * Override a violation report (human decision)
   */
  async overrideViolation(
    reportId: string,
    overriddenBy: string,
    reason: string
  ): Promise<ViolationReport> {
    const report = this.violationReports.get(reportId);
    
    if (!report) {
      throw new ConstitutionalAIError(
        ConstitutionalAIErrorType.UNKNOWN,
        `Violation report ${reportId} not found`
      );
    }

    report.humanOverride = {
      overriddenBy,
      reason,
      overriddenAt: new Date()
    };
    
    report.status = 'false_positive';
    report.updatedAt = new Date();

    // Emit event
    await this.eventStream.publish({
      type: 'constitutional.human_override',
      payload: { reportId, overriddenBy, reason }
    });

    logger.info(`Violation report ${reportId} overridden by ${overriddenBy}`);

    return report;
  }

  /**
   * Get service metrics
   */
  getMetrics(): ConstitutionalAIMetrics {
    return { ...this.metrics };
  }

  /**
   * Get constitution for organization
   */
  async getConstitution(
    constitutionId: string,
    organizationId: number
  ): Promise<Constitution> {
    return this.loadConstitution(constitutionId, organizationId);
  }

  /**
   * List constitutions for organization
   */
  async listConstitutions(organizationId: number): Promise<Constitution[]> {
    return this.constitutionRepo.list(organizationId);
  }

  /**
   * Create custom constitution
   */
  async createConstitution(
    name: string,
    description: string,
    principles: ConstitutionalPrinciple[],
    organizationId: number
  ): Promise<Constitution> {
    const constitution: Constitution = {
      id: randomUUID(),
      name,
      description,
      principles,
      organizationId,
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await this.constitutionRepo.save(constitution);
    
    logger.info(`Created constitution ${constitution.id} for org ${organizationId}`);

    return constitution;
  }

  /**
   * Update service configuration
   */
  updateConfig(config: Partial<ConstitutionalAIConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Constitutional AI config updated', config);
  }

  /**
   * Apply required changes to output
   */
  private applyRequiredChanges(output: string, changes: string[]): string {
    let modified = output;
    changes.forEach(change => {
      // Simple replacement - in production would use more sophisticated NLP
      modified = modified.replace(/harmful|dangerous|unsafe/gi, "appropriate");
      modified = modified.replace(/violence|threat/gi, "constructive");
    });
    return modified;
  }

  /**
   * Load constitution
   */
  private async loadConstitution(
    id: string,
    organizationId: number
  ): Promise<Constitution> {
    // Try organization-specific constitution
    let constitution = await this.constitutionRepo.getById(id, organizationId);
    
    // Fall back to default if not found
    if (!constitution) {
      constitution = await this.constitutionRepo.getDefault(organizationId);
    }
    
    // Use system default as final fallback
    if (!constitution) {
      logger.warn(`No constitution found for org ${organizationId}, using system default`);
      return DEFAULT_CONSTITUTION;
    }

    return constitution;
  }

  /**
   * Handle blocking violations
   */
  private async handleBlockingViolations(
    action: AgentAction,
    violations: ConstitutionalCheck[]
  ): Promise<AgentAction> {
    // Try to use revised action from first auto-correctable violation
    for (const violation of violations) {
      if (violation.revisedAction && 
          violation.principle.autoCorrect) {
        logger.info(`Using auto-corrected action from principle ${violation.principle.id}`);
        return violation.revisedAction;
      }
    }

    // If no auto-correction available, return original (will be rejected)
    logger.warn(`No auto-correction available for violations, action will be rejected`);
    return action;
  }

  /**
   * Create violation reports
   */
  private async createViolationReports(
    review: ConstitutionalReview,
    violations: ConstitutionalCheck[]
  ): Promise<void> {
    for (const violation of violations) {
      const reportId = randomUUID();
      
      const report: ViolationReport = {
        id: reportId,
        principle: violation.principle,
        action: review.originalAction,
        review,
        status: 'open',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      this.violationReports.set(reportId, report);

      // Emit violation event
      await this.eventStream.publish({
        type: 'constitutional.violation_detected',
        payload: {
          reportId,
          reviewId: review.reviewId,
          principleId: violation.principle.id,
          severity: violation.principle.severity
        }
      });
    }
  }

  /**
   * Emit review-related events
   */
  private async emitReviewEvents(review: ConstitutionalReview): Promise<void> {
    // Review completed
    await this.eventStream.publish({
      type: 'constitutional.review_completed',
      payload: {
        reviewId: review.reviewId,
        actionId: review.originalAction.id,
        approved: review.approved,
        violations: review.blockingViolations.length + review.warnings.length,
        reviewTimeMs: review.totalReviewTimeMs
      }
    });

    // Auto-correction events
    for (const check of review.checks) {
      if (check.revisedAction) {
        await this.eventStream.publish({
          type: 'constitutional.auto_corrected',
          payload: {
            reviewId: review.reviewId,
            actionId: review.originalAction.id,
            principleId: check.principle.id
          }
        });
      }
    }

    // Escalation event
    if (review.requiresEscalation) {
      await this.eventStream.publish({
        type: 'constitutional.escalated',
        payload: {
          reviewId: review.reviewId,
          actionId: review.originalAction.id,
          reason: 'Blocking violations detected without auto-correction'
        }
      });
    }
  }

  /**
   * Update metrics from review
   */
  private updateMetrics(review: ConstitutionalReview): void {
    this.metrics.totalReviews++;
    
    // Violation counts
    const violations = review.blockingViolations.length + review.warnings.length;
    this.metrics.totalViolations += violations;

    // By category
    for (const check of review.checks.filter(c => !c.compliant)) {
      const category = check.principle.category;
      this.metrics.violationsByCategory[category] = 
        (this.metrics.violationsByCategory[category] || 0) + 1;

      // By severity
      const severity = check.principle.severity;
      this.metrics.violationsBySeverity[severity] = 
        (this.metrics.violationsBySeverity[severity] || 0) + 1;
    }

    // Average review time
    const totalTime = this.metrics.averageReviewTimeMs * (this.metrics.totalReviews - 1)
      + review.totalReviewTimeMs;
    this.metrics.averageReviewTimeMs = totalTime / this.metrics.totalReviews;

    // Auto-correction rate
    const autoCorrected = review.checks.filter(c => c.revisedAction).length;
    if (autoCorrected > 0) {
      this.metrics.autoCorrectionRate = 
        (this.metrics.autoCorrectionRate * (this.metrics.totalReviews - 1) + 1)
        / this.metrics.totalReviews;
    }
  }

  /**
   * Create auto-approved review (when disabled)
   */
  private createAutoApprovedReview(
    reviewId: string,
    action: AgentAction
  ): ConstitutionalReview {
    return {
      reviewId,
      originalAction: action,
      checks: [],
      finalAction: action,
      blockingViolations: [],
      warnings: [],
      totalReviewTimeMs: 0,
      approved: true,
      requiresEscalation: false,
      reviewedAt: new Date()
    };
  }
}

/**
 * LLM Client Interface
 */
interface LLMClient {
  generateStructured<T>(params: {
    prompt: string;
    schema: object;
    temperature?: number;
    maxTokens?: number;
  }): Promise<T>;
}
