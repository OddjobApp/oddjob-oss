import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
  evoDevoEvaluations,
  evoDevoGenomes,
  evoDevoPhenotypes,
  evoDevoPopulationMembers,
  evoDevoPopulations,
  evoDevoStageEvents,
} from "@shared/schema/evo-devo.js";

/**
 * Read side of evo-devo, for the Flight Deck.
 *
 * Deliberately NOT built on the injected-store pattern the write services use.
 * That abstraction exists so mutation logic — development, mutation, selection,
 * lifecycle transitions — can be tested without a database, and it earns its
 * keep there. These are list queries with no business logic to test: an
 * in-memory double would only re-implement SQL and assert against itself.
 *
 * Every method is organisation-scoped. The write services enforce tenancy by
 * resolving a genome or phenotype within an org before acting; a listing has no
 * such natural gate, so the filter is applied directly and is the only thing
 * standing between one tenant and another's lineage.
 */
export class EvoDevoReadService {
  /** Genomes newest-first, with how many phenotypes each has been grown into. */
  async listGenomes(organizationId: number, limit = 100) {
    return db
      .select({
        id: evoDevoGenomes.id,
        genomeKey: evoDevoGenomes.genomeKey,
        speciesId: evoDevoGenomes.speciesId,
        generation: evoDevoGenomes.generation,
        contentHash: evoDevoGenomes.contentHash,
        createdAt: evoDevoGenomes.createdAt,
        phenotypeCount: sql<number>`(
          select count(*)::int from ${evoDevoPhenotypes}
          where ${evoDevoPhenotypes.genomeId} = ${evoDevoGenomes.id}
        )`,
      })
      .from(evoDevoGenomes)
      .where(eq(evoDevoGenomes.organizationId, organizationId))
      .orderBy(desc(evoDevoGenomes.generation), desc(evoDevoGenomes.createdAt))
      .limit(Math.min(limit, 500));
  }

  /**
   * Phenotypes grown from one genome, each with its CURRENT stage.
   *
   * Stage is derived from the latest stage event rather than stored on the
   * phenotype — the event log is the source of truth, and a denormalised column
   * would be a second one that could disagree with it.
   */
  async listPhenotypes(organizationId: number, genomeId: string) {
    return db
      .select({
        id: evoDevoPhenotypes.id,
        seed: evoDevoPhenotypes.seed,
        compilerVersion: evoDevoPhenotypes.compilerVersion,
        contentHash: evoDevoPhenotypes.contentHash,
        createdAt: evoDevoPhenotypes.createdAt,
        currentStage: sql<string | null>`(
          select ${evoDevoStageEvents.toStage} from ${evoDevoStageEvents}
          where ${evoDevoStageEvents.phenotypeId} = ${evoDevoPhenotypes.id}
          order by ${evoDevoStageEvents.createdAt} desc, ${evoDevoStageEvents.id} desc
          limit 1
        )`,
        evaluationCount: sql<number>`(
          select count(*)::int from ${evoDevoEvaluations}
          where ${evoDevoEvaluations.phenotypeId} = ${evoDevoPhenotypes.id}
        )`,
      })
      .from(evoDevoPhenotypes)
      .where(and(
        eq(evoDevoPhenotypes.organizationId, organizationId),
        eq(evoDevoPhenotypes.genomeId, genomeId),
      ))
      .orderBy(asc(evoDevoPhenotypes.seed));
  }

  /**
   * The full stage history for a phenotype, oldest first.
   *
   * This is the immutable audit log the migration protects with a trigger, so
   * it reads as a timeline: every promotion, rollback and kill, who did it and
   * on what evidence. Ascending because the question is "how did it get here",
   * which is a story with a beginning.
   */
  async stageHistory(organizationId: number, phenotypeId: string) {
    return db
      .select({
        id: evoDevoStageEvents.id,
        fromStage: evoDevoStageEvents.fromStage,
        toStage: evoDevoStageEvents.toStage,
        action: evoDevoStageEvents.action,
        evidence: evoDevoStageEvents.evidence,
        actorId: evoDevoStageEvents.actorId,
        createdAt: evoDevoStageEvents.createdAt,
      })
      .from(evoDevoStageEvents)
      .where(and(
        eq(evoDevoStageEvents.organizationId, organizationId),
        eq(evoDevoStageEvents.phenotypeId, phenotypeId),
      ))
      .orderBy(asc(evoDevoStageEvents.createdAt), asc(evoDevoStageEvents.id));
  }

  /** Populations with their live member counts. */
  async listPopulations(organizationId: number) {
    return db
      .select({
        id: evoDevoPopulations.id,
        populationKey: evoDevoPopulations.populationKey,
        speciesId: evoDevoPopulations.speciesId,
        status: evoDevoPopulations.status,
        constraints: evoDevoPopulations.constraints,
        createdAt: evoDevoPopulations.createdAt,
        memberCount: sql<number>`(
          select count(*)::int from ${evoDevoPopulationMembers}
          where ${evoDevoPopulationMembers.populationId} = ${evoDevoPopulations.id}
        )`,
      })
      .from(evoDevoPopulations)
      .where(eq(evoDevoPopulations.organizationId, organizationId))
      .orderBy(desc(evoDevoPopulations.createdAt));
  }
}

export const evoDevoReadService = new EvoDevoReadService();
