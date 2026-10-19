/**
 * Neuro-Symbolic AI - Types and Interfaces
 * 
 * Hybrid neural + symbolic reasoning for verifiable, explainable AI.
 * Combines LLM natural language understanding with formal logic inference.
 */

/**
 * Symbolic Fact - Ground truth assertion
 */
export interface SymbolicFact {
  /** Fact ID */
  id: string;
  
  /** Predicate name */
  predicate: string;
  
  /** Arguments (terms) */
  arguments: (string | number | boolean)[];
  
  /** Is negated */
  negated: boolean;
  
  /** Source of fact */
  source: 'database' | 'extracted' | 'inferred' | 'assumed';
  
  /** Confidence (0-1) */
  confidence: number;
  
  /** Timestamp */
  timestamp: Date;
  
  /** Expiration (optional) */
  expiresAt?: Date;
  
  /** Metadata */
  metadata?: Record<string, any>;
}

/**
 * Logic Rule - Horn clause or general rule
 */
export interface LogicRule {
  /** Rule ID */
  id: string;
  
  /** Rule name/description */
  name: string;
  
  /** Head (consequent) */
  head: LogicAtom;
  
  /** Body (antecedents) - empty for facts */
  body: LogicAtom[];
  
  /** Is defeasible (can be overridden) */
  defeasible: boolean;
  
  /** Priority for conflict resolution */
  priority: number;
  
  /** Rule source */
  source: 'domain' | 'learned' | 'injected';
  
  /** Human-readable explanation template */
  explanationTemplate: string;
}

/**
 * Logic Atom - Atomic formula
 */
export interface LogicAtom {
  /** Predicate */
  predicate: string;
  
  /** Arguments */
  arguments: LogicTerm[];
  
  /** Negated */
  negated: boolean;
}

/**
 * Logic Term - Variable or constant
 */
export type LogicTerm = 
  | { type: 'variable'; name: string }
  | { type: 'constant'; value: string | number | boolean }
  | { type: 'function'; name: string; args: LogicTerm[] };

/**
 * Datalog Program - Collection of facts and rules
 */
export interface DatalogProgram {
  /** Program ID */
  id: string;
  
  /** Facts (EDB - Extensional Database) */
  facts: SymbolicFact[];
  
  /** Rules (IDB - Intensional Database) */
  rules: LogicRule[];
  
  /** Domain/schema */
  domain: string;
  
  /** Version */
  version: string;
  
  /** Created timestamp */
  createdAt: Date;
  
  /** Updated timestamp */
  updatedAt: Date;
}

/**
 * Neuro-Symbolic Query
 */
export interface NeuroSymbolicQuery {
  /** Query ID */
  id: string;
  
  /** Natural language input */
  naturalLanguage: string;
  
  /** Requires formal verification */
  requiresVerification: boolean;
  
  /** Domain context */
  domain: 'finance' | 'healthcare' | 'legal' | 'general' | string;
  
  /** Target logic (if known) */
  targetLogic?: string;
  
  /** Query parameters */
  parameters?: Record<string, any>;
  
  /** Max inference depth */
  maxDepth: number;
  
  /** Timeout (ms) */
  timeoutMs: number;
  
  /** Include proof trace */
  includeProof: boolean;
}

/**
 * Logic Translation - NL to formal logic
 */
export interface LogicTranslation {
  /** Original natural language */
  originalText: string;
  
  /** Translated logic query/program */
  logicForm: string;
  
  /** Logic language (datalog, prolog, fol) */
  logicLanguage: string;
  
  /** Extracted entities */
  entities: ExtractedEntity[];
  
  /** Extracted relations */
  relations: ExtractedRelation[];
  
  /** Translation confidence */
  confidence: number;
  
  /** Alternative translations */
  alternatives: string[];
}

/**
 * Extracted Entity
 */
export interface ExtractedEntity {
  /** Entity text */
  text: string;
  
  /** Entity type */
  type: string;
  
  /** Normalized/formal name */
  normalized: string;
  
  /** Position in text */
  start: number;
  
  /** End position */
  end: number;
  
  /** Confidence */
  confidence: number;
}

/**
 * Extracted Relation
 */
export interface ExtractedRelation {
  /** Relation type */
  type: string;
  
  /** Subject entity */
  subject: string;
  
  /** Object entity */
  object: string;
  
  /** Confidence */
  confidence: number;
}

/**
 * Inference Result
 */
export interface InferenceResult {
  /** Success status */
  success: boolean;
  
  /** Derived facts */
  derivedFacts: SymbolicFact[];
  
  /** Answer bindings (for queries with variables) */
  bindings: Map<string, any>[];
  
  /** Proof trace */
  proofTrace: ProofStep[];
  
  /** Inference time (ms) */
  inferenceTimeMs: number;
  
  /** Iterations/depth reached */
  iterations: number;
}

/**
 * Proof Step - Trace of inference
 */
export interface ProofStep {
  /** Step number */
  step: number;
  
  /** Rule applied */
  rule: LogicRule;
  
  /** Facts matched */
  matchedFacts: SymbolicFact[];
  
  /** Resulting fact */
  result: SymbolicFact;
  
  /** Substitution/unification */
  substitution: Map<string, any>;
}

/**
 * Verification Result
 */
export interface VerificationResult {
  /** Verified status */
  verified: boolean;
  
  /** Verification method */
  method: 'smt' | 'theorem_prover' | 'model_checker' | 'manual';
  
  /** Counter-example if failed */
  counterExample?: Record<string, any>;
  
  /** Proof certificate */
  proofCertificate?: string;
  
  /** Verification time (ms) */
  verificationTimeMs: number;
}

/**
 * Neuro-Symbolic Response
 */
export interface NeuroSymbolicResponse {
  /** Query ID */
  queryId: string;
  
  /** Natural language answer */
  naturalAnswer: string;
  
  /** Formal answer (logic) */
  formalAnswer: LogicAtom[];
  
  /** Inference result */
  inference: InferenceResult;
  
  /** Verification (if requested) */
  verification?: VerificationResult;
  
  /** Explanation */
  explanation: Explanation;
  
  /** Confidence */
  confidence: number;
  
  /** Processing metadata */
  metadata: ProcessingMetadata;
}

/**
 * Explanation - Human-readable reasoning trace
 */
export interface Explanation {
  /** Summary */
  summary: string;
  
  /** Step-by-step explanation */
  steps: ExplanationStep[];
  
  /** Key facts used */
  keyFacts: SymbolicFact[];
  
  /** Rules applied */
  rulesApplied: LogicRule[];
  
  /** Visual proof tree (for UI) */
  proofTree?: ProofTreeNode;
}

/**
 * Explanation Step
 */
export interface ExplanationStep {
  /** Step number */
  step: number;
  
  /** Human-readable text */
  text: string;
  
  /** Formal logic representation */
  formal: string;
  
  /** Rule or fact reference */
  reference: string;
}

/**
 * Proof Tree Node
 */
export interface ProofTreeNode {
  /** Conclusion at this node */
  conclusion: LogicAtom;
  
  /** Premises leading to conclusion */
  premises: ProofTreeNode[];
  
  /** Rule used */
  rule?: LogicRule;
  
  /** Is leaf (fact) */
  isLeaf: boolean;
}

/**
 * Processing Metadata
 */
export interface ProcessingMetadata {
  /** Total time (ms) */
  totalTimeMs: number;
  
  /** NL parsing time */
  parsingTimeMs: number;
  
  /** Logic translation time */
  translationTimeMs: number;
  
  /** Inference time */
  inferenceTimeMs: number;
  
  /** Verification time */
  verificationTimeMs?: number;
  
  /** Logic language used */
  logicLanguage: string;
  
  /** Facts considered */
  factsConsidered: number;
  
  /** Rules considered */
  rulesConsidered: number;
}

/**
 * Domain Ruleset
 */
export interface DomainRuleset {
  /** Domain name */
  domain: string;
  
  /** Display name */
  displayName: string;
  
  /** Description */
  description: string;
  
  /** Rules */
  rules: LogicRule[];
  
  /** Schema (predicates and their types) */
  schema: PredicateSchema[];
  
  /** Natural language templates */
  templates: NLTemplate[];
  
  /** Organization ID (null = system default) */
  organizationId?: number;
  
  /** Is default */
  isDefault: boolean;
  
  /** Version */
  version: string;
}

/**
 * Predicate Schema
 */
export interface PredicateSchema {
  /** Predicate name */
  name: string;
  
  /** Argument types */
  arguments: { name: string; type: string }[];
  
  /** Description */
  description: string;
  
  /** Example */
  example: string;
}

/**
 * NL Template - Pattern for NL to logic translation
 */
export interface NLTemplate {
  /** Template ID */
  id: string;
  
  /** Natural language pattern (regex) */
  pattern: string;
  
  /** Logic form template */
  logicTemplate: string;
  
  /** Extracted variables */
  variables: string[];
  
  /** Confidence boost when matched */
  confidenceBoost: number;
}

/**
 * Neuro-Symbolic Service Configuration
 */
export interface NeuroSymbolicConfig {
  /** Default inference depth */
  defaultMaxDepth: number;
  
  /** Default timeout (ms) */
  defaultTimeoutMs: number;
  
  /** Enable verification */
  enableVerification: boolean;
  
  /** Verification engine */
  verificationEngine: 'z3' | 'custom' | 'none';
  
  /** LLM model for translation */
  translationModel: string;
  
  /** Translation temperature */
  translationTemperature: number;
  
  /** Enable caching */
  enableCache: boolean;
  
  /** Cache TTL (seconds) */
  cacheTtl: number;
}

/**
 * Default configuration
 */
export const DEFAULT_NEURO_SYMBOLIC_CONFIG: NeuroSymbolicConfig = {
  defaultMaxDepth: 10,
  defaultTimeoutMs: 5000,
  enableVerification: true,
  verificationEngine: 'custom',
  translationModel: 'gpt-4',
  translationTemperature: 0.2,
  enableCache: true,
  cacheTtl: 3600
};

/**
 * Neuro-Symbolic Error Types
 */
export enum NeuroSymbolicErrorType {
  PARSING_FAILED = 'parsing_failed',
  TRANSLATION_FAILED = 'translation_failed',
  INFERENCE_FAILED = 'inference_failed',
  VERIFICATION_FAILED = 'verification_failed',
  TIMEOUT = 'timeout',
  MAX_DEPTH_EXCEEDED = 'max_depth_exceeded',
  CONTRADICTION_DETECTED = 'contradiction_detected',
  UNKNOWN = 'unknown'
}

/**
 * Neuro-Symbolic Error
 */
export class NeuroSymbolicError extends Error {
  constructor(
    public type: NeuroSymbolicErrorType,
    message: string,
    public queryId?: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'NeuroSymbolicError';
  }
}

/**
 * Compliance Check Request
 */
export interface ComplianceCheckRequest {
  /** Check type */
  checkType: 'aml' | 'kyc' | 'sanctions' | 'fraud' | 'clinical' | 'legal';
  
  /** Subject (customer, transaction, patient, contract, etc.) */
  subject: Record<string, any>;
  
  /** Context facts */
  context: SymbolicFact[];
  
  /** Jurisdiction */
  jurisdiction: string;
  
  /** Risk level (finance/AML) */
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  
  /** Medications (healthcare) */
  medications?: Array<{ name: string; dosage: string }>;
  
  /** Allergies (healthcare) */
  allergies?: Array<{ allergen: string; severity: string }>;
  
  /** Regulations to check (legal) */
  regulations?: string[];
}

/**
 * Risk Factor (for legal domain)
 */
export interface RiskFactor {
  /** Risk type */
  type: string;
  
  /** Severity */
  severity: 'low' | 'medium' | 'high';
  
  /** Description */
  description: string;
}

/**
 * Compliance Check Result
 */
export interface ComplianceCheckResult {
  /** Check passed */
  passed: boolean;
  
  /** Violations found */
  violations: ComplianceViolation[];
  
  /** Risk score (0-100) */
  riskScore: number;
  
  /** Risk factors (legal domain) */
  riskFactors?: RiskFactor[];
  
  /** Recommendations */
  recommendations: string[];
  
  /** Regulatory references */
  regulatoryRefs: string[];
  
  /** Full explanation */
  explanation: Explanation;
  
  /** Audit trail */
  auditTrail: ProofStep[];
}

/**
 * Compliance Violation
 */
export interface ComplianceViolation {
  /** Violation ID */
  id: string;
  
  /** Rule violated */
  rule: LogicRule;
  
  /** Severity */
  severity: 'minor' | 'major' | 'critical';
  
  /** Description */
  description: string;
  
  /** Suggested remediation */
  remediation: string;
}

/**
 * Service Metrics
 */
export interface NeuroSymbolicMetrics {
  /** Total queries */
  totalQueries: number;
  
  /** Successful inferences */
  successfulInferences: number;
  
  /** Failed inferences */
  failedInferences: number;
  
  /** Average processing time */
  avgProcessingTimeMs: number;
  
  /** Average inference time */
  avgInferenceTimeMs: number;
  
  /** Cache hit rate */
  cacheHitRate: number;
  
  /** Hallucination rate (facts with low confidence) */
  hallucinationRate: number;
  
  /** Verification success rate */
  verificationSuccessRate: number;
}
