/**
 * End-to-end capability-gap analysis: events → signatures → scores.
 *
 * The one piece of real integration here is the duplicate check. Each candidate
 * signature is put to the capability registry through `discoverWithStatus`,
 * whose three-state answer feeds straight into v2's withhold rule: `available`
 * means the similarity figure is authoritative, `unavailable` means the search
 * did not run and the score must not be computed as though nothing matched.
 *
 * That is the F9 chain, closed. The registry reports degradation instead of
 * returning an empty array, and the scorer refuses instead of awarding a clean
 * result.
 */

import { and, desc, eq, gte, lte } from "drizzle-orm";

import { db } from "@server/database_service.js";
import { BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { capabilityGapEvents, type CapabilityGapEvent } from "@shared/schema/capabilities/index.js";
import { capabilityRegistry } from "@domain/capabilities/core/capability-registry.service.js";

import {
    normalizeCapabilityGaps,
    type AggregatedGap,
    type NormalizationReport,
} from "./capability-gap-normalizer.service.js";
import {
    prioritizeGap,
    type HumanInput,
    type PrioritizedGap,
    type SimilarityInput,
} from "./capability-gap-prioritizer-v2.service.js";

const logger = createLogger("CapabilityGapAnalysis");

/** How many candidates get a similarity lookup per request. */
const DEFAULT_SIMILARITY_BUDGET = 25;

export interface GapAnalysisWindow {
    from?: Date;
    to?: Date;
}

export interface GapAnalysisReport {
    organizationId: number;
    /** Scored `missing` candidates, best first, withheld last. */
    capabilityGaps: PrioritizedGap[];
    /**
     * `unavailable` gaps — a real tool outside the run's allotment. Reported
     * unscored: these are access questions, and scoring them for capability
     * invention would propose building tools that already exist.
     */
    allotmentGaps: AggregatedGap[];
    otherGaps: AggregatedGap[];
    dataQuality: {
        totalEvents: number;
        eventsWithoutRunIdentity: number;
        eventsWithoutActor: number;
        signaturesWithUnparsedNames: number;
        /** Candidates that exceeded the similarity budget and were left unscored. */
        similarityBudgetExceeded: number;
    };
}

export class CapabilityGapAnalysisService {
    async loadEvents(
        organizationId: number,
        window: GapAnalysisWindow = {},
    ): Promise<CapabilityGapEvent[]> {
        if (!Number.isInteger(organizationId) || organizationId <= 0) {
            throw new BadRequestError("Capability-gap analysis requires a resolved organization.");
        }

        const conditions = [eq(capabilityGapEvents.organizationId, organizationId)];
        if (window.from) conditions.push(gte(capabilityGapEvents.occurredAt, window.from));
        if (window.to) conditions.push(lte(capabilityGapEvents.occurredAt, window.to));

        return db
            .select()
            .from(capabilityGapEvents)
            .where(and(...conditions))
            .orderBy(desc(capabilityGapEvents.occurredAt));
    }

    /**
     * Ask the registry whether anything similar already exists.
     *
     * Returns `unavailable` on any failure — a thrown search is exactly as
     * uninformative as a degraded one, and both must reach the scorer as
     * "unknown" rather than as "nothing found".
     */
    async checkSimilarity(organizationId: number, gap: AggregatedGap): Promise<SimilarityInput> {
        const query = [
            gap.signature.requiredVerb,
            gap.signature.requiredObject,
            gap.signature.targetSystem,
        ]
            .filter(Boolean)
            .join(" ");

        try {
            const outcome = await capabilityRegistry.discoverWithStatus(organizationId, query, 5);
            if (outcome.status === "unavailable") return { status: "unavailable" };
            return {
                status: "available",
                maxScore: outcome.results.reduce((max, r) => Math.max(max, r.score), 0),
            };
        } catch (error) {
            logger.warn(
                `Similarity check failed for '${query}' (org ${organizationId}): ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return { status: "unavailable" };
        }
    }

    /**
     * Produce the full report.
     *
     * `humanInputs` carries the judgements the score cannot compute — the named
     * strategic score and the risk review — keyed by signature. Anything absent
     * leaves its component `unavailable` (or, for risk, conservatively applied).
     */
    async analyze(
        organizationId: number,
        window: GapAnalysisWindow = {},
        humanInputs: Record<string, HumanInput> = {},
        similarityBudget: number = DEFAULT_SIMILARITY_BUDGET,
    ): Promise<GapAnalysisReport> {
        const events = await this.loadEvents(organizationId, window);
        const normalized: NormalizationReport = normalizeCapabilityGaps(events);

        let budgetExceeded = 0;
        const scored: PrioritizedGap[] = [];

        for (const [index, gap] of normalized.capabilityGaps.entries()) {
            if (index >= similarityBudget) {
                // Over budget is not "no duplicate found". Hand the scorer an
                // unavailable similarity so it withholds rather than inventing
                // a clean result for a candidate nobody checked.
                budgetExceeded += 1;
                scored.push(prioritizeGap(gap, { status: "unavailable" }, humanInputs[gap.key]));
                continue;
            }
            const similarity = await this.checkSimilarity(organizationId, gap);
            scored.push(prioritizeGap(gap, similarity, humanInputs[gap.key]));
        }

        scored.sort((a, b) => {
            if (a.score === null && b.score === null) return 0;
            if (a.score === null) return 1;
            if (b.score === null) return -1;
            return b.score - a.score;
        });

        const allGaps = [
            ...normalized.capabilityGaps,
            ...normalized.allotmentGaps,
            ...normalized.otherGaps,
        ];

        return {
            organizationId,
            capabilityGaps: scored,
            allotmentGaps: normalized.allotmentGaps,
            otherGaps: normalized.otherGaps,
            dataQuality: {
                totalEvents: normalized.totalEvents,
                eventsWithoutRunIdentity: allGaps.reduce((n, g) => n + g.eventsWithoutRunIdentity, 0),
                eventsWithoutActor: allGaps.reduce((n, g) => n + g.eventsWithoutActor, 0),
                signaturesWithUnparsedNames: allGaps.filter(g => g.unparsedToolNames.length > 0).length,
                similarityBudgetExceeded: budgetExceeded,
            },
        };
    }
}

export const capabilityGapAnalysisService = new CapabilityGapAnalysisService();
