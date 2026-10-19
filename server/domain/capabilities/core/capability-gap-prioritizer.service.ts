/**
 * Synthetic Gap Prioritization Engine — SUPERSEDED.
 *
 * Ranks capability proposals on evidence count, confidence, and vector
 * similarity to existing capabilities.
 *
 * @deprecated Replaced by
 * `server/domain/improvement/core/capability-gap-prioritizer-v2.service.ts`,
 * which scores from `capability_gap_events` instead of from
 * `capability_proposals.evidence`. The two are NOT interchangeable and their
 * scores are not comparable: this one is unbounded and counts evidence entries,
 * v2 clamps to 0-100 and counts DISTINCT affected runs. Existing proposals
 * cannot be rescored under v2 — their evidence rows carry no run identifier —
 * they can only be re-derived from new events.
 *
 * Not deleted yet only because its sole caller, `capability-rfc.routes.ts`, is
 * itself unmounted (referenced nowhere under `server/`) and its fate is an open
 * decision. Delete both together; do not wire this into the improvement loop.
 */

import { createLogger } from "@server/utils/logger.js";
import type { CapabilityProposal, CapabilitySimilarityStatus } from "@shared/schema/capabilities/index.js";

const logger = createLogger("CapabilityGapPrioritizer");

export interface PrioritizedProposal {
  proposalId: number;
  proposalKey: string;
  proposedCapabilityId: string;
  title: string;
  /**
   * `null` when a required input was unavailable. A withheld score is NOT a
   * zero and must not be substituted with a default — see `scoreWithheld`.
   */
  priorityScore: number | null;
  failureRateWeight: number;
  confidenceWeight: number;
  /** Whether the duplicate check behind this ranking actually ran. */
  similarityStatus: CapabilitySimilarityStatus;
  /** True when `priorityScore` could not be computed from complete inputs. */
  scoreWithheld: boolean;
  withheldReason?: string;
  recommendation:
    | "high_priority_rfc"
    | "medium_priority"
    | "low_priority"
    | "duplicate_risk"
    | "similarity_unavailable";
}

export class CapabilityGapPrioritizerService {
  /**
   * Calculates synthetic priority score and ranks a list of capability proposals
   */
  /**
   * Ranks capability proposals.
   *
   * There was a third scoring component here, `developerVotesWeight`, computed
   * from a `developerVotesMap` parameter that defaulted to `{}`. Both production
   * callers omitted the argument and no vote store exists anywhere in the
   * platform, so the term was always exactly 0 while the UI presented it as a
   * scoring input. It is removed rather than left at zero: a displayed component
   * that cannot be non-zero misrepresents how the score was reached. Reinstate it
   * only alongside a real vote source.
   */
  prioritizeProposals(proposals: CapabilityProposal[]): PrioritizedProposal[] {
    logger.info(`[CapabilityGapPrioritizer] Ranking ${proposals.length} capability proposals...`);

    const results: PrioritizedProposal[] = proposals.map((p) => {
      const failureCount = (p.evidence || []).length;

      const confidenceWeight = p.confidence * 0.4;
      const failureRateWeight = failureCount * 12;

      const similarityStatus: CapabilitySimilarityStatus =
        p.similarityStatus === "available" ? "available" : "unavailable";

      const base = {
        proposalId: p.id,
        proposalKey: p.proposalKey,
        proposedCapabilityId: p.proposedCapabilityId,
        title: p.title,
        failureRateWeight,
        confidenceWeight,
        similarityStatus,
      };

      // The duplicate penalty is an INPUT to the score, not a garnish. When the
      // similarity search never ran, `similarCapabilities` is empty for reasons
      // unrelated to duplication, and scoring it as "no duplicates" ranks a
      // duplicate proposal highest exactly when deduplication is broken.
      // Withhold the score instead; the candidate is held, not promoted.
      if (similarityStatus === "unavailable") {
        return {
          ...base,
          priorityScore: null,
          scoreWithheld: true,
          withheldReason:
            "Duplicate detection did not run for this proposal, so a priority score cannot be computed. Re-run discovery once the embedding provider is reachable.",
          recommendation: "similarity_unavailable" as const,
        };
      }

      let priorityScore = Math.round((confidenceWeight + failureRateWeight) * 10) / 10;

      let recommendation: PrioritizedProposal["recommendation"] = "medium_priority";
      if (priorityScore >= 60) {
        recommendation = "high_priority_rfc";
      } else if (priorityScore <= 25) {
        recommendation = "low_priority";
      }

      if ((p.similarCapabilities || []).some((s: any) => s.score > 0.85)) {
        recommendation = "duplicate_risk";
        priorityScore = Math.round(priorityScore * 0.5); // Penalty for potential duplicate tool
      }

      return {
        ...base,
        priorityScore,
        scoreWithheld: false,
        recommendation,
      };
    });

    // Withheld candidates sort last: they are unranked, not low-ranked.
    results.sort((a, b) => {
      if (a.priorityScore === null && b.priorityScore === null) return 0;
      if (a.priorityScore === null) return 1;
      if (b.priorityScore === null) return -1;
      return b.priorityScore - a.priorityScore;
    });

    logger.info(`[CapabilityGapPrioritizer] Prioritization complete. Top recommendation: '${results[0]?.title}' (Score: ${results[0]?.priorityScore})`);

    return results;
  }
}

export const capabilityGapPrioritizerService = new CapabilityGapPrioritizerService();
