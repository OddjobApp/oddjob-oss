/**
 * Redis State Tracker Implementation
 * 
 * Implements StateTracker interface using Redis for distributed state tracking.
 * Used by Loopbane Protocols to track visit counts and payload hashes.
 */

import { getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";
import type { StateTracker } from "./state-tracker.js";

export const RedisKeys = {
    visitCount: (executionId: number, stepId: number) => `pipeline:exec:${executionId}:step:${stepId}:visits`,
    payloadHash: (executionId: number, stepId: number) => `pipeline:exec:${executionId}:step:${stepId}:hash`,
    executionPrefix: (executionId: number) => `pipeline:exec:${executionId}:*`,
};

const STATE_TTL = 24 * 60 * 60; // 24 hours in seconds

export class RedisStateTracker implements StateTracker {
  private client = getRedisClient();

  async incrementVisit(executionId: number, stepId: number): Promise<number> {
    try {
      const key = RedisKeys.visitCount(executionId, stepId);
      const count = await this.client.incr(key);
      
      // Set TTL on first increment (if key didn't exist, count will be 1)
      if (count === 1) {
        try {
          await this.client.expire(key, STATE_TTL);
        } catch (ttlError) {
          // If TTL setting fails but increment succeeded, log but return the actual count
          console.error(`[StateTracker] Error setting TTL for visit count key ${key}, but increment succeeded:`, ttlError);
          // Return the actual count, not 0, to ensure correct cycle detection
        }
      }
      
      return count;
    } catch (error) {
      console.error(`[StateTracker] Error incrementing visit count for execution ${executionId}, step ${stepId}:`, error);
      // Try to get the current count as fallback
      try {
        const key = RedisKeys.visitCount(executionId, stepId);
        const currentCount = await this.client.get(key);
        if (currentCount) {
          return parseInt(currentCount, 10);
        }
      } catch (fallbackError) {
        // If we can't get the count either, return 0 as last resort
      }
      // Return 0 only if we truly can't determine the count
      return 0;
    }
  }

  async getVisitCount(executionId: number, stepId: number): Promise<number> {
    try {
      const key = RedisKeys.visitCount(executionId, stepId);
      const count = await this.client.get(key);
      return count ? parseInt(count, 10) : 0;
    } catch (error) {
      console.error(`[StateTracker] Error getting visit count for execution ${executionId}, step ${stepId}:`, error);
      return 0;
    }
  }

  async setPayloadHash(executionId: number, stepId: number, hash: string): Promise<void> {
    try {
      const key = RedisKeys.payloadHash(executionId, stepId);
      await this.client.set(key, hash, 'EX', STATE_TTL);
    } catch (error) {
      console.error(`[StateTracker] Error setting payload hash for execution ${executionId}, step ${stepId}:`, error);
      // Don't throw - allow execution to continue
    }
  }

  async getPayloadHash(executionId: number, stepId: number): Promise<string | null> {
    try {
      const key = RedisKeys.payloadHash(executionId, stepId);
      return await this.client.get(key);
    } catch (error) {
      console.error(`[StateTracker] Error getting payload hash for execution ${executionId}, step ${stepId}:`, error);
      return null;
    }
  }

  async clearExecutionState(executionId: number): Promise<void> {
    try {
      const pattern = RedisKeys.executionPrefix(executionId);
      const stream = this.client.scanStream({
        match: pattern,
        count: 100
      });

      for await (const keys of stream) {
        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      }
    } catch (error) {
      console.error(`[StateTracker] Error clearing execution state for execution ${executionId}:`, error);
      // Don't throw - cleanup is best effort
    }
  }
}

// Export singleton instance
export const stateTracker = new RedisStateTracker();


