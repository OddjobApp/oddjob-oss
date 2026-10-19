/**
 * Collection Executor Service
 *
 * Executes Source Collectors from a GatheringStrategy with configurable
 * concurrency, per-collector timeout handling, and progress event emission.
 * Individual collector failures do not block other collectors from executing.
 *
 * @module ingestion/collection-executor
 */

import { createLogger } from "@server/utils/logger.js";
import { getCollector } from "./collectors/collector-registry.js";
import type { CollectedContent, CollectorResult } from "./collectors/collector.interface.js";
import type { CollectingPayload } from "./progress.types.js";
import type { CollectorInvocation, GatheringStrategy } from "./types.js";

const logger = createLogger("CollectionExecutor");

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Default number of parallel collectors */
const DEFAULT_CONCURRENCY = 3;

// ─── Public Interfaces ─────────────────────────────────────────────────────────

/** Options for configuring collection execution */
export interface CollectionExecutorOptions {
  /** Maximum number of collectors to run in parallel. Default: 3 */
  concurrency?: number;
  /** Callback invoked for each collector lifecycle event */
  onProgress?: (event: CollectingPayload) => void;
}

/** Aggregated result from executing all collectors in a strategy */
export interface CollectionExecutorResult {
  /** Per-collector results with timing and status */
  results: CollectorResult[];
  /** All successfully collected content across all collectors */
  allContent: CollectedContent[];
}

// ─── Service ───────────────────────────────────────────────────────────────────

export const collectionExecutorService = {
  /**
   * Execute all collector invocations from a gathering strategy.
   *
   * Runs collectors with a configurable concurrency limit (default: 3 parallel).
   * Each collector respects its own timeout. If one collector fails or times out,
   * the remaining collectors continue unaffected. Progress events are emitted
   * for each collector start, completion, and failure.
   *
   * @param strategy - The gathering strategy containing collector invocations
   * @param options - Concurrency and progress callback configuration
   * @returns Aggregated results and all collected content
   */
  async execute(
    strategy: GatheringStrategy,
    options?: CollectionExecutorOptions
  ): Promise<CollectionExecutorResult> {
    const concurrency = options?.concurrency ?? DEFAULT_CONCURRENCY;
    const onProgress = options?.onProgress;
    const totalSources = strategy.collectors.length;

    logger.info("Starting collection execution", {
      strategyId: strategy.id,
      totalCollectors: totalSources,
      concurrency,
    });

    const results: CollectorResult[] = [];
    const allContent: CollectedContent[] = [];
    let sourcesCollected = 0;

    // Process collectors in batches using a concurrency pool
    const pending = [...strategy.collectors].sort(
      (a, b) => a.priority - b.priority
    );

    await runPool(pending, concurrency, async (invocation) => {
      // Emit "started" progress event
      onProgress?.({
        stage: "collecting",
        collectorType: invocation.collectorType,
        sourceUrl: invocation.metadata?.url as string | undefined,
        query: invocation.query,
        status: "started",
        sourcesCollected,
        totalSources,
      });

      const result = await executeCollector(invocation);
      results.push(result);

      if (result.status === "completed" && result.content) {
        sourcesCollected++;
        allContent.push(...result.content);

        // Emit "completed" progress event
        onProgress?.({
          stage: "collecting",
          collectorType: invocation.collectorType,
          sourceUrl: invocation.metadata?.url as string | undefined,
          query: invocation.query,
          status: "completed",
          contentSize: result.contentSize,
          sourcesCollected,
          totalSources,
        });
      } else {
        // Emit "failed" progress event
        onProgress?.({
          stage: "collecting",
          collectorType: invocation.collectorType,
          sourceUrl: invocation.metadata?.url as string | undefined,
          query: invocation.query,
          status: "failed",
          contentSize: 0,
          sourcesCollected,
          totalSources,
        });
      }
    });

    logger.info("Collection execution completed", {
      strategyId: strategy.id,
      totalResults: results.length,
      successful: results.filter((r) => r.status === "completed").length,
      failed: results.filter((r) => r.status === "failed").length,
      timedOut: results.filter((r) => r.status === "timeout").length,
      totalContentItems: allContent.length,
    });

    return { results, allContent };
  },
};

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Execute a single collector invocation with its own timeout.
 * Returns a CollectorResult regardless of success or failure.
 */
async function executeCollector(
  invocation: CollectorInvocation
): Promise<CollectorResult> {
  const startTime = new Date().toISOString();

  try {
    const collector = getCollector(invocation.collectorType);

    // Race the collector against its configured timeout
    const result = await withTimeout(
      collector.collect(invocation),
      invocation.timeout
    );

    logger.debug("Collector completed", {
      collectorId: invocation.id,
      type: invocation.collectorType,
      status: result.status,
      contentSize: result.contentSize,
    });

    return result;
  } catch (error: unknown) {
    const endTime = new Date().toISOString();
    const isTimeout =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.message.includes("timed out"));

    const status = isTimeout ? "timeout" : "failed";
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    logger.warn("Collector failed", {
      collectorId: invocation.id,
      type: invocation.collectorType,
      status,
      error: errorMessage,
    });

    return {
      collectorId: invocation.id,
      status,
      startTime,
      endTime,
      error: errorMessage,
      contentSize: 0,
    };
  }
}

/**
 * Run async tasks with a concurrency limit using a pool pattern.
 * Processes items from the queue, maintaining at most `limit` tasks in flight.
 */
async function runPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const active: Promise<void>[] = [];

  while (queue.length > 0 || active.length > 0) {
    // Fill up to concurrency limit
    while (active.length < limit && queue.length > 0) {
      const item = queue.shift()!;
      const task = fn(item).then(() => {
        active.splice(active.indexOf(task), 1);
      });
      active.push(task);
    }

    // Wait for at least one task to finish before continuing
    if (active.length > 0) {
      await Promise.race(active);
    }
  }
}

/**
 * Race a promise against a timeout. Rejects with a TimeoutError
 * if the promise does not resolve within the given milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(Object.assign(new Error(`Collector timed out after ${ms}ms`), { name: "TimeoutError" }));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}
