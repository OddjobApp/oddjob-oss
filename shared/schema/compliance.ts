/**
 * Compliance & Audit Schema
 * 
 * Types and validation for compliance packs, audit controls, and certification tracking.
 */

import { z } from 'zod';

/**
 * Compliance Framework (e.g., SOC2, HIPAA, GDPR)
 */
export const ComplianceFrameworkSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  category: z.enum(['financial', 'healthcare', 'general', 'industry-specific']),
  description: z.string(),
  effectiveDate: z.string(),
  requirements: z.array(z.object({
    id: z.string(),
    category: z.string(),
    description: z.string(),
    controlType: z.enum(['technical', 'administrative', 'physical']),
    priority: z.enum(['critical', 'high', 'medium', 'low'])
  }))
});

/**
 * Compliance Control - Specific control implementation
 */
export const ComplianceControlSchema = z.object({
  id: z.string(),
  frameworkId: z.string(),
  requirementId: z.string(),
  name: z.string(),
  description: z.string(),
  implementation: z.object({
    status: z.enum(['not_implemented', 'partially_implemented', 'implemented', 'exempt']),
    evidence: z.array(z.string()).optional(),
    automated: z.boolean().default(false),
    lastTested: z.string().optional()
  }),
  responsibleParty: z.string().optional(),
  testingFrequency: z.enum(['continuous', 'daily', 'weekly', 'monthly', 'quarterly', 'annual']).default('monthly')
});

/**
 * Compliance Pack - Bundle of controls for a domain
 */
export const CompliancePackSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(['financial', 'healthcare', 'general', 'custom']),
  frameworks: z.array(z.string()), // Framework IDs
  controls: z.array(ComplianceControlSchema),
  status: z.enum(['draft', 'active', 'archived']).default('draft'),
  createdAt: z.string(),
  updatedAt: z.string()
});

/**
 * Audit Result
 */
export const AuditResultSchema = z.object({
  id: z.string(),
  packId: z.string(),
  controlId: z.string(),
  status: z.enum(['pass', 'fail', 'warning', 'not_applicable']),
  score: z.number().min(0).max(100),
  findings: z.array(z.object({
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
    description: z.string(),
    recommendation: z.string()
  })).optional(),
  evidence: z.array(z.object({
    type: z.string(),
    reference: z.string(),
    timestamp: z.string()
  })).optional(),
  testedAt: z.string(),
  testedBy: z.string()
});

/**
 * Compliance Assessment
 */
export const ComplianceAssessmentSchema = z.object({
  id: z.string(),
  packId: z.string(),
  name: z.string(),
  status: z.enum(['in_progress', 'completed', 'failed']),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  results: z.array(AuditResultSchema),
  summary: z.object({
    totalControls: z.number(),
    passed: z.number(),
    failed: z.number(),
    warnings: z.number(),
    notApplicable: z.number(),
    overallScore: z.number().min(0).max(100)
  }),
  certifiable: z.boolean()
});

/**
 * Certification Record
 */
export const CertificationRecordSchema = z.object({
  id: z.string(),
  packId: z.string(),
  frameworkId: z.string(),
  status: z.enum(['pending', 'in_review', 'certified', 'expired', 'revoked']),
  issuedAt: z.string().optional(),
  expiresAt: z.string().optional(),
  issuedBy: z.string().optional(),
  certificateNumber: z.string().optional(),
  evidenceUrl: z.string().optional()
});

/**
 * Cost Tracking - Per-agent cost metrics
 */
export const AgentCostMetricsSchema = z.object({
  agentId: z.string(),
  period: z.object({
    start: z.string(),
    end: z.string()
  }),
  costs: z.object({
    compute: z.number(), // CPU/GPU cost
    storage: z.number(), // Data storage
    network: z.number(), // Data transfer
    apiCalls: z.number(), // External API costs
    modelTokens: z.number() // LLM token costs
  }),
  usage: z.object({
    requests: z.number(),
    tokens: z.object({
      prompt: z.number(),
      completion: z.number()
    }),
    computeTime: z.number(), // seconds
    storageBytes: z.number()
  }),
  rates: z.object({
    perRequest: z.number(),
    perThousandTokens: z.number(),
    perComputeHour: z.number(),
    perGBStorage: z.number()
  })
});

/**
 * Billing Record
 */
export const BillingRecordSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  period: z.object({
    start: z.string(),
    end: z.string()
  }),
  items: z.array(z.object({
    agentId: z.string(),
    description: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
    amount: z.number()
  })),
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
  status: z.enum(['draft', 'sent', 'paid', 'overdue']),
  dueDate: z.string(),
  paidAt: z.string().optional()
});

/**
 * Budget Alert
 */
export const BudgetAlertSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  type: z.enum(['threshold', 'forecast', 'anomaly']),
  threshold: z.number(), // percentage
  currentSpend: z.number(),
  budget: z.number(),
  status: z.enum(['active', 'resolved', 'dismissed']),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
  message: z.string(),
  triggeredAt: z.string(),
  resolvedAt: z.string().optional()
});

/**
 * Cost Optimization Recommendation
 */
export const CostOptimizationRecommendationSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  agentId: z.string().optional(),
  category: z.enum(['model_selection', 'caching', 'batching', 'compute_optimization', 'storage_cleanup']),
  title: z.string(),
  description: z.string(),
  currentCost: z.number(),
  projectedSavings: z.number().nullable(),
  savingsPercentage: z.number().nullable(),
  effort: z.enum(['low', 'medium', 'high']),
  impact: z.enum(['low', 'medium', 'high']),
  implementation: z.object({
    steps: z.array(z.string()),
    automated: z.boolean(),
    canAutoApply: z.boolean()
  }),
  status: z.enum(['pending', 'applied', 'rejected', 'implemented']),
  createdAt: z.string(),
  appliedAt: z.string().optional()
});

/**
 * Request/Response Schemas
 */
export const CreateCompliancePackRequestSchema = z.object({
  name: z.string(),
  description: z.string(),
  category: z.enum(['financial', 'healthcare', 'general', 'custom']),
  frameworks: z.array(z.string())
});

export const RunAuditRequestSchema = z.object({
  packId: z.string(),
  controlIds: z.array(z.string()).optional(), // Specific controls, or all if not provided
  automated: z.boolean().default(true)
});

export const CreateBudgetAlertRequestSchema = z.object({
  threshold: z.number().min(0).max(100),
  budget: z.number().positive(),
  organizationId: z.string()
});

export const ApplyRecommendationRequestSchema = z.object({
  recommendationId: z.string(),
  autoApply: z.boolean().default(false)
});

/**
 * TypeScript Types
 */
export type ComplianceFramework = z.infer<typeof ComplianceFrameworkSchema>;
export type ComplianceControl = z.infer<typeof ComplianceControlSchema>;
export type CompliancePack = z.infer<typeof CompliancePackSchema>;
export type AuditResult = z.infer<typeof AuditResultSchema>;
export type ComplianceAssessment = z.infer<typeof ComplianceAssessmentSchema>;
export type CertificationRecord = z.infer<typeof CertificationRecordSchema>;

export type AgentCostMetrics = z.infer<typeof AgentCostMetricsSchema>;
export type BillingRecord = z.infer<typeof BillingRecordSchema>;
export type BudgetAlert = z.infer<typeof BudgetAlertSchema>;
export type CostOptimizationRecommendation = z.infer<typeof CostOptimizationRecommendationSchema>;

export type CreateCompliancePackRequest = z.infer<typeof CreateCompliancePackRequestSchema>;
export type RunAuditRequest = z.infer<typeof RunAuditRequestSchema>;
export type CreateBudgetAlertRequest = z.infer<typeof CreateBudgetAlertRequestSchema>;
export type ApplyRecommendationRequest = z.infer<typeof ApplyRecommendationRequestSchema>;


