/**
 * Spatial Reranker
 *
 * Orders matched signals for operator attention. A plain sort by Master
 * Priority Score is not enough on a spatial feed for two reasons:
 *
 *  1. NO URGENCY. A vessel closing on an exclusion zone at 25 knots and one
 *     idling inside a harbour can carry the same MAUF score, but only one of
 *     them has a deadline. Time-to-breach belongs in the ordering.
 *
 *  2. NO DIVERSITY. One congested port emits hundreds of near-identical
 *     signals from the same few cells. Sorted purely by score they occupy the
 *     entire queue and genuinely separate incidents never surface. Collapsing
 *     co-located signals into a representative — and demoting the rest — is
 *     what keeps the queue readable.
 *
 * The reranker is deliberately explainable: every adjustment is reported so an
 * operator can see why a signal moved.
 */

import { cellToParent, getResolution, isValidCell } from "h3-js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SpatialReranker");

/** Minimum shape the reranker needs. Structural, so callers can pass richer rows. */
export interface RerankableSignal {
  ruleId: string;
  masterPriorityScore: number;
  spatialScore?: number;
  /** Cell the signal was observed in. */
  h3Index?: string | null;
  /** Distance to the monitored boundary, km. */
  distanceToBoundaryKm?: number | null;
  velocityKnots?: number | null;
  /** When the signal was observed. Defaults to now. */
  observedAt?: Date | string | null;
  [key: string]: unknown;
}

export interface RerankAdjustment {
  /** Points added or removed, on the 0-100 master-score scale. */
  delta: number;
  reason: string;
}

export interface RerankedSignal<T extends RerankableSignal> {
  signal: T;
  /** Final ordering score after all adjustments. */
  rerankScore: number;
  /** Score before adjustment, for comparison. */
  baseScore: number;
  /** Minutes until the projected boundary breach, when computable. */
  timeToBreachMinutes: number | null;
  /** Cluster this signal was assigned to (coarse H3 parent). */
  clusterId: string | null;
  /** True when this is the representative of its cluster. */
  isClusterLead: boolean;
  /** How many signals share this cluster. */
  clusterSize: number;
  adjustments: RerankAdjustment[];
}

export interface RerankOptions {
  /**
   * H3 resolution signals are clustered at. Coarser = more aggressive
   * de-duplication. Defaults to 5 (~250km², metropolitan scale).
   */
  clusterResolution?: number;
  /** Max signals surfaced per cluster before the rest are demoted. Default 1. */
  maxPerCluster?: number;
  /** Penalty applied to each non-lead signal in a cluster. Default 25 points. */
  duplicatePenalty?: number;
  /** Maximum urgency bonus for an imminent breach. Default 20 points. */
  maxUrgencyBonus?: number;
  /** Breach horizon considered urgent, in minutes. Default 60. */
  urgencyHorizonMinutes?: number;
  /** Half-life for recency decay, in minutes. Default 120. Set 0 to disable. */
  recencyHalfLifeMinutes?: number;
  /** Weight of the spatial score as a tiebreaker bonus, in points. Default 10. */
  spatialScoreBonus?: number;
}

const DEFAULTS: Required<RerankOptions> = {
  clusterResolution: 5,
  maxPerCluster: 1,
  duplicatePenalty: 25,
  maxUrgencyBonus: 20,
  urgencyHorizonMinutes: 60,
  recencyHalfLifeMinutes: 120,
  spatialScoreBonus: 10,
};

const KM_PER_KNOT_HOUR = 1.852;

export class SpatialRerankerService {
  /**
   * Reranks signals for operator attention.
   *
   * Returns every input signal — nothing is dropped. Duplicates are demoted
   * rather than removed, so an operator can still page down to them and the
   * caller keeps a complete audit trail.
   */
  public rerank<T extends RerankableSignal>(
    signals: T[],
    options: RerankOptions = {}
  ): RerankedSignal<T>[] {
    const opts = { ...DEFAULTS, ...options };
    if (!signals.length) return [];

    // 1. Score each signal independently: urgency, spatial weight, recency.
    const scored = signals.map((signal) => {
      const adjustments: RerankAdjustment[] = [];
      const baseScore = Number(signal.masterPriorityScore) || 0;
      let score = baseScore;

      const timeToBreachMinutes = this.timeToBreachMinutes(signal);
      if (timeToBreachMinutes !== null) {
        // Closer to the breach = larger bonus, decaying linearly to zero at
        // the horizon. An already-breached signal gets the full bonus.
        const ratio = Math.max(
          0,
          Math.min(1, 1 - timeToBreachMinutes / opts.urgencyHorizonMinutes)
        );
        const bonus = Number((opts.maxUrgencyBonus * ratio).toFixed(2));
        if (bonus > 0) {
          score += bonus;
          adjustments.push({
            delta: bonus,
            reason: `Projected boundary breach in ${timeToBreachMinutes.toFixed(1)} min`,
          });
        }
      }

      if (signal.spatialScore != null && Number.isFinite(signal.spatialScore)) {
        const bonus = Number((signal.spatialScore * opts.spatialScoreBonus).toFixed(2));
        if (bonus > 0) {
          score += bonus;
          adjustments.push({
            delta: bonus,
            reason: `Spatial condition score ${signal.spatialScore.toFixed(2)}`,
          });
        }
      }

      if (opts.recencyHalfLifeMinutes > 0) {
        const ageMinutes = this.ageMinutes(signal);
        if (ageMinutes > 0) {
          const retained = Math.pow(0.5, ageMinutes / opts.recencyHalfLifeMinutes);
          const penalty = Number((score * (1 - retained)).toFixed(2));
          if (penalty > 0.01) {
            score -= penalty;
            adjustments.push({
              delta: -penalty,
              reason: `Recency decay over ${ageMinutes.toFixed(0)} min`,
            });
          }
        }
      }

      return {
        signal,
        baseScore,
        score,
        timeToBreachMinutes,
        adjustments,
        clusterId: this.clusterOf(signal, opts.clusterResolution),
      };
    });

    // 2. Cluster co-located signals and demote all but the strongest few.
    const clusters = new Map<string, typeof scored>();
    for (const item of scored) {
      if (!item.clusterId) continue;
      const bucket = clusters.get(item.clusterId);
      if (bucket) bucket.push(item);
      else clusters.set(item.clusterId, [item]);
    }

    const leadIds = new Set<typeof scored[number]>();
    for (const [, bucket] of clusters) {
      // Rank within the cluster on the adjusted score, so the representative is
      // the most urgent member rather than an arbitrary one.
      bucket.sort((a, b) => b.score - a.score);
      bucket.slice(0, opts.maxPerCluster).forEach((item) => leadIds.add(item));
    }

    const results: RerankedSignal<T>[] = scored.map((item) => {
      const clusterSize = item.clusterId ? (clusters.get(item.clusterId)?.length ?? 1) : 1;
      // A signal with no cell cannot be de-duplicated; treat it as its own lead.
      const isClusterLead = item.clusterId === null || leadIds.has(item);

      let finalScore = item.score;
      const adjustments = [...item.adjustments];

      if (!isClusterLead) {
        finalScore -= opts.duplicatePenalty;
        adjustments.push({
          delta: -opts.duplicatePenalty,
          reason: `Duplicate of ${clusterSize - 1} co-located signal(s) in cluster ${item.clusterId}`,
        });
      }

      return {
        signal: item.signal,
        rerankScore: Number(Math.max(0, Math.min(100, finalScore)).toFixed(2)),
        baseScore: item.baseScore,
        timeToBreachMinutes: item.timeToBreachMinutes,
        clusterId: item.clusterId,
        isClusterLead,
        clusterSize,
        adjustments,
      };
    });

    results.sort((a, b) => {
      if (b.rerankScore !== a.rerankScore) return b.rerankScore - a.rerankScore;
      // Stable, meaningful tiebreak: the more imminent breach wins.
      const at = a.timeToBreachMinutes ?? Number.POSITIVE_INFINITY;
      const bt = b.timeToBreachMinutes ?? Number.POSITIVE_INFINITY;
      return at - bt;
    });

    logger.info(
      `[SpatialReranker] Reranked ${signals.length} signal(s) into ${clusters.size} spatial cluster(s).`
    );

    return results;
  }

  /**
   * Minutes until the signal's projected boundary breach.
   * Returns null when there is no distance or the entity is not closing.
   */
  private timeToBreachMinutes(signal: RerankableSignal): number | null {
    const distanceKm = signal.distanceToBoundaryKm;
    const knots = signal.velocityKnots;
    if (distanceKm == null || !Number.isFinite(distanceKm)) return null;
    if (distanceKm <= 0) return 0; // already breached
    if (knots == null || !Number.isFinite(knots) || knots <= 0) return null;

    const kmPerMinute = (knots * KM_PER_KNOT_HOUR) / 60;
    return Number((distanceKm / kmPerMinute).toFixed(2));
  }

  private ageMinutes(signal: RerankableSignal): number {
    if (!signal.observedAt) return 0;
    const t = new Date(signal.observedAt).getTime();
    if (!Number.isFinite(t)) return 0;
    return Math.max(0, (Date.now() - t) / 60000);
  }

  /** Coarse H3 parent used as the de-duplication bucket. */
  private clusterOf(signal: RerankableSignal, resolution: number): string | null {
    const cell = signal.h3Index;
    if (!cell || !isValidCell(cell)) return null;
    const res = getResolution(cell);
    if (res <= resolution) return cell;
    try {
      return cellToParent(cell, resolution);
    } catch {
      return cell;
    }
  }
}

export const spatialReranker = new SpatialRerankerService();
