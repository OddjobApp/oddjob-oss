import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@server/database_service.js";
import { evoDevoEvaluations, evoDevoPhenotypes, evoDevoPopulationMembers, evoDevoPopulations, evoDevoSelectionRuns } from "@shared/schema/evo-devo.js";
import { evaluatedIndividualSchema, fitnessVectorSchema, paretoFront, type EvaluatedIndividual, type SelectionConstraints } from "@shared/evo-devo/index.js";

const constraintsSchema = z.object({
  minimumSafety: z.number().min(0).max(1), minimumReliability: z.number().min(0).max(1),
  minimumSampleSize: z.number().int().positive(), maximumCostUsd: z.number().nonnegative().optional(),
  maximumLatencyMs: z.number().nonnegative().optional(),
});
const evaluationInputSchema = z.object({
  evaluatorKey: z.string().min(1), evaluatorVersion: z.string().min(1), fitness: fitnessVectorSchema,
  eligible: z.boolean().default(true), ineligibilityReasons: z.array(z.string()).default([]),
  evidence: z.record(z.unknown()).default({}),
});

export interface PopulationStore {
  createPopulation(orgId: number, key: string, speciesId: string, constraints: SelectionConstraints): Promise<{ id: string; constraints: SelectionConstraints }>;
  findPopulation(orgId: number, key: string): Promise<{ id: string; constraints: SelectionConstraints } | undefined>;
  addMember(orgId: number, populationId: string, phenotypeId: string, cohort: number): Promise<void>;
  recordEvaluation(orgId: number, phenotypeId: string, input: z.infer<typeof evaluationInputSchema>): Promise<void>;
  latestEvaluations(orgId: number, populationId: string): Promise<EvaluatedIndividual[]>;
  recordSelection(orgId: number, populationId: string, candidates: EvaluatedIndividual[], selectedGenomeIds: string[]): Promise<{ id: string }>;
}

export class DrizzlePopulationStore implements PopulationStore {
  async createPopulation(organizationId: number, populationKey: string, speciesId: string, constraints: SelectionConstraints) {
    const [row] = await db.insert(evoDevoPopulations).values({ organizationId, populationKey, speciesId, constraints }).returning();
    return { id: row.id, constraints: row.constraints };
  }
  async findPopulation(organizationId: number, populationKey: string) {
    const [row] = await db.select().from(evoDevoPopulations).where(and(eq(evoDevoPopulations.organizationId, organizationId), eq(evoDevoPopulations.populationKey, populationKey))).limit(1);
    return row ? { id: row.id, constraints: row.constraints } : undefined;
  }
  async addMember(organizationId: number, populationId: string, phenotypeId: string, cohort: number) {
    const [phenotype] = await db.select({ id: evoDevoPhenotypes.id }).from(evoDevoPhenotypes).where(and(eq(evoDevoPhenotypes.id, phenotypeId), eq(evoDevoPhenotypes.organizationId, organizationId))).limit(1);
    if (!phenotype) throw Object.assign(new Error("Phenotype not found"), { status: 404 });
    await db.insert(evoDevoPopulationMembers).values({ populationId, phenotypeId, cohort });
  }
  async recordEvaluation(organizationId: number, phenotypeId: string, input: z.infer<typeof evaluationInputSchema>) {
    const [phenotype] = await db.select({ id: evoDevoPhenotypes.id }).from(evoDevoPhenotypes).where(and(eq(evoDevoPhenotypes.id, phenotypeId), eq(evoDevoPhenotypes.organizationId, organizationId))).limit(1);
    if (!phenotype) throw Object.assign(new Error("Phenotype not found"), { status: 404 });
    await db.insert(evoDevoEvaluations).values({ organizationId, phenotypeId, ...input });
  }
  async latestEvaluations(organizationId: number, populationId: string) {
    const rows = await db.select({ document: evoDevoPhenotypes.document, fitness: evoDevoEvaluations.fitness, eligible: evoDevoEvaluations.eligible, reasons: evoDevoEvaluations.ineligibilityReasons })
      .from(evoDevoPopulationMembers).innerJoin(evoDevoPhenotypes, eq(evoDevoPopulationMembers.phenotypeId, evoDevoPhenotypes.id))
      .innerJoin(evoDevoEvaluations, eq(evoDevoEvaluations.phenotypeId, evoDevoPhenotypes.id))
      .where(and(eq(evoDevoPopulationMembers.populationId, populationId), eq(evoDevoPhenotypes.organizationId, organizationId)))
      .orderBy(desc(evoDevoEvaluations.createdAt));
    const latest = new Map<string, EvaluatedIndividual>();
    for (const row of rows) if (!latest.has(row.document.genomeId)) latest.set(row.document.genomeId, evaluatedIndividualSchema.parse({ genomeId: row.document.genomeId, phenotypeHash: row.document.contentHash, fitness: row.fitness, eligible: row.eligible, ineligibilityReasons: row.reasons }));
    return [...latest.values()];
  }
  async recordSelection(organizationId: number, populationId: string, candidates: EvaluatedIndividual[], selectedGenomeIds: string[]) {
    const [row] = await db.insert(evoDevoSelectionRuns).values({ organizationId, populationId, candidates, selectedGenomeIds }).returning({ id: evoDevoSelectionRuns.id });
    return row;
  }
}

export class EvolutionPopulationService {
  constructor(private readonly store: PopulationStore = new DrizzlePopulationStore()) {}
  async createPopulation(orgId: number, input: unknown) {
    const parsed = z.object({ populationKey: z.string().min(1), speciesId: z.string().min(1), constraints: constraintsSchema }).parse(input);
    return this.store.createPopulation(orgId, parsed.populationKey, parsed.speciesId, parsed.constraints);
  }
  async addMember(orgId: number, populationKey: string, phenotypeId: string, cohort: number) {
    const population = await this.requirePopulation(orgId, populationKey);
    if (!Number.isInteger(cohort) || cohort < 0) throw Object.assign(new Error("cohort must be a non-negative integer"), { status: 400 });
    await this.store.addMember(orgId, population.id, phenotypeId, cohort); return { admitted: true };
  }
  async recordEvaluation(orgId: number, phenotypeId: string, input: unknown) {
    await this.store.recordEvaluation(orgId, phenotypeId, evaluationInputSchema.parse(input)); return { recorded: true };
  }
  async select(orgId: number, populationKey: string) {
    const population = await this.requirePopulation(orgId, populationKey);
    const candidates = await this.store.latestEvaluations(orgId, population.id);
    const selected = paretoFront(candidates, population.constraints);
    const run = await this.store.recordSelection(orgId, population.id, candidates, selected.map((item) => item.genomeId));
    return { selectionRunId: run.id, candidatesEvaluated: candidates.length, selected };
  }
  private async requirePopulation(orgId: number, key: string) {
    const population = await this.store.findPopulation(orgId, key);
    if (!population) throw Object.assign(new Error(`Population ${key} not found`), { status: 404 });
    return population;
  }
}
export const evolutionPopulationService = new EvolutionPopulationService();
