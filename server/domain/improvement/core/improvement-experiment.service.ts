/**
 * Experiment lifecycle: draft → approval → run → result → disposition.
 *
 * The rules that matter here are about *when* things become fixed:
 *
 * - pre-registration is checked when approval is REQUESTED, so criteria are
 *   settled before anyone can see how the run is going;
 * - approval requires an authorized human, recorded by name and time;
 * - **any edit after approval returns the experiment to draft**, because an
 *   approval attaches to the criteria that were approved, not to a row id;
 * - the verdict is computed from measurements and never accepted from a caller.
 */

import { and, desc, eq } from "drizzle-orm";

import { db } from "@server/database_service.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import {
    improvementExperiments,
    improvementResults,
    type ImprovementExperiment,
    type ImprovementResult,
    type InsertImprovementExperiment,
} from "@shared/schema/improvement/index.js";

import type { ImprovementActor } from "./improvement-lifecycle.js";
import {
    assertPreRegistered,
    criteriaFromExperiment,
    evaluateExperiment,
    validatePreRegistration,
    type MeasuredOutcome,
} from "./experiment-criteria.service.js";

const logger = createLogger("ImprovementExperimentService");

/** Fields whose change invalidates an approval. Everything the approver read. */
const APPROVAL_BINDING_FIELDS = [
    "baselineDefinition", "baselineWindowStart", "baselineWindowEnd",
    "intervention", "control", "inclusionCriteria", "exclusionCriteria",
    "startsAt", "endsAt", "boundaries", "primaryMetric", "primaryMetricDirection",
    "minimumEffect", "minimumSampleSize", "guardrails", "stopConditions",
    "rollbackPlan", "requiredApproverRole",
] as const;

function requireOrg(organizationId: number): number {
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
        throw new BadRequestError("An experiment requires a resolved organization.");
    }
    return organizationId;
}

export class ImprovementExperimentService {
    async create(
        organizationId: number,
        input: Omit<InsertImprovementExperiment, "organizationId" | "status">,
    ): Promise<ImprovementExperiment> {
        requireOrg(organizationId);
        const [row] = await db
            .insert(improvementExperiments)
            .values({ ...input, organizationId, status: "draft", updatedAt: new Date() })
            .returning();
        return row;
    }

    async get(organizationId: number, id: number): Promise<ImprovementExperiment> {
        requireOrg(organizationId);
        const [row] = await db
            .select()
            .from(improvementExperiments)
            .where(and(
                eq(improvementExperiments.id, id),
                eq(improvementExperiments.organizationId, organizationId),
            ));
        if (!row) throw new NotFoundError(`Experiment ${id} not found`);
        return row;
    }

    async listForOpportunity(
        organizationId: number,
        opportunityId: number,
    ): Promise<ImprovementExperiment[]> {
        requireOrg(organizationId);
        return db
            .select()
            .from(improvementExperiments)
            .where(and(
                eq(improvementExperiments.organizationId, organizationId),
                eq(improvementExperiments.opportunityId, opportunityId),
            ))
            .orderBy(desc(improvementExperiments.createdAt));
    }

    /**
     * Edit a draft.
     *
     * An approved experiment that is edited drops back to `draft` and loses its
     * approval. This is the same rule the spec applies to change sets: approval
     * binds to what was approved, so altering it afterwards must invalidate it
     * rather than silently carry consent forward onto different criteria.
     */
    async update(
        organizationId: number,
        id: number,
        patch: Partial<InsertImprovementExperiment>,
    ): Promise<ImprovementExperiment> {
        const current = await this.get(organizationId, id);
        if (current.status === "running" || current.status === "completed") {
            throw new BadRequestError(
                `Experiment ${id} is ${current.status}; its criteria are fixed for the duration of the run.`,
            );
        }

        const touchesBinding = APPROVAL_BINDING_FIELDS.some(f => f in patch);
        const invalidatesApproval = touchesBinding && current.status === "approved";

        const [row] = await db
            .update(improvementExperiments)
            .set({
                ...patch,
                ...(invalidatesApproval
                    ? { status: "draft" as const, approvedBy: null, approvedAt: null }
                    : {}),
                updatedAt: new Date(),
            })
            .where(and(
                eq(improvementExperiments.id, id),
                eq(improvementExperiments.organizationId, organizationId),
            ))
            .returning();

        if (invalidatesApproval) {
            logger.info(`[Improvement] Experiment ${id} edited after approval; approval invalidated.`);
        }
        return row;
    }

    /** Check pre-registration without changing anything. */
    async checkPreRegistration(organizationId: number, id: number) {
        return validatePreRegistration(await this.get(organizationId, id));
    }

    /** Move a fully pre-registered draft to `pending_approval`. */
    async requestApproval(organizationId: number, id: number): Promise<ImprovementExperiment> {
        const current = await this.get(organizationId, id);
        if (current.status !== "draft") {
            throw new BadRequestError(`Only a draft may request approval; experiment ${id} is ${current.status}.`);
        }
        // Throws with every missing field rather than the first.
        assertPreRegistered(current);

        const [row] = await db
            .update(improvementExperiments)
            .set({ status: "pending_approval", updatedAt: new Date() })
            .where(and(
                eq(improvementExperiments.id, id),
                eq(improvementExperiments.organizationId, organizationId),
                eq(improvementExperiments.status, "draft"),
            ))
            .returning();
        if (!row) throw new BadRequestError(`Experiment ${id} changed while requesting approval; re-read and retry.`);
        return row;
    }

    /**
     * Approve an experiment to run.
     *
     * Only an authorized human. Pre-registration is re-checked at approval time
     * so a row that became incomplete between request and approval cannot slip
     * through on the earlier check.
     */
    async approve(
        organizationId: number,
        id: number,
        actor: ImprovementActor,
    ): Promise<ImprovementExperiment> {
        const current = await this.get(organizationId, id);
        if (current.status !== "pending_approval") {
            throw new BadRequestError(
                `Experiment ${id} is ${current.status}; only a pending_approval experiment may be approved.`,
            );
        }
        if (actor.type !== "user") {
            throw new BadRequestError(
                `Approving an experiment is reserved to an authorized human; actor type was '${actor.type}'.`,
            );
        }
        if (actor.hasApprovalAuthority !== true) {
            throw new BadRequestError(
                `'${actor.id}' does not hold the authority required to approve experiment ${id}.`,
            );
        }
        assertPreRegistered(current);

        const [row] = await db
            .update(improvementExperiments)
            .set({
                status: "approved",
                approvedBy: actor.id,
                approvedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(and(
                eq(improvementExperiments.id, id),
                eq(improvementExperiments.organizationId, organizationId),
                eq(improvementExperiments.status, "pending_approval"),
            ))
            .returning();
        if (!row) throw new BadRequestError(`Experiment ${id} changed while approving; re-read and retry.`);

        logger.info(`[Improvement] Experiment ${id} approved by ${actor.id}`);
        return row;
    }

    /** Begin the run, binding it to the mission that executes it. */
    async launch(
        organizationId: number,
        id: number,
        missionId: number,
        shadowMissionId?: number,
    ): Promise<ImprovementExperiment> {
        const current = await this.get(organizationId, id);
        if (current.status !== "approved") {
            throw new BadRequestError(
                `Experiment ${id} is ${current.status}; only an approved experiment may launch.`,
            );
        }
        const [row] = await db
            .update(improvementExperiments)
            .set({
                status: "running",
                missionId,
                shadowMissionId: shadowMissionId ?? null,
                updatedAt: new Date(),
            })
            .where(and(
                eq(improvementExperiments.id, id),
                eq(improvementExperiments.organizationId, organizationId),
                eq(improvementExperiments.status, "approved"),
            ))
            .returning();
        if (!row) throw new BadRequestError(`Experiment ${id} changed while launching; re-read and retry.`);
        return row;
    }

    /**
     * Attach measurements and compute the verdict.
     *
     * The caller supplies measurements only. `criterionOutcome` and
     * `classification` are computed here against the criteria as they were
     * pre-registered — a caller cannot assert that its experiment passed.
     */
    async recordResult(
        organizationId: number,
        experimentId: number,
        measured: MeasuredOutcome,
        dataQuality: {
            missingRecordCount?: number;
            excludedRecordCount?: number;
            exclusionReasons?: Record<string, number>;
        } = {},
    ): Promise<ImprovementResult> {
        const experiment = await this.get(organizationId, experimentId);
        if (experiment.status !== "running" && experiment.status !== "stopped") {
            throw new BadRequestError(
                `Experiment ${experimentId} is ${experiment.status}; results attach to a run.`,
            );
        }

        const verdict = evaluateExperiment(criteriaFromExperiment(experiment), measured);

        const [row] = await db
            .insert(improvementResults)
            .values({
                organizationId,
                experimentId,
                baselineValue: measured.baselineValue,
                baselineSampleCount: measured.baselineSampleCount,
                interventionValue: measured.interventionValue,
                interventionSampleCount: measured.interventionSampleCount,
                missingRecordCount: dataQuality.missingRecordCount ?? 0,
                excludedRecordCount: dataQuality.excludedRecordCount ?? 0,
                exclusionReasons: dataQuality.exclusionReasons ?? {},
                executionFailureCount: measured.executionFailureCount,
                policyStopCount: measured.policyStopCount,
                guardrailResults: verdict.guardrailResults,
                criterionOutcome: verdict.outcome,
                classification: verdict.classification,
                verdictReasons: verdict.reasons,
            })
            .returning();

        await db
            .update(improvementExperiments)
            .set({ status: "completed", updatedAt: new Date() })
            .where(and(
                eq(improvementExperiments.id, experimentId),
                eq(improvementExperiments.organizationId, organizationId),
            ));

        logger.info(
            `[Improvement] Experiment ${experimentId} result: ${verdict.outcome} (${verdict.classification})`,
        );
        return row;
    }

    async getResults(organizationId: number, experimentId: number): Promise<ImprovementResult[]> {
        await this.get(organizationId, experimentId);
        return db
            .select()
            .from(improvementResults)
            .where(and(
                eq(improvementResults.experimentId, experimentId),
                eq(improvementResults.organizationId, organizationId),
            ))
            .orderBy(desc(improvementResults.computedAt));
    }

    /**
     * Record the human disposition.
     *
     * Separate from the verdict on purpose: a human may promote despite a
     * `failed` verdict or decline despite a `passed` one, and the record must
     * show both what was measured and what was decided.
     */
    async setDisposition(
        organizationId: number,
        resultId: number,
        actor: ImprovementActor,
        disposition: string,
        rationale: string,
    ): Promise<ImprovementResult> {
        requireOrg(organizationId);
        if (actor.type !== "user") {
            throw new BadRequestError(
                `A disposition is a human decision; actor type was '${actor.type}'.`,
            );
        }
        if (!disposition?.trim() || !rationale?.trim()) {
            throw new BadRequestError("A disposition requires both a decision and a rationale.");
        }

        const [row] = await db
            .update(improvementResults)
            .set({
                disposition: disposition.trim(),
                dispositionRationale: rationale.trim(),
                dispositionBy: actor.id,
                dispositionAt: new Date(),
            })
            .where(and(
                eq(improvementResults.id, resultId),
                eq(improvementResults.organizationId, organizationId),
            ))
            .returning();
        if (!row) throw new NotFoundError(`Result ${resultId} not found`);
        return row;
    }
}

export const improvementExperimentService = new ImprovementExperimentService();
