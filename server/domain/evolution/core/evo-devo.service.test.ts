import { describe, expect, it } from "vitest";
import { EvoDevoService, type EvoDevoStore, type StoredEnvironment, type StoredGenome, type StoredPhenotype } from "./evo-devo.service.js";

class MemoryStore implements EvoDevoStore {
  genomes = new Map<string, StoredGenome>(); environments = new Map<string, StoredEnvironment>(); phenotypes: StoredPhenotype[] = [];
  parents = new Map<string, string[]>(); next = 0;
  async insertEnvironment(_org: number, document: StoredEnvironment["document"]) { const row = { id: `e${++this.next}`, document }; this.environments.set(document.id, row); return row; }
  async insertGenome(_org: number, document: StoredGenome["document"], _hash: string, parentIds: string[] = []) { const row = { id: `g${++this.next}`, document }; this.genomes.set(document.id, row); this.parents.set(row.id, parentIds); return row; }
  async insertPhenotype(_org: number, _genome: string, _environment: string, document: StoredPhenotype["document"]) { const row = { id: `p${++this.next}`, document }; this.phenotypes.push(row); return row; }
  async findGenome(org: number, key: string) { const row = this.genomes.get(key); return row?.document.organizationId === org ? row : undefined; }
  async findEnvironment(org: number, key: string) { const row = this.environments.get(key); return row?.document.organizationId === org ? row : undefined; }
  async listParents(org: number, genomeId: string) { const ids = this.parents.get(genomeId) ?? []; return [...this.genomes.values()].filter((row) => ids.includes(row.id) && row.document.organizationId === org); }
}

/**
 * These tests exercise the genome algebra, not capability existence. Without an
 * injected checker the service would fall back to the real registry and drag
 * Qdrant plus the embedding provider into a pure unit test — the exact coupling
 * the CapabilityChecker seam exists to prevent. Registry behaviour has its own
 * tests in capability-registry.service.test.ts.
 */
const AllRegistered = { findUnregistered: async () => [] };

const environment = { schemaVersion: "1.0.0", id: "sandbox", capabilities: ["triage"], allowedPermissions: ["read"], signals: {}, maxSteps: 5 };
const genome = { schemaVersion: "1.0.0", id: "founder", speciesId: "support", steps: [{ id: "triage", kind: "agent", capability: "triage", dependsOn: [], config: {}, permissions: ["read"] }], developmentalRules: [], protectedLoci: [], metadata: {} };

describe("EvoDevoService", () => {
  it("registers, develops, mutates, and reports lineage within an organization", async () => {
    const store = new MemoryStore(); const service = new EvoDevoService(store, AllRegistered);
    await service.registerEnvironment(4, environment);
    await service.registerFounderGenome(4, genome);
    const phenotype = await service.develop(4, "founder", "sandbox", 9);
    expect(phenotype.document).toMatchObject({ genomeId: "founder", environmentId: "sandbox", seed: 9 });
    await service.createChild(4, "founder", "child", { type: "replace_step_config", stepId: "triage", config: { retries: 3 } });
    const lineage = await service.getLineage(4, "child");
    expect(lineage.genome.document).toMatchObject({ id: "child", generation: 1, parentIds: ["founder"] });
    expect(lineage.parents.map((parent) => parent.document.id)).toEqual(["founder"]);
  });

  it("does not resolve resources from another organization", async () => {
    const store = new MemoryStore(); const service = new EvoDevoService(store, AllRegistered);
    await service.registerFounderGenome(4, genome);
    await expect(service.getLineage(5, "founder")).rejects.toMatchObject({ status: 404 });
  });
});


describe("EvoDevoService capability validation", () => {
  const genomeUsing = (capability: string) => ({
    ...genome,
    id: `g-${capability}`,
    steps: [{ id: "triage", kind: "agent", capability, dependsOn: [], config: {}, permissions: ["read"] }],
  });

  it("refuses a founder genome naming a capability the registry does not hold", async () => {
    const store = new MemoryStore();
    const service = new EvoDevoService(store, { findUnregistered: async () => ["ghost_capability"] });

    await expect(service.registerFounderGenome(4, genomeUsing("ghost_capability")))
      .rejects.toThrow(/unregistered capabilit/i);
    // Nothing is persisted: a genome that cannot run must not become an
    // ancestor others inherit from.
    expect(store.genomes.size).toBe(0);
  });

  it("refuses a MUTATED descendant that introduces an unregistered capability", async () => {
    // Validating only founders would leave every child unchecked, and
    // replace_step_capability is the other way one gets in.
    const store = new MemoryStore();
    const unregistered = new Set<string>();
    const service = new EvoDevoService(store, {
      findUnregistered: async (_org, ids) => ids.filter((id) => unregistered.has(id)),
    });

    await service.registerEnvironment(4, environment);
    await service.registerFounderGenome(4, genome);

    unregistered.add("ghost_capability");
    await expect(
      service.createChild(4, "founder", "child", {
        type: "replace_step_capability",
        stepId: "triage",
        capability: "ghost_capability",
      }),
    ).rejects.toThrow(/unregistered capabilit/i);
  });

  it("admits the genome when the registry cannot be reached", async () => {
    // Fails OPEN deliberately. Treating an unreachable vector store as "none of
    // your capabilities exist" would turn a degraded dependency into a total
    // block on genome authoring.
    const store = new MemoryStore();
    const service = new EvoDevoService(store, {
      findUnregistered: async () => {
        throw new Error("Capability registry unavailable: ECONNREFUSED");
      },
    });

    const registered = await service.registerFounderGenome(4, genome);
    expect(registered.id).toBeTruthy();
    expect(store.genomes.size).toBe(1);
  });
});
