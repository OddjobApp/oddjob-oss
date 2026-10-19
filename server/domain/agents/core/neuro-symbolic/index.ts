/**
 * Neuro-Symbolic AI Module
 * 
 * Hybrid neural + symbolic reasoning for verifiable, explainable AI.
 * 
 * @example
 * ```typescript
 * import { HybridReasoningService, DatalogEngine } from './neuro-symbolic';
 * 
 * // Initialize with LLM client
 * const service = new HybridReasoningService(llmClient);
 * 
 * // Load domain ruleset
 * service.loadDomainRuleset(financeRuleset);
 * 
 * // Query with natural language
 * const result = await service.query({
 *   naturalLanguage: "Is this transaction suspicious?",
 *   domain: "finance",
 *   requiresVerification: true
 * });
 * 
 * console.log(result.naturalAnswer);
 * console.log(result.explanation.steps);
 * ```
 */

export type {
  SymbolicFact,
  LogicRule,
  LogicAtom,
  LogicTerm,
  InferenceResult,
  ProofStep,
  DatalogProgram,
  NeuroSymbolicQuery,
  NeuroSymbolicResponse,
  LogicTranslation,
  Explanation,
  DomainRuleset,
  PredicateSchema,
  NLTemplate,
  NeuroSymbolicConfig,
  NeuroSymbolicMetrics,
  ComplianceCheckRequest,
  ComplianceCheckResult,
  RiskFactor
} from './types.js';

export {
  DEFAULT_NEURO_SYMBOLIC_CONFIG,
  NeuroSymbolicError,
  NeuroSymbolicErrorType
} from './types.js';

// Services
export { DatalogEngine } from './datalog-engine.js';
export { HybridReasoningService } from './hybrid-reasoning.service.js';

// Domain Rulesets
export {
  // Finance
  amlRuleset,
  amlSchema,
  amlRules,
  highRiskCountries,
  getHighRiskCountryFacts,
  // Healthcare
  clinicalRuleset,
  clinicalSchema,
  clinicalRules,
  commonDrugInteractions,
  contraindications,
  getDrugInteractionFacts,
  getContraindicationFacts,
  // Legal
  legalRuleset,
  legalSchema,
  legalRules,
  gdprRequiredClauses,
  highRiskTerms,
  getGDPRClauseFacts,
  getHighRiskTermFacts
} from './domains/index.js';
