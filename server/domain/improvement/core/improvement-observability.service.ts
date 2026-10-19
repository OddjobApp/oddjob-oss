/**
 * §15 observability for the improvement loop — including the trust metrics.
 *
 * The operational counts are ordinary. The trust metrics are the point, and
 * they are unusual enough to be worth stating plainly: they measure whether the
 * loop's own output is honest, not whether it is busy.
 *
 *   - What fraction of surfaced candidates actually cite evidence?
 *   - What fraction of hypotheses carry counter-evidence?
 *   - What fraction of results were judged against criteria fixed BEFORE the run?
 *   - How much telemetry is missing rather than negative?
 *
 * That last distinction is the one this platform keeps getting wrong. A metric
 * that reports "no problems found" when nothing was measured is how a dark
 * subsystem looks healthy for a year. Every ratio here therefore reports its
 * denominator, and a ratio over zero denominator is `null` — not 0, and not 1.
 */

import { and, eq, sql } from "drizzle-orm";

import { db } from "@server/database_service.js";
import { BadRequestError } from "@server/utils/errors.js";
import { capabilityGapEvents } from "@shared/schema/capabilities/index.js";
import {
    improvementExperiments,
    improvementHypotheses,
    improvementObservations,
    improvementOpportunities,
    improvementResults,
    workflowEvents,
} from "@shared/schema/improvement/index.js";

/**
 * A proportion that knows what it was computed over.
 *
 * `value` is null when `denominator` is 0. "No candidates lacked evidence" and
 * "there were no candidates" are different findings, and collapsing them is the
 * failure this whole loop exists to detect.
 */
export interface Ratio {
    value: number | null;
    numerator: number;
    denominator: number;
}

function ratio(numerator: number, denominator: number): Ratio {
    return {
        value: denominator === 0 ? null : Math.round((numerator / denominator) * 10000) / 10000,
        numerator,
        denominator,
    };
}

export interface ImprovementMetrics {
    organizationId: number;

    operational: {
        opportunitiesByStatus: Record<string, number>;
        opportunitiesByKind: Record<string, number>;
        observationCount: number;
        hypothesisCount: number;
        experimentsByStatus: Record<string, number>;
        resultsByOutcome: Record<string, number>;
        capabilityGapEventsByClass: Record<string, number>;
        workflowEventCount: number;
    };

    trust: {
        /** Opportunities citing at least one observation. */
        opportunitiesWithEvidence: Ratio;
        /** Hypotheses that record contradicting observations, not only supporting ones. */
        hypothesesWithCounterEvidence: Ratio;
        /** Opportunities that declare what was NOT observed. */
        opportunitiesDeclaringLimitations: Ratio;
        /** Gap events carrying run identity — the unit frequency scoring needs. */
        gapEventsWithRunIdentity: Ratio;
        /** Gap events carrying an actor — the unit user-impact scoring needs. */
        gapEventsWithActor: Ratio;
        /** Results whose experiment declared a minimum sample size before running. */
        resultsWithPreRegisteredThreshold: Ratio;
        /** Completed results that a human has actually dispositioned. */
        resultsWithHumanDisposition: Ratio;
        /**
         * Results that could not be judged because the machinery failed or was
         * stopped — as opposed to the hypothesis being wrong. A rising number
         * here means the pipeline is unreliable, not that the ideas are bad.
         */
        resultsInconclusiveFromMachinery: Ratio;
    };

    /**
     * Signals that something is built but not running. Each is a fact, not a
     * judgement — but each is the shape of failure this codebase repeats.
     */
    darkSubsystemSignals: string[];
}

async function countBy(
    table: any,
    column: any,
    organizationId: number,
): Promise<Record<string, number>> {
    const rows = await db
        .select({ key: column, n: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(table.organizationId, organizationId))
        .groupBy(column);
    return Object.fromEntries(rows.map(r => [String(r.key ?? "unknown"), r.n]));
}

async function countWhere(table: any, condition: any): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table).where(condition);
    return row?.n ?? 0;
}

export class ImprovementObservabilityService {
    async metrics(organizationId: number): Promise<ImprovementMetrics> {
        if (!Number.isInteger(organizationId) || organizationId <= 0) {
            throw new BadRequestError("Improvement metrics require a resolved organization.");
        }
        const org = (t: any) => eq(t.organizationId, organizationId);

        const [
            opportunitiesByStatus,
            opportunitiesByKind,
            experimentsByStatus,
            resultsByOutcome,
            capabilityGapEventsByClass,
        ] = await Promise.all([
            countBy(improvementOpportunities, improvementOpportunities.status, organizationId),
            countBy(improvementOpportunities, improvementOpportunities.kind, organizationId),
            countBy(improvementExperiments, improvementExperiments.status, organizationId),
            countBy(improvementResults, improvementResults.criterionOutcome, organizationId),
            countBy(capabilityGapEvents, capabilityGapEvents.failureClass, organizationId),
        ]);

        const [
            opportunityCount,
            observationCount,
            hypothesisCount,
            workflowEventCount,
            resultCount,
        ] = await Promise.all([
            countWhere(improvementOpportunities, org(improvementOpportunities)),
            countWhere(improvementObservations, org(improvementObservations)),
            countWhere(improvementHypotheses, org(improvementHypotheses)),
            countWhere(workflowEvents, org(workflowEvents)),
            countWhere(improvementResults, org(improvementResults)),
        ]);

        // Opportunities that actually cite something.
        const evidencedRows = await db
            .selectDistinct({ id: improvementObservations.opportunityId })
            .from(improvementObservations)
            .where(org(improvementObservations));

        const counterEvidenced = await countWhere(
            improvementHypotheses,
            and(
                org(improvementHypotheses),
                sql`jsonb_array_length(${improvementHypotheses.contradictingObservationIds}) > 0`,
            ),
        );

        const withLimitations = await countWhere(
            improvementOpportunities,
            and(org(improvementOpportunities), sql`jsonb_array_length(${improvementOpportunities.limitations}) > 0`),
        );

        const gapEventCount = Object.values(capabilityGapEventsByClass).reduce((a, b) => a + b, 0);
        const gapWithRun = await countWhere(
            capabilityGapEvents,
            and(org(capabilityGapEvents), sql`${capabilityGapEvents.runRef} is not null`),
        );
        const gapWithActor = await countWhere(
            capabilityGapEvents,
            and(org(capabilityGapEvents), sql`${capabilityGapEvents.actorUserHash} is not null`),
        );

        const preRegistered = await countWhere(
            improvementExperiments,
            and(org(improvementExperiments), sql`${improvementExperiments.minimumSampleSize} > 0`),
        );
        const experimentCount = Object.values(experimentsByStatus).reduce((a, b) => a + b, 0);

        const dispositioned = await countWhere(
            improvementResults,
            and(org(improvementResults), sql`${improvementResults.disposition} is not null`),
        );

        const machineryInconclusive =
            (resultsByOutcome["inconclusive"] ?? 0) > 0
                ? await countWhere(
                      improvementResults,
                      and(
                          org(improvementResults),
                          sql`${improvementResults.classification} in ('execution_failure','policy_stop')`,
                      ),
                  )
                : 0;

        const trust = {
            opportunitiesWithEvidence: ratio(evidencedRows.length, opportunityCount),
            hypothesesWithCounterEvidence: ratio(counterEvidenced, hypothesisCount),
            opportunitiesDeclaringLimitations: ratio(withLimitations, opportunityCount),
            gapEventsWithRunIdentity: ratio(gapWithRun, gapEventCount),
            gapEventsWithActor: ratio(gapWithActor, gapEventCount),
            resultsWithPreRegisteredThreshold: ratio(preRegistered, experimentCount),
            resultsWithHumanDisposition: ratio(dispositioned, resultCount),
            resultsInconclusiveFromMachinery: ratio(machineryInconclusive, resultCount),
        };

        return {
            organizationId,
            operational: {
                opportunitiesByStatus,
                opportunitiesByKind,
                observationCount,
                hypothesisCount,
                experimentsByStatus,
                resultsByOutcome,
                capabilityGapEventsByClass,
                workflowEventCount,
            },
            trust,
            darkSubsystemSignals: detectDarkSubsystems({
                gapEventCount,
                opportunityCount,
                observationCount,
                workflowEventCount,
                experimentCount,
                trust,
            }),
        };
    }
}

export interface DarkSubsystemInput {
    gapEventCount: number;
    opportunityCount: number;
    observationCount: number;
    workflowEventCount: number;
    experimentCount: number;
    trust: ImprovementMetrics["trust"];
}

/**
 * Name the "built but not running" shapes explicitly.
 *
 * Each of these has actually happened on this platform: a table that stays
 * empty because nothing writes to it, an emitter wired but never reached, a
 * surface that renders because its chrome renders. Stating them as signals
 * makes the pattern a dashboard row instead of an archaeology project.
 */
export function detectDarkSubsystems(input: DarkSubsystemInput): string[] {
    const signals: string[] = [];

    if (input.gapEventCount === 0) {
        signals.push(
            "No capability-gap events recorded. Either no agent has hit a missing tool, or the emitter in tool-executor is not being reached — the two look identical from here.",
        );
    }
    if (input.opportunityCount > 0 && input.trust.opportunitiesWithEvidence.value === 0) {
        signals.push(
            "Opportunities exist but none cites an observation. Candidates are being raised without evidence.",
        );
    }
    if (input.observationCount === 0 && input.opportunityCount > 0) {
        signals.push("No observations recorded against any opportunity; the evidence table is dark.");
    }
    if (input.workflowEventCount === 0) {
        signals.push(
            "No workflow events imported. §8 measurement has no input until a workflow is connected or uploaded.",
        );
    }
    if (input.experimentCount === 0 && input.opportunityCount > 0) {
        signals.push("Opportunities exist but no experiment has ever been created.");
    }
    if (input.gapEventCount > 0 && input.trust.gapEventsWithRunIdentity.value === 0) {
        signals.push(
            "Gap events are arriving without run identity, so frequency scoring cannot count affected runs.",
        );
    }

    return signals;
}

export const improvementObservabilityService = new ImprovementObservabilityService();
