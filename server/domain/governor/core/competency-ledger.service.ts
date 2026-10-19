/**
 * Competency ledger — an org's competency catalogue and which actors hold
 * which competency at what proficiency.
 *
 * Every method takes `organizationId: number` and scopes BOTH sides of the
 * competencies ⋈ actor_competencies join to it. Scoping only the assignment
 * side is not enough: before assign() checked ownership, an assignment row
 * could reference another tenant's competency id, and a join on id alone
 * renders that tenant's competency name and category.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { actorCompetencies, competencies, type ActorCompetency, type Competency } from "@shared/schema/index.js";

export interface AgentCompetencySummary {
  name: string;
  category: string;
  proficiencyLevel: number;
  verifiedBy: string | null;
  verifiedAt: Date;
}

export interface AssignCompetencyInput {
  actorType: "human" | "agent";
  actorId: string;
  competencyId: number;
  proficiencyLevel: number;
  verifiedBy: string;
}

const sameOrgJoin = (organizationId: number) => and(
  eq(actorCompetencies.competencyId, competencies.id),
  eq(competencies.organizationId, organizationId),
);

class CompetencyLedgerService {
  /** Each agent's competencies, keyed by actor id. */
  async agentCompetenciesByActor(organizationId: number): Promise<Map<string, AgentCompetencySummary[]>> {
    const rows = await db
      .select({
        actorId: actorCompetencies.actorId,
        name: competencies.name,
        category: competencies.category,
        proficiencyLevel: actorCompetencies.proficiencyLevel,
        verifiedBy: actorCompetencies.verifiedBy,
        verifiedAt: actorCompetencies.verifiedAt,
      })
      .from(actorCompetencies)
      .innerJoin(competencies, sameOrgJoin(organizationId))
      .where(and(eq(actorCompetencies.organizationId, organizationId), eq(actorCompetencies.actorType, "agent")));

    const byActor = new Map<string, AgentCompetencySummary[]>();
    for (const { actorId, ...summary } of rows) {
      const list = byActor.get(actorId) ?? [];
      list.push(summary);
      byActor.set(actorId, list);
    }
    return byActor;
  }

  /** The org's competency catalogue and every assignment against it. */
  async catalogue(organizationId: number) {
    const catalogue: Competency[] = await db
      .select()
      .from(competencies)
      .where(eq(competencies.organizationId, organizationId));

    const assignments = await db
      .select({
        id: actorCompetencies.id,
        actorType: actorCompetencies.actorType,
        actorId: actorCompetencies.actorId,
        competencyId: actorCompetencies.competencyId,
        competencyName: competencies.name,
        category: competencies.category,
        proficiencyLevel: actorCompetencies.proficiencyLevel,
        verifiedBy: actorCompetencies.verifiedBy,
        verifiedAt: actorCompetencies.verifiedAt,
        metadata: actorCompetencies.metadata,
      })
      .from(actorCompetencies)
      .innerJoin(competencies, sameOrgJoin(organizationId))
      .where(eq(actorCompetencies.organizationId, organizationId));

    return { competencies: catalogue, actorCompetencies: assignments };
  }

  /**
   * Record or re-certify an actor's competency. Null when the competency does
   * not belong to this org, so a caller cannot attach another tenant's.
   */
  async assign(organizationId: number, input: AssignCompetencyInput): Promise<ActorCompetency | null> {
    const [competency] = await db
      .select({ id: competencies.id })
      .from(competencies)
      .where(and(eq(competencies.id, input.competencyId), eq(competencies.organizationId, organizationId)))
      .limit(1);
    if (!competency) return null;

    const [existing] = await db
      .select({ id: actorCompetencies.id })
      .from(actorCompetencies)
      .where(and(
        eq(actorCompetencies.organizationId, organizationId),
        eq(actorCompetencies.actorType, input.actorType),
        eq(actorCompetencies.actorId, input.actorId),
        eq(actorCompetencies.competencyId, input.competencyId),
      ))
      .limit(1);

    const now = new Date();
    if (existing) {
      const [updated] = await db
        .update(actorCompetencies)
        .set({ proficiencyLevel: input.proficiencyLevel, verifiedBy: input.verifiedBy, verifiedAt: now, updatedAt: now })
        .where(and(eq(actorCompetencies.id, existing.id), eq(actorCompetencies.organizationId, organizationId)))
        .returning();
      return updated;
    }

    const [inserted] = await db
      .insert(actorCompetencies)
      .values({ organizationId, ...input, verifiedAt: now })
      .returning();
    return inserted;
  }
}

export const competencyLedgerService = new CompetencyLedgerService();
