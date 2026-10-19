/**
 * Federated Learning Module
 * 
 * Privacy-preserving collaborative machine learning.
 * 
 * @example
 * ```typescript
 * import { FederatedCoordinatorService } from './federated';
 * 
 * const coordinator = new FederatedCoordinatorService(eventStream);
 * 
 * // Register organizations
 * await coordinator.registerOrg('org-1', 'Acme Corp', publicKey, dataProfile);
 * 
 * // Create training job
 * const job = await coordinator.createJob(
 *   'Customer Support Agent',
 *   'Train support agents across organizations',
 *   'agent_policy',
 *   ['support', 'troubleshooting'],
 *   ['org-1', 'org-2']
 * );
 * 
 * // Start training
 * await coordinator.startJob(job.id);
 * 
 * // Organizations submit local updates
 * await coordinator.submitUpdate(roundId, orgId, delta, metrics);
 * ```
 */

// Types
export {
  FederatedOrg,
  FederatedRound,
  FederatedTrainingJob,
  ModelVersion,
  LocalModelUpdate,
  ModelDelta,
  FederatedConfig,
  DEFAULT_FEDERATED_CONFIG,
  PrivacyParams,
  DEFAULT_PRIVACY_PARAMS,
  RoundMetrics,
  ContributionReport,
  FederatedMetrics,
  FederatedError,
  FederatedErrorType,
  SkillTransfer
} from './types.js';

// Services
export { FederatedCoordinatorService } from './coordinator.service.js';
