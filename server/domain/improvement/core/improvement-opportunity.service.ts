/**
 * Persistence for the improvement evidence spine.
 *
 * This is where the pure modules become enforcement. `improvement-lifecycle`
 * and `observation-facts` are only worth having if every write goes through
 * them, so the rules live in one place and there is no path around them:
 *
 * - a status change is checked against the transition table AND the actor's
 *   authority before it touches the row;
 * - observation facts are validated before insert, not after;
 * - every read and write is organization-scoped, and a null organization is
 *   refused rather than silently widened.
 */

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@server/database_service.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import {
    improvementHypotheses,
    improvementObservations,
    improvementOpportunities,
    type ImprovementActorType,
    type ImprovementHypothesis,
    type ImprovementKind,
    type ImprovementObservation,
    type ImprovementObservationSource,
    type ImprovementOpportunity,
    type ImprovementStatus,
} from "@shared/schema/improvement/index.js";

import {
    assertTransitionAllowed,
    type ImprovementActor,
} from "./improvement-lifecycle.js";
import {
    assertObservationFacts,
    computeObservationContentHash,
} from "./observation-facts.js";

const logger = createLogger("ImprovementOpportunityService");

function requireOrg(organizationId: number): number {
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
        throw new BadRequestError(
            "An improvement record requires a resolved organization; refusing to read or write without one.",
        );
    }
    return organizationId;
}

export interface CreateOpportunityInput {
    kind: ImprovementKind;
    title: string;
    projectId?: number | null;
    sourceWindowStart?: Date | null;
    sourceWindowEnd?: Date | null;
    createdByType: ImprovementActorType;
    createdById: string;
    confidence?: number;
    assumptions?: string[];
    limitations?: string[];
}

export interface AddObservationInput {
    sourceType: ImprovementObservationSource;
    sourceId: string;
    observedAt: Date | string;
    facts: Record<string, unknown>;
    provenance?: Record<string, unknown>;
}

export interface AddHypothesisInput {
    statement: string;
    mechanism?: string | null;
    supportingObservationIds?: number[];
    contradictingObservationIds?: number[];
    alternatives?: string[];
    unknowns?: string[];
    authorType: ImprovementActorType;
    authorId: string;
}

export class ImprovementOpportunityService {
    async create(
        organizationId: number,
        input: CreateOpportunityInput,
    ): Promise<ImprovementOpportunity> {
        requireOrg(organizationId);
        if (!input.title?.trim()) throw new BadRequestError("title is required");
        const confidence = input.confidence ?? 0;
        if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) {
            throw new BadRequestError("confidence must be an integer from 0 to 100");
        }

        const [row] = await db
            .insert(improvementOpportunities)
            .values({
                organizationId,
                projectId: input.projectId ?? null,
                kind: input.kind,
                title: input.title.trim(),
                // Always starts at `observed`. A caller cannot open a record
                // directly into `approved` and skip the transitions that gate it.
                status: "observed",
                sourceWindowStart: input.sourceWindowStart ?? null,
                sourceWindowEnd: input.sourceWindowEnd ?? null,
                createdByType: input.createdByType,
                createdById: input.createdById,
                confidence,
                assumptions: input.assumptions ?? [],
                limitations: input.limitations ?? [],
                updatedAt: new Date(),
            })
            .returning();
        return row;
    }

    async get(organizationId: number, id: number): Promise<ImprovementOpportunity> {
        requireOrg(organizationId);
        const [row] = await db
            .select()
            .from(improvementOpportunities)
            .where(and(
                eq(improvementOpportunities.id, id),
                eq(improvementOpportunities.organizationId, organizationId),
            ));
        if (!row) throw new NotFoundError(`Improvement opportunity ${id} not found`);
        return row;
    }

    async list(
        organizationId: number,
        filters: { status?: ImprovementStatus; kind?: ImprovementKind } = {},
    ): Promise<ImprovementOpportunity[]> {
        requireOrg(organizationId);
        const conditions = [eq(improvementOpportunities.organizationId, organizationId)];
        if (filters.status) conditions.push(eq(improvementOpportunities.status, filters.status));
        if (filters.kind) conditions.push(eq(improvementOpportunities.kind, filters.kind));

        return db
            .select()
            .from(improvementOpportunities)
            .where(and(...conditions))
            .orderBy(desc(improvementOpportunities.updatedAt));
    }

    /**
     * Move an opportunity to a new state.
     *
     * The transition is validated against the current PERSISTED status, not a
     * status the caller supplies — otherwise a stale client could name a `from`
     * that makes an illegal move look legal.
     */
    async transition(
        organizationId: number,
        id: number,
        to: ImprovementStatus,
        actor: ImprovementActor,
    ): Promise<ImprovementOpportunity> {
        const current = await this.get(organizationId, id);

        assertTransitionAllowed({ from: current.status, to, actor });

        const [row] = await db
            .update(improvementOpportunities)
            .set({ status: to, updatedAt: new Date() })
            .where(and(
                eq(improvementOpportunities.id, id),
                eq(improvementOpportunities.organizationId, organizationId),
                // Optimistic guard: if the status moved since we read it, this
                // matches nothing rather than overwriting someone else's change.
                eq(improvementOpportunities.status, current.status),
            ))
            .returning();

        if (!row) {
            throw new BadRequestError(
                `Opportunity ${id} changed while this transition was being applied; re-read and retry.`,
            );
        }

        logger.info(
            `[Improvement] Opportunity ${id} ${current.status} -> ${to} by ${actor.type}:${actor.id}`,
        );
        return row;
    }

    /**
     * Record an immutable observation.
     *
     * Facts are validated before insert, and identity is a content hash, so
     * re-ingesting the same source event returns the existing row instead of
     * inflating the counts every measurement divides by.
     */
    async addObservation(
        organizationId: number,
        opportunityId: number,
        input: AddObservationInput,
    ): Promise<{ observation: ImprovementObservation; deduplicated: boolean }> {
        await this.get(organizationId, opportunityId);

        if (!input.sourceId?.trim()) throw new BadRequestError("sourceId is required");
        assertObservationFacts(input.facts ?? {});

        const observedAt =
            input.observedAt instanceof Date ? input.observedAt : new Date(input.observedAt);
        if (Number.isNaN(observedAt.getTime())) {
            throw new BadRequestError("observedAt must be a valid date");
        }

        const contentHash = computeObservationContentHash({
            sourceType: input.sourceType,
            sourceId: input.sourceId,
            observedAt,
            facts: input.facts ?? {},
        });

        const [existing] = await db
            .select()
            .from(improvementObservations)
            .where(and(
                eq(improvementObservations.opportunityId, opportunityId),
                eq(improvementObservations.contentHash, contentHash),
            ));
        if (existing) return { observation: existing, deduplicated: true };

        const [row] = await db
            .insert(improvementObservations)
            .values({
                organizationId,
                opportunityId,
                sourceType: input.sourceType,
                sourceId: input.sourceId.trim(),
                observedAt,
                facts: input.facts ?? {},
                contentHash,
                provenance: input.provenance ?? {},
            })
            .returning();
        return { observation: row, deduplicated: false };
    }

    async listObservations(
        organizationId: number,
        opportunityId: number,
    ): Promise<ImprovementObservation[]> {
        await this.get(organizationId, opportunityId);
        return db
            .select()
            .from(improvementObservations)
            .where(and(
                eq(improvementObservations.opportunityId, opportunityId),
                eq(improvementObservations.organizationId, organizationId),
            ))
            .orderBy(improvementObservations.observedAt);
    }

    /**
     * Record a hypothesis.
     *
     * Every cited observation must belong to this opportunity and this
     * organization — a hypothesis supported by another tenant's evidence is the
     * failure the whole provenance chain exists to prevent.
     */
    async addHypothesis(
        organizationId: number,
        opportunityId: number,
        input: AddHypothesisInput,
    ): Promise<ImprovementHypothesis> {
        await this.get(organizationId, opportunityId);
        if (!input.statement?.trim()) throw new BadRequestError("statement is required");

        const cited = [
            ...(input.supportingObservationIds ?? []),
            ...(input.contradictingObservationIds ?? []),
        ];
        if (cited.length > 0) {
            const found = await db
                .select({ id: improvementObservations.id })
                .from(improvementObservations)
                .where(and(
                    inArray(improvementObservations.id, cited),
                    eq(improvementObservations.opportunityId, opportunityId),
                    eq(improvementObservations.organizationId, organizationId),
                ));
            const foundIds = new Set(found.map(f => f.id));
            const stray = cited.filter(id => !foundIds.has(id));
            if (stray.length > 0) {
                throw new BadRequestError(
                    `Observation(s) ${stray.join(", ")} do not belong to opportunity ${opportunityId}; a hypothesis may only cite its own evidence.`,
                );
            }
        }

        const [row] = await db
            .insert(improvementHypotheses)
            .values({
                organizationId,
                opportunityId,
                statement: input.statement.trim(),
                mechanism: input.mechanism ?? null,
                supportingObservationIds: input.supportingObservationIds ?? [],
                contradictingObservationIds: input.contradictingObservationIds ?? [],
                alternatives: input.alternatives ?? [],
                unknowns: input.unknowns ?? [],
                authorType: input.authorType,
                authorId: input.authorId,
            })
            .returning();
        return row;
    }

    async listHypotheses(
        organizationId: number,
        opportunityId: number,
    ): Promise<ImprovementHypothesis[]> {
        await this.get(organizationId, opportunityId);
        return db
            .select()
            .from(improvementHypotheses)
            .where(and(
                eq(improvementHypotheses.opportunityId, opportunityId),
                eq(improvementHypotheses.organizationId, organizationId),
            ))
            .orderBy(desc(improvementHypotheses.createdAt));
    }
}

export const improvementOpportunityService = new ImprovementOpportunityService();
