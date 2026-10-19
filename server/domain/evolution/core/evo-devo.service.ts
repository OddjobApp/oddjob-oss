import { and, asc, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { capabilityRegistry } from "@domain/capabilities/core/capability-registry.service.js";
import {
  evoDevoEnvironments,
  evoDevoGenomeParents,
  evoDevoGenomes,
  evoDevoPhenotypes,
} from "@shared/schema/evo-devo.js";
import {
  createDescendant,
  developGenome,
  developmentEnvironmentSchema,
  genomeDocumentSchema,
  genomeMutationSchema,
  stableContentHash,
  type DevelopmentEnvironment,
  type GenomeDocument,
  type GenomeMutation,
  type PhenotypeDocument,
} from "@shared/evo-devo/index.js";

const logger = createLogger("EvoDevoService");

export interface StoredGenome { id: string; document: GenomeDocument }
export interface StoredEnvironment { id: string; document: DevelopmentEnvironment }
export interface StoredPhenotype { id: string; document: PhenotypeDocument }

export interface EvoDevoStore {
  insertEnvironment(organizationId: number, document: DevelopmentEnvironment, contentHash: string): Promise<StoredEnvironment>;
  insertGenome(organizationId: number, document: GenomeDocument, contentHash: string, parentDatabaseIds?: string[]): Promise<StoredGenome>;
  insertPhenotype(organizationId: number, genomeDatabaseId: string, environmentDatabaseId: string, document: PhenotypeDocument): Promise<StoredPhenotype>;
  findGenome(organizationId: number, genomeKey: string): Promise<StoredGenome | undefined>;
  findEnvironment(organizationId: number, environmentKey: string): Promise<StoredEnvironment | undefined>;
  listParents(organizationId: number, genomeDatabaseId: string): Promise<StoredGenome[]>;
}

export class DrizzleEvoDevoStore implements EvoDevoStore {
  async insertEnvironment(organizationId: number, document: DevelopmentEnvironment, contentHash: string) {
    const [row] = await db.insert(evoDevoEnvironments).values({
      organizationId, environmentKey: document.id, document, contentHash,
    }).returning();
    return { id: row.id, document: row.document };
  }

  async insertGenome(organizationId: number, document: GenomeDocument, contentHash: string, parentDatabaseIds: string[] = []) {
    return db.transaction(async (tx) => {
      const [row] = await tx.insert(evoDevoGenomes).values({
        organizationId, genomeKey: document.id, speciesId: document.speciesId,
        generation: document.generation, document, contentHash,
      }).returning();
      if (parentDatabaseIds.length) {
        await tx.insert(evoDevoGenomeParents).values(parentDatabaseIds.map((parentGenomeId, ordinal) => ({
          childGenomeId: row.id, parentGenomeId, ordinal,
        })));
      }
      return { id: row.id, document: row.document };
    });
  }

  async insertPhenotype(organizationId: number, genomeDatabaseId: string, environmentDatabaseId: string, document: PhenotypeDocument) {
    const [row] = await db.insert(evoDevoPhenotypes).values({
      organizationId, genomeId: genomeDatabaseId, environmentId: environmentDatabaseId,
      seed: document.seed, compilerVersion: document.compilerVersion, document, contentHash: document.contentHash,
    }).returning();
    return { id: row.id, document: row.document };
  }

  async findGenome(organizationId: number, genomeKey: string) {
    const [row] = await db.select().from(evoDevoGenomes).where(and(
      eq(evoDevoGenomes.organizationId, organizationId), eq(evoDevoGenomes.genomeKey, genomeKey),
    )).limit(1);
    return row ? { id: row.id, document: row.document } : undefined;
  }

  async findEnvironment(organizationId: number, environmentKey: string) {
    const [row] = await db.select().from(evoDevoEnvironments).where(and(
      eq(evoDevoEnvironments.organizationId, organizationId), eq(evoDevoEnvironments.environmentKey, environmentKey),
    )).orderBy(asc(evoDevoEnvironments.version)).limit(1);
    return row ? { id: row.id, document: row.document } : undefined;
  }

  async listParents(organizationId: number, genomeDatabaseId: string) {
    const rows = await db.select({ id: evoDevoGenomes.id, document: evoDevoGenomes.document })
      .from(evoDevoGenomeParents)
      .innerJoin(evoDevoGenomes, eq(evoDevoGenomeParents.parentGenomeId, evoDevoGenomes.id))
      .where(and(eq(evoDevoGenomeParents.childGenomeId, genomeDatabaseId), eq(evoDevoGenomes.organizationId, organizationId)))
      .orderBy(asc(evoDevoGenomeParents.ordinal));
    return rows;
  }
}

/**
 * The registry question evo-devo needs answered, narrowed to one method.
 *
 * Depending on the whole CapabilityRegistryService would drag Qdrant and the
 * embedding provider into every unit test of the genome algebra. This is the
 * only thing evo-devo asks of it.
 */
export interface CapabilityChecker {
  findUnregistered(organizationId: number, capabilityIds: string[]): Promise<string[]>;
}

export class EvoDevoService {
  constructor(
    private readonly store: EvoDevoStore = new DrizzleEvoDevoStore(),
    private readonly capabilities: CapabilityChecker = capabilityRegistry,
  ) {}

  async registerEnvironment(organizationId: number, input: unknown) {
    const document = developmentEnvironmentSchema.parse({ ...(input as object), organizationId });
    return this.store.insertEnvironment(organizationId, document, stableContentHash(document));
  }

  async registerFounderGenome(organizationId: number, input: unknown) {
    const document = genomeDocumentSchema.parse({ ...(input as object), organizationId, generation: 0, parentIds: [] });
    await this.assertCapabilitiesRegistered(organizationId, document);
    return this.store.insertGenome(organizationId, document, stableContentHash(document));
  }

  /**
   * Refuses a genome that names capabilities the registry does not hold.
   *
   * The schema already guarantees each id is SHAPED like a capability the
   * registry could mint; this asks whether it actually did. Both checks are
   * needed and neither subsumes the other: the shape check is free and catches
   * ids that can never exist, this one catches plausible ids that simply are
   * not there — a typo, or a capability that was removed after the genome was
   * written.
   *
   * Enforced at write time because a genome is a durable, content-hashed
   * artifact that descendants inherit from. Admitting one that cannot run means
   * every child inherits the same defect, and the failure only surfaces much
   * later when a phenotype is executed.
   *
   * FAILS OPEN when the registry cannot be reached. An unreachable vector store
   * is an infrastructure problem, and treating it as "none of your capabilities
   * exist" would block all genome authoring during a Qdrant outage — turning a
   * degraded dependency into an outage of its own. A missing capability blocks;
   * an unanswerable question warns.
   */
  private async assertCapabilitiesRegistered(organizationId: number, document: GenomeDocument): Promise<void> {
    const capabilityIds = [...new Set(document.steps.map((step) => step.capability))];
    if (capabilityIds.length === 0) return;

    let unregistered: string[];
    try {
      unregistered = await this.capabilities.findUnregistered(organizationId, capabilityIds);
    } catch (error) {
      logger.warn(
        `Could not verify capabilities for genome ${document.id}; admitting it unverified. ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    if (unregistered.length > 0) {
      throw Object.assign(
        new Error(
          `Genome ${document.id} references ${unregistered.length} unregistered ` +
            `capabilit${unregistered.length === 1 ? "y" : "ies"}: ${unregistered.join(", ")}`,
        ),
        { status: 422 },
      );
    }
  }

  async develop(organizationId: number, genomeKey: string, environmentKey: string, seed = 0) {
    const [genome, environment] = await Promise.all([
      this.requireGenome(organizationId, genomeKey), this.requireEnvironment(organizationId, environmentKey),
    ]);
    const document = developGenome(genome.document, environment.document, seed);
    return this.store.insertPhenotype(organizationId, genome.id, environment.id, document);
  }

  async createChild(organizationId: number, parentKey: string, childId: string, mutationInput: unknown) {
    const parent = await this.requireGenome(organizationId, parentKey);
    const mutation: GenomeMutation = genomeMutationSchema.parse(mutationInput);
    const document = createDescendant(parent.document, childId, mutation);
    // Descendants are checked too: `replace_step_capability` is the other way an
    // unregistered capability enters the lineage, and a child that cannot run is
    // no more admissible than a founder that cannot.
    await this.assertCapabilitiesRegistered(organizationId, document);
    return this.store.insertGenome(organizationId, document, stableContentHash(document), [parent.id]);
  }

  async getLineage(organizationId: number, genomeKey: string) {
    const genome = await this.requireGenome(organizationId, genomeKey);
    return { genome, parents: await this.store.listParents(organizationId, genome.id) };
  }

  private async requireGenome(organizationId: number, key: string) {
    const genome = await this.store.findGenome(organizationId, key);
    if (!genome) throw Object.assign(new Error(`Genome ${key} not found`), { status: 404 });
    return genome;
  }

  private async requireEnvironment(organizationId: number, key: string) {
    const environment = await this.store.findEnvironment(organizationId, key);
    if (!environment) throw Object.assign(new Error(`Environment ${key} not found`), { status: 404 });
    return environment;
  }
}

export const evoDevoService = new EvoDevoService();

