import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@server/database_service.js";
import { evoDevoPhenotypes, evoDevoStageEvents } from "@shared/schema/evo-devo.js";
import { phenotypeStageSchema, transitionPhenotype, type PhenotypeStage, type StageEvidence, type StageTransition } from "@shared/evo-devo/index.js";

const actionSchema = z.enum(["promote", "rollback", "kill", "retire", "fail"]);
const transitionInputSchema = z.object({
  action: actionSchema,
  evidence: z.object({
    evaluationId: z.string().min(1).optional(), selectionRunId: z.string().min(1).optional(),
    approvedBy: z.string().min(1).optional(), rollbackTarget: phenotypeStageSchema.optional(), reason: z.string().trim().min(1),
  }),
});

export interface LifecycleStore {
  phenotypeExists(orgId: number, phenotypeId: string): Promise<boolean>;
  currentStage(orgId: number, phenotypeId: string): Promise<PhenotypeStage | undefined>;
  initializeAtomic(orgId: number, phenotypeId: string, actorId: string): Promise<{ stage: PhenotypeStage; initialized: boolean }>;
  transitionAtomic(orgId: number, phenotypeId: string, action: StageTransition["action"], evidence: StageEvidence, actorId: string): Promise<{ eventId: string; transition: StageTransition }>;
}

export class DrizzleLifecycleStore implements LifecycleStore {
  async phenotypeExists(organizationId: number, phenotypeId: string) {
    const [row] = await db.select({ id: evoDevoPhenotypes.id }).from(evoDevoPhenotypes).where(and(eq(evoDevoPhenotypes.organizationId, organizationId), eq(evoDevoPhenotypes.id, phenotypeId))).limit(1);
    return Boolean(row);
  }
  async currentStage(organizationId: number, phenotypeId: string) {
    const [row] = await db.select({ stage: evoDevoStageEvents.toStage }).from(evoDevoStageEvents).where(and(eq(evoDevoStageEvents.organizationId, organizationId), eq(evoDevoStageEvents.phenotypeId, phenotypeId))).orderBy(desc(evoDevoStageEvents.createdAt), desc(evoDevoStageEvents.id)).limit(1);
    return row?.stage;
  }
  async initializeAtomic(organizationId: number, phenotypeId: string, actorId: string) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${phenotypeId}))`);
      const [phenotype] = await tx.select({ id: evoDevoPhenotypes.id }).from(evoDevoPhenotypes).where(and(eq(evoDevoPhenotypes.organizationId, organizationId), eq(evoDevoPhenotypes.id, phenotypeId))).limit(1);
      if (!phenotype) throw Object.assign(new Error("Phenotype not found"), { status: 404 });
      const [existing] = await tx.select({ stage: evoDevoStageEvents.toStage }).from(evoDevoStageEvents).where(and(eq(evoDevoStageEvents.organizationId, organizationId), eq(evoDevoStageEvents.phenotypeId, phenotypeId))).orderBy(desc(evoDevoStageEvents.createdAt), desc(evoDevoStageEvents.id)).limit(1);
      if (existing) return { stage: existing.stage, initialized: false };
      await tx.insert(evoDevoStageEvents).values({ organizationId, phenotypeId, fromStage: null, toStage: "embryonic", action: "initialize", evidence: { reason: "Phenotype developed" }, actorId });
      return { stage: "embryonic" as const, initialized: true };
    });
  }
  async transitionAtomic(organizationId: number, phenotypeId: string, action: StageTransition["action"], evidence: StageEvidence, actorId: string) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${phenotypeId}))`);
      const [phenotype] = await tx.select({ id: evoDevoPhenotypes.id }).from(evoDevoPhenotypes).where(and(eq(evoDevoPhenotypes.organizationId, organizationId), eq(evoDevoPhenotypes.id, phenotypeId))).limit(1);
      if (!phenotype) throw Object.assign(new Error("Phenotype not found"), { status: 404 });
      const [current] = await tx.select({ stage: evoDevoStageEvents.toStage }).from(evoDevoStageEvents).where(and(eq(evoDevoStageEvents.organizationId, organizationId), eq(evoDevoStageEvents.phenotypeId, phenotypeId))).orderBy(desc(evoDevoStageEvents.createdAt), desc(evoDevoStageEvents.id)).limit(1);
      const transition = transitionPhenotype(current?.stage ?? "embryonic", action, evidence);
      const [event] = await tx.insert(evoDevoStageEvents).values({ organizationId, phenotypeId, fromStage: transition.from, toStage: transition.to, action, evidence, actorId }).returning({ id: evoDevoStageEvents.id });
      return { eventId: event.id, transition };
    });
  }
}

export class EvolutionLifecycleService {
  constructor(private readonly store: LifecycleStore = new DrizzleLifecycleStore()) {}
  async initialize(orgId: number, phenotypeId: string, actorId: string) {
    return this.store.initializeAtomic(orgId, phenotypeId, actorId);
  }
  async transition(orgId: number, phenotypeId: string, input: unknown, actorId: string) {
    const parsed = transitionInputSchema.parse(input);
    const result = await this.store.transitionAtomic(orgId, phenotypeId, parsed.action, parsed.evidence, actorId);
    return { eventId: result.eventId, ...result.transition };
  }
  async getCurrentStage(orgId: number, phenotypeId: string) {
    if (!await this.store.phenotypeExists(orgId, phenotypeId)) throw Object.assign(new Error("Phenotype not found"), { status: 404 });
    return { phenotypeId, stage: await this.store.currentStage(orgId, phenotypeId) ?? "embryonic" };
  }
}
export const evolutionLifecycleService = new EvolutionLifecycleService();
