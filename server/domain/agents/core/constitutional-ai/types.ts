/**
 * Constitutional AI - Types and Interfaces
 * 
 * Safety layer for agent actions with constitutional principles.
 * Provides guardrails, self-critique, and violation detection.
 */

/**
 * Constitutional Principle - Rule for agent behavior
 */
export interface ConstitutionalPrinciple {
  /** Unique identifier */
  id: string;
  
  /** Display name */
  name: string;
  
  /** Human-readable description */
  description: string;
  
  /** LLM-evaluable rule statement */
  rule: string;
  
  /** Severity level for violations */
  severity: 'advisory' | 'warning' | 'blocking' | 'critical';
  
  /** Category for grouping */
  category: 'privacy' | 'security' | 'accuracy' | 'ethics' | 'compliance' | 'safety';
  
  /** Examples for LLM few-shot learning */
  examples: {
    compliant: string[];
    violating: string[];
  };
  
  /** Whether to auto-correct violations */
  autoCorrect: boolean;
  
  /** Organization ID (null = system default) */
  organizationId?: number;
  
  /** Created timestamp */
  createdAt?: Date;
  
  /** Updated timestamp */
  updatedAt?: Date;
}

/**
 * Agent Action being reviewed
 */
export interface AgentAction {
  /** Action ID */
  id: string;
  
  /** Action type */
  type: 'tool_call' | 'api_call' | 'llm_generation' | 'code_execution' | 'file_operation' | 'database_query' | 'external_call';
  
  /** Action description */
  description: string;
  
  /** Action parameters */
  parameters: Record<string, any>;
  
  /** Action output */
  output?: string;
  
  /** Expected outcome */
  expectedOutcome?: string;
  
  /** Agent that performed action */
  agentId: string;
  
  /** Organization context */
  organizationId: number;
  
  /** Mission context */
  missionId?: string;
  
  /** Timestamp */
  timestamp: Date;
}

/**
 * Agent Context for constitutional review
 */
export interface AgentContext {
  /** Agent ID */
  agentId: string;
  
  /** Agent name/type */
  agentName: string;
  
  /** Mission description */
  missionDescription?: string;
  
  /** Organization ID */
  organizationId: number;
  
  /** Previous actions in session */
  actionHistory: AgentAction[];
  
  /** User who initiated */
  userId?: string;
  
  /** Risk level of operation */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  
  /** Sensitive data flags */
  involvesPII: boolean;
  
  /** External exposure */
  exposesExternally: boolean;
}

/**
 * Constitutional Check Result
 */
export interface ConstitutionalCheck {
  /** Principle being checked */
  principle: ConstitutionalPrinciple;
  
  /** Original action */
  action: AgentAction;
  
  /** LLM-generated critique */
  critique: string;
  
  /** Whether action complies */
  compliant: boolean;
  
  /** Confidence score (0-1) */
  confidence: number;
  
  /** Revised action if auto-corrected */
  revisedAction?: AgentAction;
  
  /** Suggested corrections */
  suggestions?: string[];
  
  /** Check timestamp */
  checkedAt: Date;
  
  /** Review time (ms) */
  reviewTimeMs: number;
}

/**
 * Complete Constitutional Review
 */
export interface ConstitutionalReview {
  /** Review ID */
  reviewId: string;
  
  /** Original action */
  originalAction: AgentAction;
  
  /** Individual checks */
  checks: ConstitutionalCheck[];
  
  /** Final action (may be revised) */
  finalAction: AgentAction;
  
  /** Blocking violations */
  blockingViolations: ConstitutionalCheck[];
  
  /** Non-blocking violations (warnings) */
  warnings: ConstitutionalCheck[];
  
  /** Total review time (ms) */
  totalReviewTimeMs: number;
  
  /** Whether review was approved */
  approved: boolean;
  
  /** Escalation required */
  requiresEscalation: boolean;
  
  /** Timestamp */
  reviewedAt: Date;
}

/**
 * Constitution - Collection of principles
 */
export interface Constitution {
  /** Constitution ID */
  id: string;
  
  /** Display name */
  name: string;
  
  /** Description */
  description: string;
  
  /** Principles */
  principles: ConstitutionalPrinciple[];
  
  /** Organization ID */
  organizationId: number;
  
  /** Is default constitution */
  isDefault: boolean;
  
  /** Created timestamp */
  createdAt: Date;
  
  /** Updated timestamp */
  updatedAt: Date;
}

/**
 * Constitutional AI Service Configuration
 */
export interface ConstitutionalAIConfig {
  /** Enable constitutional checking */
  enabled: boolean;
  
  /** Default constitution ID */
  defaultConstitutionId: string;
  
  /** LLM model for critique */
  critiqueModel: string;
  
  /** Temperature for critique generation */
  critiqueTemperature: number;
  
  /** Maximum principles to check per action */
  maxPrinciplesPerCheck: number;
  
  /** Enable auto-correction */
  enableAutoCorrection: boolean;
  
  /** Minimum confidence for auto-correction */
  autoCorrectionConfidence: number;
  
  /** Enable parallel checking */
  parallelChecking: boolean;
  
  /** Timeout for critique (ms) */
  critiqueTimeoutMs: number;
  
  /** Log all reviews */
  logAllReviews: boolean;
  
  /** Enable multi-agent debate mechanism */
  enableDebateMechanism?: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_CONSTITUTIONAL_AI_CONFIG: ConstitutionalAIConfig = {
  enabled: true,
  defaultConstitutionId: 'default',
  critiqueModel: 'gpt-4',
  critiqueTemperature: 0.2,
  maxPrinciplesPerCheck: 10,
  enableAutoCorrection: true,
  autoCorrectionConfidence: 0.8,
  parallelChecking: true,
  critiqueTimeoutMs: 5000,
  logAllReviews: true
};

/**
 * Pre-defined Constitutional Principles
 */
export const DEFAULT_PRINCIPLES: ConstitutionalPrinciple[] = [
  {
    id: 'privacy-1',
    name: 'PII Protection',
    description: 'Never expose personally identifiable information in outputs',
    rule: 'Actions must not expose PII (names, emails, SSNs, phone numbers, addresses) in outputs unless explicitly authorized by user with proper consent',
    severity: 'blocking',
    category: 'privacy',
    examples: {
      compliant: [
        'User ID 12345 submitted feedback',
        'The customer reported an issue with their account'
      ],
      violating: [
        'John Doe (john@email.com, SSN: 123-45-6789) reported an issue',
        'Contact Sarah at 555-1234 or sarah@company.com'
      ]
    },
    autoCorrect: true
  },
  {
    id: 'security-1',
    name: 'No Code Injection',
    description: 'Prevent injection vulnerabilities in generated code',
    rule: 'Generated code must not contain SQL injection, XSS, command injection, or other security vulnerabilities. Use parameterized queries and proper sanitization.',
    severity: 'blocking',
    category: 'security',
    examples: {
      compliant: [
        'const query = "SELECT * FROM users WHERE id = ?"; // parameterized',
        'const sanitized = DOMPurify.sanitize(userInput);'
      ],
      violating: [
        'const query = `SELECT * FROM users WHERE id = ${userInput}`;',
        'element.innerHTML = userInput; // XSS vulnerability'
      ]
    },
    autoCorrect: true
  },
  {
    id: 'accuracy-1',
    name: 'Fact Verification',
    description: 'Verify facts before stating as truth',
    rule: 'When making factual claims, verify against knowledge graph or reliable sources. Express uncertainty for unverified claims using phrases like "appears to be" or "likely".',
    severity: 'warning',
    category: 'accuracy',
    examples: {
      compliant: [
        'According to the knowledge base, revenue was $5M (confidence: 0.92)',
        'The system appears to be experiencing latency (monitoring shows 95th percentile at 2s)'
      ],
      violating: [
        'Revenue was exactly $5,234,123.45',
        'The system is definitely down right now'
      ]
    },
    autoCorrect: true
  },
  {
    id: 'ethics-1',
    name: 'No Harmful Content',
    description: 'Prevent generation of harmful or inappropriate content',
    rule: 'Actions must not generate, promote, or assist with harmful, illegal, discriminatory, or inappropriate content. This includes hate speech, violence, explicit content, or dangerous instructions.',
    severity: 'critical',
    category: 'ethics',
    examples: {
      compliant: [
        'I can help you with general programming questions',
        'Let me find safe alternatives for that task'
      ],
      violating: [
        'Here is how to create harmful content',
        'Steps to perform illegal activity'
      ]
    },
    autoCorrect: false
  },
  {
    id: 'compliance-1',
    name: 'Data Retention',
    description: 'Respect data retention and deletion policies',
    rule: 'Actions involving data deletion must be permanent and irreversible. Confirm user intent before permanent deletion. Log all deletion actions.',
    severity: 'blocking',
    category: 'compliance',
    examples: {
      compliant: [
        'Data deletion confirmed. 5 records permanently removed.',
        'Archive before delete? User confirmed direct deletion.'
      ],
      violating: [
        'Soft-deleted the records (can be recovered)',
        'Deleted data without logging or confirmation'
      ]
    },
    autoCorrect: false
  },
  {
    id: 'safety-1',
    name: 'No Dangerous Operations',
    description: 'Prevent dangerous system operations',
    rule: 'Actions must not perform dangerous operations like deleting databases, dropping tables, or modifying critical infrastructure without multi-factor approval.',
    severity: 'critical',
    category: 'safety',
    examples: {
      compliant: [
        'Database migration plan created. Awaiting approval before execution.',
        'Schema change requires admin approval - submitted for review'
      ],
      violating: [
        'Dropped production database',
        'Deleted all user accounts without backup'
      ]
    },
    autoCorrect: false
  }
];

/**
 * Default Constitution
 */
export const DEFAULT_CONSTITUTION: Constitution = {
  id: 'default',
  name: 'Oddjob Default Constitution',
  description: 'Core safety principles for all agent operations',
  principles: DEFAULT_PRINCIPLES,
  organizationId: 0,
  isDefault: true,
  createdAt: new Date(),
  updatedAt: new Date()
};

/**
 * Violation Report
 */
export interface ViolationReport {
  /** Report ID */
  id: string;
  
  /** Violated principle */
  principle: ConstitutionalPrinciple;
  
  /** Violating action */
  action: AgentAction;
  
  /** Review details */
  review: ConstitutionalReview;
  
  /** Human override */
  humanOverride?: {
    overriddenBy: string;
    reason: string;
    overriddenAt: Date;
  };
  
  /** Resolution status */
  status: 'open' | 'investigating' | 'resolved' | 'false_positive';
  
  /** Created timestamp */
  createdAt: Date;
  
  /** Updated timestamp */
  updatedAt: Date;
}

/**
 * Constitutional AI Metrics
 */
export interface ConstitutionalAIMetrics {
  /** Total reviews performed */
  totalReviews: number;
  
  /** Total violations detected */
  totalViolations: number;
  
  /** Violations by category */
  violationsByCategory: Record<string, number>;
  
  /** Violations by severity */
  violationsBySeverity: Record<string, number>;
  
  /** Auto-correction success rate */
  autoCorrectionRate: number;
  
  /** Average review time (ms) */
  averageReviewTimeMs: number;
  
  /** False positive rate */
  falsePositiveRate: number;
  
  /** Human override rate */
  humanOverrideRate: number;
}

/**
 * Constitutional AI Events
 */
export type ConstitutionalAIEvent =
  | { type: 'constitutional.review_started'; payload: { reviewId: string; actionId: string } }
  | { type: 'constitutional.review_completed'; payload: { reviewId: string; approved: boolean; violations: number } }
  | { type: 'constitutional.violation_detected'; payload: { reviewId: string; principleId: string; severity: string } }
  | { type: 'constitutional.auto_corrected'; payload: { reviewId: string; actionId: string; principleId: string } }
  | { type: 'constitutional.escalated'; payload: { reviewId: string; actionId: string; reason: string } }
  | { type: 'constitutional.human_override'; payload: { reportId: string; overriddenBy: string; reason: string } };

/**
 * Error types
 */
export enum ConstitutionalAIErrorType {
  INVALID_ACTION = 'invalid_action',
  INVALID_PRINCIPLE = 'invalid_principle',
  CRITIQUE_FAILED = 'critique_failed',
  CORRECTION_FAILED = 'correction_failed',
  CONSTITUTION_NOT_FOUND = 'constitution_not_found',
  PRINCIPLE_NOT_FOUND = 'principle_not_found',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown'
}

/**
 * Constitutional AI Error
 */
export class ConstitutionalAIError extends Error {
  constructor(
    public type: ConstitutionalAIErrorType,
    message: string,
    public reviewId?: string,
    public cause?: Error
  ) {
    super(message);
    this.name = 'ConstitutionalAIError';
  }
}

/**
 * Critique Prompt Template
 */
export interface CritiquePromptTemplate {
  /** Template ID */
  id: string;
  
  /** Template name */
  name: string;
  
  /** System prompt */
  systemPrompt: string;
  
  /** User prompt template */
  userPromptTemplate: string;
  
  /** Output schema */
  outputSchema: object;
}

/**
 * Auto-correction Result
 */
export interface AutoCorrectionResult {
  /** Success status */
  success: boolean;
  
  /** Corrected action */
  correctedAction?: AgentAction;
  
  /** Correction explanation */
  explanation?: string;
  
  /** Confidence in correction */
  confidence: number;
  
  /** Attempt count */
  attempts: number;
}

/**
 * Escalation Request
 */
export interface EscalationRequest {
  /** Request ID */
  id: string;
  
  /** Review being escalated */
  review: ConstitutionalReview;
  
  /** Escalation reason */
  reason: string;
  
  /** Requested reviewer level */
  requiredLevel: 'admin' | 'security' | 'compliance' | 'executive';
  
  /** Urgency */
  urgency: 'low' | 'medium' | 'high' | 'critical';
  
  /** Requested by */
  requestedBy: string;
  
  /** Timestamp */
  requestedAt: Date;
}
