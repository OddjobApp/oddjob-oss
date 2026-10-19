/**
 * Failure Propagation Service
 *
 * Predicts which parts of the codebase are likely to break when a given file
 * breaks, by combining two independent signals:
 *
 *  1. STRUCTURAL — reverse-dependency reachability from the system graph,
 *     decayed by hop distance. Available for every file, always.
 *  2. EMPIRICAL — historical co-failure, from `failure_incidents.filePath`
 *     (which records where an error actually occurred). Available only where
 *     incidents have accumulated.
 *
 * The two are blended by evidence weight rather than fixed coefficients: with
 * no failure history the prediction is purely structural, and empirical
 * evidence gains influence only as observations accumulate. A fixed blend would
 * let a single coincidental co-failure outrank a genuine dependency edge.
 *
 * Empirical evidence can also surface pairs the graph cannot see at all —
 * files that repeatedly fail together without importing one another (shared
 * infrastructure, implicit protocol coupling). Those are reported with a zero
 * structural score, and are often the most interesting output.
 */

import { createLogger } from "@server/utils/logger.js";
import { SystemGraphService } from "./system-graph.service.js";

const logger = createLogger("FailurePropagationService");

/** One observed failure, located to a source file. */
export interface FailureObservation {
  filePath: string;
  occurredAt: Date;
}

export interface PropagationPrediction {
  filePath: string;
  /** 0..1 blended likelihood this file is affected when the source fails. */
  probability: number;
  /** Reachability component, before blending. */
  structuralScore: number;
  /** Observed co-failure rate, before blending. */
  historicalScore: number;
  /** Times this file failed inside a window around a source failure. */
  coFailureCount: number;
  /** Hop distance in the dependency graph; null when only co-failure links them. */
  distance: number | null;
  rationale: string;
}

export interface PropagationForecast {
  sourceFile: string;
  predictions: PropagationPrediction[];
  /** How much failure history backed this forecast. */
  basis: {
    sourceFailureCount: number;
    incidentsAnalyzed: number;
    /** Weight given to empirical evidence, 0..1. */
    empiricalWeight: number;
    structuralOnly: boolean;
  };
}

export interface PredictOptions {
  repoRoot?: string;
  maxDepth?: number;
  /** Two failures within this window are treated as co-occurring. */
  coFailureWindowMinutes?: number;
  lookbackDays?: number;
  organizationId?: number | null;
  limit?: number;
  /** Injectable failure source; defaults to querying failure_incidents. */
  loadFailures?: () => Promise<FailureObservation[]>;
}

/** Per-hop attenuation of structural influence. */
const DISTANCE_DECAY = 0.55;

/**
 * Shrinkage constant. Empirical weight is n/(n+k) where n is the number of
 * observed source failures, so k is the number of observations at which
 * history and structure carry equal weight.
 */
const EVIDENCE_SHRINKAGE_K = 5;

const DEFAULT_WINDOW_MINUTES = 30;
const DEFAULT_LOOKBACK_DAYS = 90;

export const failurePropagationService = {
  /**
   * Forecast propagation from a source file.
   *
   * Degrades rather than fails: if failure history is unavailable the forecast
   * is structural-only and says so via `basis.structuralOnly`.
   */
  async predictPropagation(
    sourceFile: string,
    options: PredictOptions = {},
  ): Promise<PropagationForecast> {
    const {
      repoRoot = process.cwd(),
      maxDepth = 3,
      coFailureWindowMinutes = DEFAULT_WINDOW_MINUTES,
      limit = 25,
    } = options;

    const normalizedSource = normalize(sourceFile);

    // ── Structural signal ────────────────────────────────────────────────
    const dependents = await SystemGraphService.getReverseDependents(normalizedSource, {
      repoRoot,
      maxDepth,
    });

    const structural = new Map<string, { score: number; distance: number }>();
    for (const [file, distance] of dependents) {
      structural.set(normalize(file), {
        score: Math.pow(DISTANCE_DECAY, distance),
        distance,
      });
    }

    // ── Empirical signal ─────────────────────────────────────────────────
    let failures: FailureObservation[] = [];
    try {
      failures = options.loadFailures
        ? await options.loadFailures()
        : await loadFailureIncidents(options);
    } catch (error: any) {
      logger.warn(`Failure history unavailable, forecasting structurally: ${error.message}`);
    }

    const sourceFailures = failures.filter(f => normalize(f.filePath) === normalizedSource);
    const windowMs = coFailureWindowMinutes * 60_000;

    const coFailureCounts = new Map<string, number>();
    for (const sourceEvent of sourceFailures) {
      // Count each other file at most once per source failure, so a burst of
      // retries in one file cannot inflate its apparent coupling.
      const seen = new Set<string>();
      for (const candidate of failures) {
        const file = normalize(candidate.filePath);
        if (file === normalizedSource || seen.has(file)) continue;
        const delta = Math.abs(candidate.occurredAt.getTime() - sourceEvent.occurredAt.getTime());
        if (delta <= windowMs) {
          seen.add(file);
          coFailureCounts.set(file, (coFailureCounts.get(file) ?? 0) + 1);
        }
      }
    }

    const n = sourceFailures.length;
    const empiricalWeight = n / (n + EVIDENCE_SHRINKAGE_K);

    // ── Blend ────────────────────────────────────────────────────────────
    const candidates = new Set<string>([...structural.keys(), ...coFailureCounts.keys()]);
    const predictions: PropagationPrediction[] = [];

    for (const file of candidates) {
      const struct = structural.get(file);
      const structuralScore = struct?.score ?? 0;
      const coFailureCount = coFailureCounts.get(file) ?? 0;
      const historicalScore = n > 0 ? coFailureCount / n : 0;

      const probability =
        structuralScore * (1 - empiricalWeight) + historicalScore * empiricalWeight;

      if (probability <= 0) continue;

      predictions.push({
        filePath: file,
        probability: round(probability),
        structuralScore: round(structuralScore),
        historicalScore: round(historicalScore),
        coFailureCount,
        distance: struct?.distance ?? null,
        rationale: buildRationale(struct?.distance ?? null, coFailureCount, n),
      });
    }

    predictions.sort((a, b) => b.probability - a.probability);

    return {
      sourceFile: normalizedSource,
      predictions: predictions.slice(0, limit),
      basis: {
        sourceFailureCount: n,
        incidentsAnalyzed: failures.length,
        empiricalWeight: round(empiricalWeight),
        structuralOnly: n === 0,
      },
    };
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

function buildRationale(distance: number | null, coFailures: number, sourceFailures: number): string {
  const parts: string[] = [];
  if (distance !== null) {
    parts.push(distance === 1 ? "imports the changed file directly" : `${distance} hops downstream`);
  } else {
    // No dependency edge at all — this pairing exists only in the failure record.
    parts.push("no dependency path; coupling observed only in failure history");
  }
  if (coFailures > 0) {
    parts.push(`failed alongside it in ${coFailures}/${sourceFailures} recorded failures`);
  } else {
    parts.push("no recorded co-failures");
  }
  return parts.join("; ");
}

/**
 * Default failure source: `failure_incidents`, which records the file an error
 * occurred in. Scoped by organization and lookback window.
 */
async function loadFailureIncidents(options: PredictOptions): Promise<FailureObservation[]> {
  const { db } = await import("@server/database_service.js");
  const { failureIncidents } = await import("@shared/schema/index.js");
  const { and, eq, gte, isNotNull } = await import("drizzle-orm");

  const lookbackDays = options.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
  const since = new Date(Date.now() - lookbackDays * 86_400_000);

  const filters = [isNotNull(failureIncidents.filePath), gte(failureIncidents.createdAt, since)];
  if (options.organizationId != null) {
    filters.push(eq(failureIncidents.organizationId, options.organizationId));
  }

  const rows = await db
    .select({ filePath: failureIncidents.filePath, createdAt: failureIncidents.createdAt })
    .from(failureIncidents)
    .where(and(...filters));

  return rows
    .filter(r => r.filePath)
    .map(r => ({ filePath: r.filePath as string, occurredAt: r.createdAt }));
}
