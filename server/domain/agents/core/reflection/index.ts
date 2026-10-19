/**
 * ReAct Reflection System
 * 
 * Provides explicit verification steps and self-correction loops
 * for the Oddjob agent orchestration system.
 * 
 * @example
 * ```typescript
 * import { 
 *   reflectionService, 
 *   AgentOrchestratorWithReflection,
 *   createAgentOrchestrator 
 * } from "@domain/agents/core/reflection";
 * 
 * // Use reflection-enabled orchestrator
 * const orchestrator = createAgentOrchestrator(client, apiKey, context, {
 *   enableReflection: true,
 *   reflectionConfig: {
 *     confidenceThreshold: 0.7,
 *     verificationStrategies: ["factual", "logical"]
 *   }
 * });
 * 
 * // Manual reflection
 * const result = await reflectionService.reflect({
 *   stepId: "my-step",
 *   missionRunId: 123,
 *   organizationId: 1,
 *   output: "Agent output to verify"
 * });
 * 
 * if (!result.passed) {
 *   console.log("Issues:", result.issues);
 *   console.log("Suggested correction:", result.suggestedCorrection);
 * }
 * ```
 */

// Core service
export { reflectionService, ReflectionService } from "./reflection.service.js";
export type {
  ReflectionConfig,
  ReflectionInput,
  ReflectionResult,
  VerificationResult,
  DetectedIssue,
  CorrectionSuggestion,
  CorrectionInput,
  CorrectionResult,
  VerificationStrategy,
} from "./reflection.service.js";

// Orchestrator integration
export {
  AgentOrchestratorWithReflection,
  createAgentOrchestrator,
  withReflection,
} from "./orchestrator-integration.js";
