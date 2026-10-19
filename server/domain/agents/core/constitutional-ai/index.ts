/**
 * Constitutional AI Module
 * 
 * Agent safety layer with constitutional principles.
 * 
 * @example
 * ```typescript
 * import { ConstitutionalAIService } from './constitutional-ai';
 * 
 * const service = new ConstitutionalAIService(
 *   llmClient,
 *   constitutionRepo,
 *   eventStream
 * );
 * 
 * const review = await service.reviewAction(
 *   action,
 *   context
 * );
 * 
 * if (review.approved) {
 *   // Execute action
 * } else {
 *   // Handle violations
 * }
 * ```
 */

// Types
export {
  AgentAction,
  AgentContext,
  Constitution,
  ConstitutionalPrinciple,
  ConstitutionalReview,
  ConstitutionalCheck,
  ConstitutionalAIConfig,
  DEFAULT_CONSTITUTIONAL_AI_CONFIG,
  DEFAULT_PRINCIPLES,
  DEFAULT_CONSTITUTION,
  ViolationReport,
  ConstitutionalAIMetrics,
  ConstitutionalAIError,
  ConstitutionalAIErrorType
} from './types.js';

// Services
export { ConstitutionalAIService } from './constitutional-ai.service.js';
export { CritiqueEngine } from './critique.engine.js';
