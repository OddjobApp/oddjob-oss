/**
 * Privacy-Aware Model Router
 *
 * Enforces data-residency and privacy requirements at the model selection layer.
 * Reads the `dataClassification` field from a job and applies routing rules:
 *
 *   public     → any configured model is allowed
 *   internal   → cloud is acceptable; logs an audit notice
 *   sensitive  → cloud is allowed but a compliance warning is emitted
 *   restricted → MUST use a local/on-prem model; throws if none is configured
 *
 * Integration:
 *   Call `privacyRouter.enforce(jobDataClassification, candidateModel)` before
 *   dispatching a model request in `ai-client.service.ts` or any worker.
 *
 * Local model detection:
 *   A model is considered "local" when its provider is one of the configured
 *   LOCAL_PROVIDERS, or its model ID starts with a known local prefix.
 */

import { createLogger } from '@server/utils/logger.js';
import { ForbiddenError } from '@server/utils/errors.js';
import type { DataClassification } from '@shared/schema/jobs/table.js';

const logger = createLogger('PrivacyRouter');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Provider names that are considered on-prem/local by default */
const LOCAL_PROVIDERS = new Set(['ollama', 'local_openai', 'local', 'lmstudio', 'vllm', 'llamacpp']);

/** Model ID prefixes that always indicate a local model */
const LOCAL_MODEL_PREFIXES = ['local:', 'llama', 'mistral', 'deepseek', 'phi', 'qwen', 'gemma', 'nomic'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelCandidate {
  /** The model identifier, e.g. "claude-3-5-sonnet", "llama3.1:latest" */
  model: string;
  /** The resolved provider, e.g. "anthropic", "ollama" */
  provider: string;
}

export interface PrivacyRouterResult {
  allowed: boolean;
  /** If the candidate was redirected, this is the suggested local fallback model */
  fallbackModel?: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isLocalModel(candidate: ModelCandidate): boolean {
  const providerLower = candidate.provider.toLowerCase();
  const modelLower = candidate.model.toLowerCase();
  if (LOCAL_PROVIDERS.has(providerLower)) return true;
  return LOCAL_MODEL_PREFIXES.some((prefix) => modelLower.startsWith(prefix));
}

// ---------------------------------------------------------------------------
// PrivacyRouterService
// ---------------------------------------------------------------------------

export class PrivacyRouterService {
  /**
   * The default local fallback model used when a restricted job has no explicit model.
   * Configurable via PRIVACY_ROUTER_LOCAL_FALLBACK env var.
   */
  private localFallback: string =
    process.env.PRIVACY_ROUTER_LOCAL_FALLBACK ?? 'llama3.1:latest';

  /**
   * Evaluate whether a model candidate is permitted for the given data classification.
   *
   * @param classification  The job's data_classification field
   * @param candidate       The model + provider about to be used
   * @returns               A decision object; throws ForbiddenError for 'restricted' violations
   */
  enforce(
    classification: DataClassification,
    candidate: ModelCandidate
  ): PrivacyRouterResult {
    const local = isLocalModel(candidate);

    switch (classification) {
      case 'public':
        return { allowed: true, reason: 'Public data: all models permitted.' };

      case 'internal':
        if (!local) {
          logger.info(
            `[PrivacyRouter] Internal data routed to cloud model "${candidate.model}" ` +
            `(provider: ${candidate.provider}). Consider on-prem routing.`
          );
        }
        return { allowed: true, reason: 'Internal data: cloud allowed with notice.' };

      case 'sensitive':
        if (!local) {
          logger.warn(
            `[PrivacyRouter] ⚠ Sensitive data is being sent to cloud model "${candidate.model}" ` +
            `(provider: ${candidate.provider}). Ensure DPA/BAA is in place.`
          );
        }
        return { allowed: true, reason: 'Sensitive data: cloud allowed with compliance warning.' };

      case 'restricted': {
        if (local) {
          return { allowed: true, reason: 'Restricted data: local model confirmed.' };
        }

        // Cloud model blocked for restricted data
        const fallback = this.localFallback;
        logger.error(
          `[PrivacyRouter] 🚫 Restricted data cannot be sent to cloud model ` +
          `"${candidate.model}" (provider: ${candidate.provider}). ` +
          `Suggested fallback: "${fallback}".`
        );
        throw new ForbiddenError(
          `Privacy Policy: Data classified as 'restricted' cannot use cloud model ` +
          `"${candidate.model}". Configure a local/on-prem model (e.g. "${fallback}") ` +
          `or change the job's dataClassification.`
        );
      }

      default:
        // Unknown classification — fail open with a warning
        logger.warn(`[PrivacyRouter] Unknown data classification "${classification}". Allowing.`);
        return { allowed: true, reason: `Unknown classification "${classification}": allowed by default.` };
    }
  }

  /**
   * Convenience: return the configured local fallback model name.
   * Used by workers that need to auto-redirect a restricted job.
   */
  getLocalFallback(): string {
    return this.localFallback;
  }

  /**
   * Determine whether a given model candidate is local.
   * Exposed for testing and upstream decision logic.
   */
  isLocal(candidate: ModelCandidate): boolean {
    return isLocalModel(candidate);
  }
}

// Export singleton
export const privacyRouter = new PrivacyRouterService();
