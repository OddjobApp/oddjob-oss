import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";
import { knowledgeBaseQuestionEngineService } from "../knowledge-base-question-engine.service.js";
import type { RescueEvent } from "./types.js";
import { db } from "@server/database_service.js";
import { knowledgeBaseQuestions } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

const logger = createLogger("RescueStrategyTrackerService");

/** Threshold: number of rescue events in the window that triggers a KB question. */
const RESCUE_THRESHOLD = 3;

/** 7-day sliding window in milliseconds. */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** TTL for Redis sorted set keys: 8 days in seconds (1-day buffer beyond 7-day window). */
const KEY_TTL_SECONDS = 8 * 24 * 60 * 60;

/**
 * Builds the Redis key for a rescue event sorted set.
 * Pattern: rescue_events:{orgId}:{strategy}:{jobType}
 */
function buildKey(organizationId: number, strategy: string, jobType: string): string {
  return `rescue_events:${organizationId}:${strategy}:${jobType}`;
}

export const rescueStrategyTrackerService = {
  /**
   * Records a rescue strategy event and checks the 7-day window threshold.
   * If threshold (≥3) is met and no pending duplicate exists, triggers KB question creation.
   *
   * On Redis unavailability: logs warning, skips threshold check.
   */
  async recordAndCheck(
    organizationId: number,
    repositoryId: string,
    event: RescueEvent
  ): Promise<void> {
    const { strategy, jobType, missionRunId, timestamp } = event;
    const key = buildKey(organizationId, strategy, jobType);
    const member = `${missionRunId}:${timestamp}`;

    try {
      // Write event to sorted set (score = Unix timestamp in ms)
      await redis.zadd(key, timestamp, member);

      // Set/refresh TTL (8 days)
      await redis.expire(key, KEY_TTL_SECONDS);

      // Check the 7-day window count
      const now = Date.now();
      const windowStart = now - WINDOW_MS;
      const count = await redis.zcount(key, windowStart, "+inf");

      if (count < RESCUE_THRESHOLD) {
        return;
      }

      // Deduplication: check if pending question already exists for same strategy+jobType
      const hasPending = await this.hasPendingQuestion(organizationId, strategy, jobType);
      if (hasPending) {
        logger.info(
          `[RescueTracker] Skipping duplicate — pending question exists for ` +
          `strategy=${strategy}, jobType=${jobType}, org=${organizationId}`
        );
        return;
      }

      // Gather the mission run IDs from events in the window for context
      const windowMembers = await redis.zrangebyscore(key, windowStart, "+inf");
      const missionRunIds = windowMembers.map((m) => {
        const parts = m.split(":");
        return parseInt(parts[0], 10);
      }).filter((id) => !isNaN(id));

      // Create question
      await knowledgeBaseQuestionEngineService.createQuestion(
        organizationId,
        repositoryId,
        "rescue_pattern_detected",
        {
          strategy,
          jobType,
          count,
          missionRunIds,
        }
      );

      logger.info(
        `[RescueTracker] Created rescue_pattern_detected question — ` +
        `strategy=${strategy}, jobType=${jobType}, count=${count}, org=${organizationId}`
      );
    } catch (err: any) {
      // Redis unavailability or other failure: log warning, skip threshold check
      logger.warn(
        `[RescueTracker] Failed to record/check rescue event (proceeding): ${err.message}`,
        { organizationId, strategy, jobType, missionRunId }
      );
    }
  },

  /**
   * Returns the count of events for a (strategy, jobType) pair in the last 7 days.
   * Uses ZCOUNT with the 7-day window boundaries.
   *
   * On Redis unavailability: logs warning, returns 0.
   */
  async getWindowCount(
    organizationId: number,
    strategy: string,
    jobType: string
  ): Promise<number> {
    try {
      const key = buildKey(organizationId, strategy, jobType);
      const now = Date.now();
      const windowStart = now - WINDOW_MS;
      return await redis.zcount(key, windowStart, "+inf");
    } catch (err: any) {
      logger.warn(
        `[RescueTracker] Failed to get window count (returning 0): ${err.message}`,
        { organizationId, strategy, jobType }
      );
      return 0;
    }
  },

  /**
   * Checks if a pending question already exists for the same strategy+jobType combination.
   * Used for deduplication before creating new questions.
   */
  async hasPendingQuestion(
    organizationId: number,
    strategy: string,
    jobType: string
  ): Promise<boolean> {
    try {
      const pending = await db
        .select()
        .from(knowledgeBaseQuestions)
        .where(
          and(
            eq(knowledgeBaseQuestions.organizationId, organizationId),
            eq(knowledgeBaseQuestions.triggerSource, "rescue_pattern_detected"),
            eq(knowledgeBaseQuestions.status, "pending")
          )
        );

      // Check if any pending question matches the strategy+jobType in context data
      return pending.some((q) => {
        const ctx = q.contextData as Record<string, any> | null;
        return ctx?.strategy === strategy && ctx?.jobType === jobType;
      });
    } catch (err: any) {
      logger.warn(
        `[RescueTracker] Failed deduplication check (proceeding with creation): ${err.message}`
      );
      return false;
    }
  },
};
