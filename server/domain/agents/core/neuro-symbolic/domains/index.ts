/**
 * Neuro-Symbolic Domain Rulesets
 * 
 * Pre-built domain rulesets for various industries.
 * 
 * @example
 * ```typescript
 * import { 
 *   amlRuleset, 
 *   clinicalRuleset, 
 *   legalRuleset 
 * } from '@oddjob/neuro-symbolic/domains';
 * 
 * const service = new HybridReasoningService(llmClient);
 * 
 * // Load finance rules
 * service.loadDomainRuleset(amlRuleset);
 * 
 * // Load healthcare rules
 * service.loadDomainRuleset(clinicalRuleset);
 * 
 * // Load legal rules
 * service.loadDomainRuleset(legalRuleset);
 * ```
 */

// Finance Domain
export {
  amlRuleset,
  amlSchema,
  amlRules,
  highRiskCountries,
  getHighRiskCountryFacts
} from './finance/index.js';

// Healthcare Domain
export {
  clinicalRuleset,
  clinicalSchema,
  clinicalRules,
  commonDrugInteractions,
  contraindications,
  getDrugInteractionFacts,
  getContraindicationFacts
} from './healthcare/index.js';

// Legal Domain
export {
  legalRuleset,
  legalSchema,
  legalRules,
  gdprRequiredClauses,
  highRiskTerms,
  getGDPRClauseFacts,
  getHighRiskTermFacts
} from './legal/index.js';
