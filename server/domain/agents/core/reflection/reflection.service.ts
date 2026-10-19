/**
 * ReAct with Reflection & Self-Correction Service
 * 
 * Provides explicit verification steps and self-correction loops
 * for agent orchestration, detecting hallucinations and logic errors.
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { 
  reflectionLogs, 
  reflectionPatterns,
  type InsertReflectionLog,
  type InsertReflectionPattern 
} from "@shared/schema/index.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("ReflectionService");

// Configuration defaults
const DEFAULT_CONFIG: ReflectionConfig = {
  reflectionEnabled: true,
  confidenceThreshold: 0.7,
  maxReflectionDepth: 3,
  verificationStrategies: ["factual", "logical", "consistency"],
  autoRetryOnLowConfidence: true,
};

// Types
export interface ReflectionConfig {
  reflectionEnabled: boolean;
  confidenceThreshold: number;
  maxReflectionDepth: number;
  verificationStrategies: VerificationStrategy[];
  autoRetryOnLowConfidence: boolean;
}

export type VerificationStrategy = "factual" | "logical" | "consistency" | "schema" | "hallucination";

export interface ReflectionInput {
  stepId: string;
  missionRunId: number;
  organizationId: number;
  output: any;
  context?: Record<string, any>;
  verificationStrategies?: VerificationStrategy[];
  previousReflections?: number; // Count of previous retries
}

export interface VerificationResult {
  strategy: VerificationStrategy;
  passed: boolean;
  score: number; // 0-1
  details: string;
  evidence?: any;
}

export interface ReflectionResult {
  reflectionId: string;
  confidenceScore: number;
  passed: boolean;
  verifications: VerificationResult[];
  issues: DetectedIssue[];
  suggestedCorrection?: CorrectionSuggestion;
  shouldRetry: boolean;
  shouldEscalate: boolean;
}

export interface DetectedIssue {
  type: "hallucination" | "logical_error" | "factual_error" | "schema_mismatch" | "inconsistency";
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  location?: string;
  evidence?: any;
}

export interface CorrectionSuggestion {
  strategy: string;
  correctedOutput?: any;
  explanation: string;
  confidence: number;
}

export interface CorrectionInput {
  original: any;
  issues: DetectedIssue[];
  context?: Record<string, any>;
  attempt: number;
  maxAttempts: number;
}

export interface CorrectionResult {
  success: boolean;
  correctedOutput?: any;
  explanation: string;
  shouldRetry: boolean;
  shouldEscalate: boolean;
  confidence: number;
}

/**
 * Main Reflection Service
 */
export class ReflectionService {
  private verifiers: Map<VerificationStrategy, Verifier> = new Map();
  private config: ReflectionConfig;

  constructor(config: Partial<ReflectionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.initializeVerifiers();
  }

  /**
   * Initialize all verification strategies
   */
  private initializeVerifiers(): void {
    this.verifiers.set("factual", new FactualVerifier());
    this.verifiers.set("logical", new LogicalVerifier());
    this.verifiers.set("consistency", new ConsistencyVerifier());
    this.verifiers.set("schema", new SchemaVerifier());
    this.verifiers.set("hallucination", new HallucinationVerifier());
  }

  /**
   * Main reflection method - evaluate agent output
   */
  async reflect(input: ReflectionInput): Promise<ReflectionResult> {
    const reflectionId = uuidv4();
    const strategies = input.verificationStrategies || this.config.verificationStrategies;
    
    logger.info(`[Reflection] Starting reflection for step ${input.stepId}`, {
      missionRunId: input.missionRunId,
      strategies,
    });

    // Run all verification strategies
    const verifications: VerificationResult[] = [];
    for (const strategy of strategies) {
      const verifier = this.verifiers.get(strategy);
      if (verifier) {
        try {
          const result = await verifier.verify(input.output, input.context);
          verifications.push(result);
        } catch (err: any) {
          logger.error(`[Reflection] Verifier ${strategy} failed:`, err);
          verifications.push({
            strategy,
            passed: false,
            score: 0,
            details: `Verifier error: ${err.message}`,
          });
        }
      }
    }

    // Aggregate results
    const issues = this.extractIssues(verifications);
    const confidenceScore = this.calculateConfidence(verifications);
    const passed = confidenceScore >= this.config.confidenceThreshold;

    // Determine next action
    const retryCount = input.previousReflections || 0;
    const shouldRetry = !passed && 
                       retryCount < this.config.maxReflectionDepth && 
                       this.config.autoRetryOnLowConfidence &&
                       issues.some(i => i.severity !== "critical");
    
    const shouldEscalate = !passed && (retryCount >= this.config.maxReflectionDepth || 
                                       issues.some(i => i.severity === "critical"));

    // Generate correction suggestion if needed
    let suggestedCorrection: CorrectionSuggestion | undefined;
    if (shouldRetry) {
      const correctionResult = await this.attemptCorrection({
        original: input.output,
        issues,
        context: input.context,
        attempt: retryCount + 1,
        maxAttempts: this.config.maxReflectionDepth,
      });

      if (correctionResult.success) {
        suggestedCorrection = {
          strategy: correctionResult.explanation,
          correctedOutput: correctionResult.correctedOutput,
          explanation: correctionResult.explanation,
          confidence: correctionResult.confidence,
        };
      }
    }

    // Persist to database
    await this.persistReflection({
      reflectionId,
      input,
      verifications,
      issues,
      confidenceScore,
      passed,
      correctionAttempted: shouldRetry,
      suggestedCorrection,
      retryCount,
      resolution: passed ? "passed" : shouldEscalate ? "escalated" : "corrected",
    });

    // Emit event for real-time monitoring
    await eventStream.publish("agent.reflection_completed", {
      reflectionId,
      missionRunId: input.missionRunId,
      stepId: input.stepId,
      confidenceScore,
      passed,
      issueCount: issues.length,
      shouldRetry,
      shouldEscalate,
    }, {
      organizationId: input.organizationId,
      subject: `mission-run:${input.missionRunId}`,
    }, "reflection");

    logger.info(`[Reflection] Completed for step ${input.stepId}`, {
      passed,
      confidenceScore,
      shouldRetry,
      shouldEscalate,
    });

    return {
      reflectionId,
      confidenceScore,
      passed,
      verifications,
      issues,
      suggestedCorrection,
      shouldRetry,
      shouldEscalate,
    };
  }

  /**
   * Attempt to correct detected issues
   */
  async attemptCorrection(input: CorrectionInput): Promise<CorrectionResult> {
    logger.info(`[Reflection] Attempting correction (attempt ${input.attempt}/${input.maxAttempts})`);

    // Try pattern-based correction first
    const patternResult = await this.applyPatternCorrection(input);
    if (patternResult.success) {
      return patternResult;
    }

    // Try generic correction strategies
    for (const issue of input.issues) {
      const strategy = this.selectCorrectionStrategy(issue);
      try {
        const result = await strategy.correct(input.original, issue, input.context);
        if (result.confidence > 0.6) {
          return {
            success: true,
            correctedOutput: result.correctedOutput,
            explanation: `Applied ${strategy.name} correction for ${issue.type}`,
            shouldRetry: true,
            shouldEscalate: false,
            confidence: result.confidence,
          };
        }
      } catch (err: any) {
        logger.error(`[Reflection] Correction strategy failed:`, err);
      }
    }

    // If all strategies fail, escalate
    return {
      success: false,
      explanation: `Unable to automatically correct ${input.issues.length} issues after trying all strategies`,
      shouldRetry: false,
      shouldEscalate: input.attempt >= input.maxAttempts,
      confidence: 0,
    };
  }

  /**
   * Apply learned pattern-based corrections
   */
  private async applyPatternCorrection(input: CorrectionInput): Promise<CorrectionResult> {
    // Find matching patterns
    const patterns = await db.query.reflectionPatterns.findMany({
      where: and(
        sql`${reflectionPatterns.triggerSignature} = ${this.hashIssues(input.issues)}`,
        sql`${reflectionPatterns.successRate} > 0.5`
      ),
      orderBy: desc(reflectionPatterns.successRate),
      limit: 3,
    });

    if (patterns.length === 0) {
      return { success: false, explanation: "No matching patterns", shouldRetry: false, shouldEscalate: false, confidence: 0 };
    }

    // Try each pattern
    for (const pattern of patterns) {
      const strategy = pattern.correctionStrategy as any;
      if (strategy?.autoFix) {
        try {
          // Apply the auto-fix
          const corrected = await this.applyAutoFix(input.original, strategy.autoFix);
          return {
            success: true,
            correctedOutput: corrected,
            explanation: `Applied learned pattern: ${pattern.patternType}`,
            shouldRetry: true,
            shouldEscalate: false,
            confidence: Number(pattern.successRate) || 0.7,
          };
        } catch (err: any) {
          logger.warn(`[Reflection] Pattern correction failed:`, err);
        }
      }
    }

    return { success: false, explanation: "Pattern corrections failed", shouldRetry: false, shouldEscalate: false, confidence: 0 };
  }

  /**
   * Select appropriate correction strategy for an issue
   */
  private selectCorrectionStrategy(issue: DetectedIssue): CorrectionStrategy {
    const strategies: Record<string, CorrectionStrategy> = {
      hallucination: new SourceAttributionStrategy(),
      factual_error: new FactCheckStrategy(),
      logical_error: new LogicRepairStrategy(),
      schema_mismatch: new SchemaRepairStrategy(),
      inconsistency: new ConsistencyRepairStrategy(),
    };

    return strategies[issue.type] || new GenericCorrectionStrategy();
  }

  /**
   * Extract issues from verification results
   */
  private extractIssues(verifications: VerificationResult[]): DetectedIssue[] {
    const issues: DetectedIssue[] = [];

    for (const v of verifications) {
      if (v.passed) continue;

      const type = this.mapStrategyToIssueType(v.strategy);
      const severity = v.score < 0.3 ? "critical" : v.score < 0.5 ? "high" : v.score < 0.7 ? "medium" : "low";

      issues.push({
        type,
        severity,
        description: v.details,
        evidence: v.evidence,
      });
    }

    return issues;
  }

  /**
   * Map verification strategy to issue type
   */
  private mapStrategyToIssueType(strategy: VerificationStrategy): DetectedIssue["type"] {
    const mapping: Record<VerificationStrategy, DetectedIssue["type"]> = {
      factual: "factual_error",
      logical: "logical_error",
      consistency: "inconsistency",
      schema: "schema_mismatch",
      hallucination: "hallucination",
    };
    return mapping[strategy] || "logical_error";
  }

  /**
   * Calculate aggregate confidence score
   */
  private calculateConfidence(verifications: VerificationResult[]): number {
    if (verifications.length === 0) return 1.0;

    // Weighted average based on strategy importance
    const weights: Record<VerificationStrategy, number> = {
      factual: 0.3,
      logical: 0.25,
      consistency: 0.2,
      schema: 0.15,
      hallucination: 0.1,
    };

    let totalWeight = 0;
    let weightedScore = 0;

    for (const v of verifications) {
      const weight = weights[v.strategy] || 0.1;
      totalWeight += weight;
      weightedScore += v.score * weight;
    }

    return totalWeight > 0 ? weightedScore / totalWeight : 0;
  }

  /**
   * Persist reflection to database
   */
  private async persistReflection(data: {
    reflectionId: string;
    input: ReflectionInput;
    verifications: VerificationResult[];
    issues: DetectedIssue[];
    confidenceScore: number;
    passed: boolean;
    correctionAttempted: boolean;
    suggestedCorrection?: CorrectionSuggestion;
    retryCount: number;
    resolution: string;
  }): Promise<void> {
    try {
      await db.insert(reflectionLogs).values({
        id: data.reflectionId,
        missionRunId: data.input.missionRunId,
        organizationId: data.input.organizationId,
        stepId: data.input.stepId,
        originalOutput: data.input.output,
        reflectionResult: {
          verifications: data.verifications,
          issues: data.issues,
          confidenceScore: data.confidenceScore,
          passed: data.passed,
        },
        correctionAttempted: data.correctionAttempted,
        correctedOutput: data.suggestedCorrection?.correctedOutput,
        retryCount: data.retryCount,
        resolution: data.resolution,
        createdAt: new Date(),
      } as any);
    } catch (err: any) {
      logger.error("[Reflection] Failed to persist reflection:", err);
    }
  }

  /**
   * Hash issues for pattern matching
   */
  private hashIssues(issues: DetectedIssue[]): string {
    const signature = issues.map(i => `${i.type}:${i.severity}`).join("|");
    // Simple hash - in production use crypto
    return signature.split('').reduce((a, b) => ((a << 5) - a) + b.charCodeAt(0), 0).toString(36);
  }

  /**
   * Apply auto-fix transformation
   */
  private async applyAutoFix(original: any, fix: any): Promise<any> {
    // Implementation depends on fix type
    if (fix.type === "replace" && fix.path && fix.value) {
      const result = { ...original };
      this.setPath(result, fix.path, fix.value);
      return result;
    }
    return original;
  }

  /**
   * Set value at path in object
   */
  private setPath(obj: any, path: string, value: any): void {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]] = current[keys[i]] || {};
    }
    current[keys[keys.length - 1]] = value;
  }

  /**
   * Get reflection statistics for organization
   */
  async getStats(organizationId: number, days: number = 30): Promise<{
    totalReflections: number;
    passRate: number;
    avgConfidence: number;
    correctionSuccessRate: number;
    escalationRate: number;
    topIssues: Array<{ type: string; count: number }>;
  }> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const logs = await db.query.reflectionLogs.findMany({
      where: and(
        eq(reflectionLogs.organizationId, organizationId),
        sql`${reflectionLogs.createdAt} >= ${since}`
      ),
    });

    const total = logs.length;
    const passed = logs.filter(l => l.resolution === "passed").length;
    const corrected = logs.filter(l => l.resolution === "corrected").length;
    const escalated = logs.filter(l => l.resolution === "escalated").length;

    // Calculate issue distribution
    const issueCounts: Record<string, number> = {};
    for (const log of logs) {
      const result = log.reflectionResult as any;
      for (const issue of result?.issues || []) {
        issueCounts[issue.type] = (issueCounts[issue.type] || 0) + 1;
      }
    }

    return {
      totalReflections: total,
      passRate: total > 0 ? passed / total : 0,
      avgConfidence: logs.length > 0 
        ? logs.reduce((sum, l) => sum + ((l.reflectionResult as any)?.confidenceScore || 0), 0) / logs.length 
        : 0,
      correctionSuccessRate: corrected + escalated > 0 ? corrected / (corrected + escalated) : 0,
      escalationRate: total > 0 ? escalated / total : 0,
      topIssues: Object.entries(issueCounts)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    };
  }
}

// ========================================================================
// VERIFIER CLASSES
// ========================================================================

abstract class Verifier {
  abstract verify(output: any, context?: Record<string, any>): Promise<VerificationResult>;
}

/**
 * Factual Verification - Cross-reference with knowledge sources
 */
class FactualVerifier extends Verifier {
  async verify(output: any, context?: Record<string, any>): Promise<VerificationResult> {
    // Extract claims from output
    const claims = this.extractClaims(output);
    
    if (claims.length === 0) {
      return { strategy: "factual", passed: true, score: 1.0, details: "No verifiable claims" };
    }

    let verifiedCount = 0;
    const details: string[] = [];

    for (const claim of claims) {
      // In production, this would query knowledge store
      const hasSource = this.checkSourceAttribution(claim, context);
      
      if (hasSource) {
        verifiedCount++;
      } else {
        details.push(`Unverified claim: "${claim.text}"`);
      }
    }

    const score = claims.length > 0 ? verifiedCount / claims.length : 1.0;

    return {
      strategy: "factual",
      passed: score > 0.7,
      score,
      details: details.join("; ") || "All claims have sources",
      evidence: { claims, verified: verifiedCount },
    };
  }

  private extractClaims(output: any): Array<{ text: string; type: string }> {
    // Simplified claim extraction
    const text = typeof output === "string" ? output : JSON.stringify(output);
    const claims: Array<{ text: string; type: string }> = [];

    // Look for factual statements (simplified)
    const patterns = [
      /\b(is|are|was|were|has|have)\b.*\d+/g, // "X has Y items"
      /\b(released|launched|created)\b.*\d{4}/g, // Dates
      /\b\d+\s+(records|users|items|dollars)\b/g, // Quantities
    ];

    for (const pattern of patterns) {
      const matches = text.match(pattern) || [];
      for (const match of matches) {
        claims.push({ text: match, type: "factual_statement" });
      }
    }

    return claims;
  }

  private checkSourceAttribution(claim: any, context?: Record<string, any>): boolean {
    // Check if claim can be traced to a source
    const sources = context?.sources || context?.retrievedDocuments || [];
    return sources.length > 0; // Simplified - in production, do semantic matching
  }
}

/**
 * Logical Verification - Check for contradictions and soundness
 */
class LogicalVerifier extends Verifier {
  async verify(output: any, context?: Record<string, any>): Promise<VerificationResult> {
    const text = typeof output === "string" ? output : JSON.stringify(output);
    
    // Check for common logical errors
    const issues: string[] = [];
    
    // Check for contradictions
    if (this.hasContradiction(text)) {
      issues.push("Detected internal contradiction");
    }
    
    // Check for circular reasoning
    if (this.hasCircularReasoning(text)) {
      issues.push("Potential circular reasoning detected");
    }
    
    // Check for false causality
    if (this.hasFalseCausality(text)) {
      issues.push("Possible false causality (post hoc ergo propter hoc)");
    }

    const score = issues.length === 0 ? 1.0 : Math.max(0, 1 - issues.length * 0.3);

    return {
      strategy: "logical",
      passed: score > 0.7,
      score,
      details: issues.join("; ") || "No logical issues detected",
    };
  }

  private hasContradiction(text: string): boolean {
    // Simple contradiction detection
    const patterns = [
      /should.*not.*should/, // "should not... should"
      /true.*false.*same/, // Contradictory claims
    ];
    return patterns.some(p => p.test(text.toLowerCase()));
  }

  private hasCircularReasoning(text: string): boolean {
    // Check for A because A patterns
    return /because.*it is|since.*it is.*it/gi.test(text);
  }

  private hasFalseCausality(text: string): boolean {
    // Check for "because" without evidence
    const causePatterns = /causes?|leads? to|results? in/gi;
    const evidencePatterns = /because|due to|as a result of/gi;
    return causePatterns.test(text) && !evidencePatterns.test(text);
  }
}

/**
 * Consistency Verification - Check against previous outputs
 */
class ConsistencyVerifier extends Verifier {
  async verify(output: any, context?: Record<string, any>): Promise<VerificationResult> {
    const previousOutputs = context?.previousOutputs || [];
    
    if (previousOutputs.length === 0) {
      return { strategy: "consistency", passed: true, score: 1.0, details: "No previous outputs to compare" };
    }

    let consistencyScore = 1.0;
    const inconsistencies: string[] = [];

    for (const prev of previousOutputs) {
      const match = this.checkConsistency(output, prev);
      if (!match.consistent) {
        consistencyScore -= 0.2;
        inconsistencies.push(match.reason);
      }
    }

    return {
      strategy: "consistency",
      passed: consistencyScore > 0.7,
      score: Math.max(0, consistencyScore),
      details: inconsistencies.join("; ") || "Consistent with previous outputs",
    };
  }

  private checkConsistency(current: any, previous: any): { consistent: boolean; reason: string } {
    // Simplified consistency check
    const currentStr = JSON.stringify(current);
    const previousStr = JSON.stringify(previous);
    
    // Check for direct contradictions in key fields
    if (typeof current === "object" && typeof previous === "object") {
      for (const key of Object.keys(current)) {
        if (previous[key] !== undefined && previous[key] !== current[key]) {
          if (!this.isCompatibleChange(previous[key], current[key])) {
            return { consistent: false, reason: `Field '${key}' changed from ${previous[key]} to ${current[key]}` };
          }
        }
      }
    }

    return { consistent: true, reason: "" };
  }

  private isCompatibleChange(oldVal: any, newVal: any): boolean {
    // Some changes are expected (e.g., progress updates)
    if (typeof oldVal === "number" && typeof newVal === "number") {
      return true; // Numeric changes are often progress
    }
    return false;
  }
}

/**
 * Schema Verification - Validate output structure
 */
class SchemaVerifier extends Verifier {
  async verify(output: any, context?: Record<string, any>): Promise<VerificationResult> {
    const expectedSchema = context?.expectedSchema;
    
    if (!expectedSchema) {
      return { strategy: "schema", passed: true, score: 1.0, details: "No schema specified" };
    }

    const errors = this.validateAgainstSchema(output, expectedSchema);
    const score = errors.length === 0 ? 1.0 : Math.max(0, 1 - errors.length * 0.25);

    return {
      strategy: "schema",
      passed: score > 0.8,
      score,
      details: errors.join("; ") || "Valid according to schema",
      evidence: errors,
    };
  }

  private validateAgainstSchema(output: any, schema: any): string[] {
    const errors: string[] = [];

    if (schema.type === "object" && typeof output !== "object") {
      errors.push(`Expected object, got ${typeof output}`);
      return errors;
    }

    if (schema.required && Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (output[field] === undefined) {
          errors.push(`Missing required field: ${field}`);
        }
      }
    }

    return errors;
  }
}

/**
 * Hallucination Detection - Detect ungrounded claims
 */
class HallucinationVerifier extends Verifier {
  async verify(output: any, context?: Record<string, any>): Promise<VerificationResult> {
    const text = typeof output === "string" ? output : JSON.stringify(output);
    
    // Check for hallucination indicators
    const indicators: string[] = [];
    
    // High-confidence claims without evidence
    if (/certainly|definitely|absolutely|without a doubt/gi.test(text) && 
        !context?.sources?.length) {
      indicators.push("High-confidence claim without cited source");
    }
    
    // Specific numbers without attribution
    if (/\b\d{4,}\b/.test(text) && !/according to|source:|from/gi.test(text)) {
      indicators.push("Specific quantity without attribution");
    }
    
    // Knowledge cutoff warnings
    if (/prior to|before \d{4}|as of \d{4}/gi.test(text)) {
      indicators.push("Possible outdated information");
    }

    const score = Math.max(0, 1 - indicators.length * 0.3);

    return {
      strategy: "hallucination",
      passed: score > 0.7,
      score,
      details: indicators.join("; ") || "No hallucination indicators detected",
    };
  }
}

// ========================================================================
// CORRECTION STRATEGIES
// ========================================================================

abstract class CorrectionStrategy {
  abstract name: string;
  abstract correct(original: any, issue: DetectedIssue, context?: Record<string, any>): Promise<{
    correctedOutput: any;
    confidence: number;
  }>;
}

class SourceAttributionStrategy extends CorrectionStrategy {
  name = "source_attribution";
  
  async correct(original: any, issue: DetectedIssue, context?: Record<string, any>) {
    // Add explicit source references
    const corrected = typeof original === "string" 
      ? `${original} (Note: Please verify this claim with authoritative sources)`
      : { ...original, _verificationNote: "Please verify claims with sources" };
    
    return { correctedOutput: corrected, confidence: 0.6 };
  }
}

class FactCheckStrategy extends CorrectionStrategy {
  name = "fact_check";
  
  async correct(original: any, issue: DetectedIssue, context?: Record<string, any>) {
    // Flag for verification without changing content
    const corrected = typeof original === "string"
      ? `[NEEDS VERIFICATION] ${original}`
      : { ...original, _needsVerification: true };
    
    return { correctedOutput: corrected, confidence: 0.7 };
  }
}

class LogicRepairStrategy extends CorrectionStrategy {
  name = "logic_repair";
  
  async correct(original: any, issue: DetectedIssue, context?: Record<string, any>) {
    // Attempt to rephrase logically
    const corrected = typeof original === "string"
      ? `${original} (Note: Logical review recommended - possible issue: ${issue.description})`
      : original;
    
    return { correctedOutput: corrected, confidence: 0.4 };
  }
}

class SchemaRepairStrategy extends CorrectionStrategy {
  name = "schema_repair";
  
  async correct(original: any, issue: DetectedIssue, context?: Record<string, any>) {
    // Add missing fields with defaults
    const schema = context?.expectedSchema;
    if (schema?.required && typeof original === "object") {
      const corrected = { ...original };
      for (const field of schema.required) {
        if (corrected[field] === undefined) {
          corrected[field] = null; // or appropriate default
        }
      }
      return { correctedOutput: corrected, confidence: 0.8 };
    }
    return { correctedOutput: original, confidence: 0.3 };
  }
}

class ConsistencyRepairStrategy extends CorrectionStrategy {
  name = "consistency_repair";
  
  async correct(original: any, issue: DetectedIssue, context?: Record<string, any>) {
    // Flag inconsistency for review
    const corrected = typeof original === "string"
      ? `${original} (Note: May be inconsistent with previous outputs)`
      : { ...original, _consistencyWarning: true };
    
    return { correctedOutput: corrected, confidence: 0.5 };
  }
}

class GenericCorrectionStrategy extends CorrectionStrategy {
  name = "generic";
  
  async correct(original: any, issue: DetectedIssue, context?: Record<string, any>) {
    // Generic flag for human review
    const corrected = typeof original === "string"
      ? `${original} (Note: Auto-correction failed - human review recommended)`
      : { ...original, _needsHumanReview: true };
    
    return { correctedOutput: corrected, confidence: 0.3 };
  }
}

// Export singleton
export const reflectionService = new ReflectionService();
