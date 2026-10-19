/**
 * HIL Pattern Detector Service
 *
 * Hooks into the DecisionRouter post-approval flow to detect repeated
 * approval patterns. When the same (tool, parameterKeys) combination is
 * approved ≥ 5 times for a repository, it triggers a KB question proposing
 * convention codification.
 *
 * Additionally, when a repeating pattern is identified, a knowledge node is
 * created (or found) capturing the decision pattern (tool + risk + outcome),
 * and linked to the approval request via `approval_requests.knowledgeNodeId`.
 *
 * Pattern matching rules:
 * - Tool name: exact match
 * - Parameter keys: sorted set equality (values are excluded)
 *
 * Redis key: hil_approvals:{orgId}:{repoId}:{tool}:{paramKeysHash}
 * Type: Sorted Set (score = Unix timestamp, member = {missionId}:{timestamp})
 * TTL: 30 days
 */

import { createLogger } from "@server/utils/logger.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { knowledgeBaseQuestionEngineService } from "../knowledge-base-question-engine.service.js";
import { createHash } from "crypto";
import { db } from "@server/database_service.js";
import { knowledgeBaseQuestions, knowledgeNodes, approvalRequests } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

const logger = createLogger("HILPatternDetector");

/** Threshold of approvals before triggering a question. */
const APPROVAL_THRESHOLD = 5;

/** TTL for Redis sorted set entries (30 days in seconds). */
const REDIS_TTL_SECONDS = 30 * 24 * 60 * 60; // 2,592,000 seconds

/**
 * Computes a deterministic hash for a sorted set of parameter keys.
 * Uses SHA-256 truncated to 16 hex characters for compact Redis key composition.
 */
function computeParamKeysHash(params: Record<string, any>): string {
  const sortedKeys = Object.keys(params).sort().join(",");
  return createHash("sha256").update(sortedKeys).digest("hex").slice(0, 16);
}

/**
 * Builds the Redis key for tracking HIL approvals for a specific pattern.
 */
function buildRedisKey(
  organizationId: number,
  repositoryId: string,
  tool: string,
  paramKeysHash: string
): string {
  return `hil_approvals:${organizationId}:${repositoryId}:${tool}:${paramKeysHash}`;
}

export const hilPatternDetectorService = {
  /**
   * Called after an approval_request is approved.
   * Records the approval event and checks if the (tool, parameterKeys, repositoryId)
   * pattern has reached the threshold for question creation.
   *
   * When the threshold is reached, also creates/links a knowledge node
   * representing the decision pattern (tool + risk + outcome) and updates the
   * approval request's `knowledgeNodeId`.
   *
   * Fire-and-forget semantics: Redis failures are logged but do not
   * propagate to the caller.
   */
  async onApproval(
    organizationId: number,
    repositoryId: string,
    tool: string,
    params: Record<string, any>,
    missionId?: number,
    approvalRequestId?: number
  ): Promise<void> {
    const paramKeysHash = computeParamKeysHash(params);
    const redisKey = buildRedisKey(organizationId, repositoryId, tool, paramKeysHash);
    const timestamp = Date.now();
    const member = `${missionId ?? 0}:${timestamp}`;

    try {
      // Record the approval event in the sorted set
      await redis.zadd(redisKey, timestamp, member);

      // Refresh TTL on every write to keep the window alive
      await redis.expire(redisKey, REDIS_TTL_SECONDS);

      // Check current count
      const count = await redis.zcard(redisKey);

      if (count < APPROVAL_THRESHOLD) {
        logger.debug(
          `[HILPatternDetector] Pattern count ${count}/${APPROVAL_THRESHOLD} for ${tool} in repo ${repositoryId}`
        );
        return;
      }

      // Threshold reached — create/link a knowledge node for this decision pattern
      const parameterKeys = Object.keys(params).sort();

      if (approvalRequestId) {
        await this._linkApprovalToKnowledgeNode(
          organizationId,
          repositoryId,
          tool,
          parameterKeys,
          approvalRequestId,
          count
        );
      }

      // Check for deduplication before creating a question
      const hasPending = await this._hasPendingQuestion(organizationId, repositoryId, tool);
      if (hasPending) {
        logger.info(
          `[HILPatternDetector] Skipping — pending question already exists for tool "${tool}" in repo ${repositoryId}`
        );
        return;
      }

      // Create the KB question
      logger.info(
        `[HILPatternDetector] Threshold reached (${count}) for tool "${tool}" in repo ${repositoryId}. Creating question.`
      );

      await knowledgeBaseQuestionEngineService.createQuestion(
        organizationId,
        repositoryId,
        "hil_pattern_detected",
        {
          tool,
          parameterKeys,
          approvalCount: count,
          repositoryId,
          sampleParams: params,
        }
      );
    } catch (err: any) {
      // Graceful degradation: log and move on
      logger.warn(
        `[HILPatternDetector] Failed to process approval for tool "${tool}": ${err.message}`
      );
    }
  },

  /**
   * Returns the approval count for a specific pattern in a repository.
   * Useful for diagnostics and testing.
   */
  async getPatternCount(
    organizationId: number,
    repositoryId: string,
    tool: string,
    parameterKeys: string[]
  ): Promise<number> {
    const sortedKeys = [...parameterKeys].sort().join(",");
    const paramKeysHash = createHash("sha256").update(sortedKeys).digest("hex").slice(0, 16);
    const redisKey = buildRedisKey(organizationId, repositoryId, tool, paramKeysHash);

    try {
      const count = await redis.zcard(redisKey);
      return count;
    } catch (err: any) {
      logger.warn(
        `[HILPatternDetector] Failed to get pattern count for tool "${tool}": ${err.message}`
      );
      return 0;
    }
  },

  /**
   * Checks if a pending `hil_pattern_detected` question already exists
   * for the given tool and repository combination.
   * @internal
   */
  async _hasPendingQuestion(
    organizationId: number,
    repositoryId: string,
    tool: string
  ): Promise<boolean> {
    try {
      const existing = await db
        .select({ id: knowledgeBaseQuestions.id, contextData: knowledgeBaseQuestions.contextData })
        .from(knowledgeBaseQuestions)
        .where(
          and(
            eq(knowledgeBaseQuestions.organizationId, organizationId),
            eq(knowledgeBaseQuestions.repositoryId, repositoryId),
            eq(knowledgeBaseQuestions.triggerSource, "hil_pattern_detected"),
            eq(knowledgeBaseQuestions.status, "pending")
          )
        );

      // Check if any existing pending question is for the same tool
      return existing.some((q) => {
        const ctx = q.contextData as Record<string, any> | null;
        return ctx?.tool === tool;
      });
    } catch (err: any) {
      logger.warn(
        `[HILPatternDetector] Deduplication check failed: ${err.message}`
      );
      // On failure, allow creation (fail-open) to avoid silently dropping signals
      return false;
    }
  },

  /**
   * Creates or finds a knowledge node representing a repeating approval
   * decision pattern (tool + parameter keys + repository), then links
   * the approval request to it via `approval_requests.knowledgeNodeId`.
   *
   * The node is deduplicated by fingerprint: sha256(org:repo:tool:paramKeysHash).
   * If the node already exists, we reuse it and increment its usageCount.
   *
   * @internal
   */
  async _linkApprovalToKnowledgeNode(
    organizationId: number,
    repositoryId: string,
    tool: string,
    parameterKeys: string[],
    approvalRequestId: number,
    approvalCount: number
  ): Promise<void> {
    try {
      const paramKeysHash = computeParamKeysHash(
        Object.fromEntries(parameterKeys.map((k) => [k, true]))
      );
      const fingerprint = createHash("sha256")
        .update(`hil_pattern:${organizationId}:${repositoryId}:${tool}:${paramKeysHash}`)
        .digest("hex")
        .slice(0, 32);

      // Try to find an existing knowledge node with this fingerprint
      const existing = await db
        .select({ id: knowledgeNodes.id, usageCount: knowledgeNodes.usageCount })
        .from(knowledgeNodes)
        .where(
          and(
            eq(knowledgeNodes.organizationId, organizationId),
            eq(knowledgeNodes.fingerprint, fingerprint)
          )
        )
        .limit(1);

      let knowledgeNodeId: number;

      if (existing.length > 0) {
        // Reuse existing node — increment usage count
        knowledgeNodeId = existing[0].id;
        const currentUsage = existing[0].usageCount ?? 0;
        await db
          .update(knowledgeNodes)
          .set({ usageCount: currentUsage + 1, updatedAt: new Date() })
          .where(eq(knowledgeNodes.id, knowledgeNodeId));

        logger.debug(
          `[HILPatternDetector] Reusing knowledge node ${knowledgeNodeId} for tool "${tool}" (usage: ${currentUsage + 1})`
        );
      } else {
        // Create a new knowledge node for this decision pattern
        const [inserted] = await db
          .insert(knowledgeNodes)
          .values({
            label: "ApprovalPattern",
            name: `HIL pattern: ${tool} [${parameterKeys.join(", ")}]`,
            fingerprint,
            organizationId,
            sourceType: "system",
            fidelityClass: "operational",
            scope: "org",
            verificationStatus: "verified",
            confidenceScore: "0.80",
            usageCount: 1,
            data: {
              tool,
              parameterKeys,
              repositoryId,
              approvalCount,
              detectedAt: new Date().toISOString(),
            },
          })
          .returning({ id: knowledgeNodes.id });

        knowledgeNodeId = inserted.id;
        logger.info(
          `[HILPatternDetector] Created knowledge node ${knowledgeNodeId} for approval pattern: ${tool}`
        );
      }

      // Link the approval request to the knowledge node
      await db
        .update(approvalRequests)
        .set({ knowledgeNodeId })
        .where(eq(approvalRequests.id, approvalRequestId));

      logger.debug(
        `[HILPatternDetector] Linked approval request ${approvalRequestId} to knowledge node ${knowledgeNodeId}`
      );
    } catch (err: any) {
      // Non-fatal: log and continue — the approval already succeeded
      logger.warn(
        `[HILPatternDetector] Failed to link approval to knowledge node: ${err.message}`
      );
    }
  },
};
