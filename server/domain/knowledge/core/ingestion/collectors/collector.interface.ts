/**
 * Source Collector Interface and Result Types
 *
 * Defines the contract for pluggable source collector modules and the
 * standardized result format produced by each collection attempt.
 */

import type { CollectorInvocation, SourceCollectorType } from "../types.js";

// ─── Collected Content ─────────────────────────────────────────────────────────

/** A single piece of content retrieved by a source collector */
export interface CollectedContent {
  /** URL of the source document */
  url: string;
  /** Title of the source document */
  title: string;
  /** Extracted text content */
  content: string;
  /** MIME type of the original content */
  contentType: string;
  /** Which collector type produced this content */
  sourceType: SourceCollectorType;
  /** Raw content size in bytes */
  contentSize: number;
  /** Source-specific metadata */
  metadata: Record<string, unknown>;
  /** Pre-computed embedding for deduplication (optional) */
  embedding?: number[];
}

// ─── Collector Result ──────────────────────────────────────────────────────────

/** Standardized result from a single collector invocation */
export interface CollectorResult {
  /** Matches the CollectorInvocation.id that triggered this collection */
  collectorId: string;
  /** Outcome status of the collection attempt */
  status: "completed" | "failed" | "timeout";
  /** ISO 8601 timestamp when collection started */
  startTime: string;
  /** ISO 8601 timestamp when collection ended */
  endTime: string;
  /** Array of content items retrieved (present on success) */
  content?: CollectedContent[];
  /** Error message (present on failure or timeout) */
  error?: string;
  /** Total content size in bytes across all collected items */
  contentSize: number;
}

// ─── Source Collector Interface ─────────────────────────────────────────────────

/** Contract for pluggable source collector modules */
export interface SourceCollector {
  /** The collector type this module handles */
  type: SourceCollectorType;
  /** Execute a collection invocation and return results */
  collect(invocation: CollectorInvocation): Promise<CollectorResult>;
}
