import { describe, expect, it } from "vitest";
import { EvolutionPopulationService, type PopulationStore } from "./evolution-population.service.js";
import type { EvaluatedIndividual, SelectionConstraints } from "@shared/evo-devo/index.js";

class MemoryPopulationStore implements PopulationStore {
  population?: { id: string; constraints: SelectionConstraints }; candidates: EvaluatedIndividual[] = []; selections: string[][] = [];
  async createPopulation(_org: number, _key: string, _species: string, constraints: SelectionConstraints) { return this.population = { id: "population-1", constraints }; }
  async findPopulation() { return this.population; }
  async addMember() {}
  async recordEvaluation() {}
  async latestEvaluations() { return this.candidates; }
  async recordSelection(_org: number, _population: string, _candidates: EvaluatedIndividual[], selected: string[]) { this.selections.push(selected); return { id: "selection-1" }; }
}

const fitness = (genomeId: string, outcome: number, costUsd: number, safety = 1): EvaluatedIndividual => ({
  genomeId, phenotypeHash: `hash:${genomeId}`, eligible: true, ineligibilityReasons: [],
  fitness: { outcome, reliability: 0.95, safety, humanExperience: 0.9, costUsd, latencyMs: 500, sampleSize: 50 },
});

describe("EvolutionPopulationService", () => {
  it("durably selects a safe Pareto front", async () => {
    const store = new MemoryPopulationStore(); const service = new EvolutionPopulationService(store);
    await service.createPopulation(1, { populationKey: "gqe-a", speciesId: "gqe", constraints: { minimumSafety: 0.95, minimumReliability: 0.8, minimumSampleSize: 30 } });
    store.candidates = [fitness("quality", 0.95, 1), fitness("cheap", 0.8, 0.1), fitness("dominated", 0.7, 2), fitness("unsafe", 1, 0.01, 0.2)];
    const result = await service.select(1, "gqe-a");
    expect(result.selected.map((candidate) => candidate.genomeId)).toEqual(["cheap", "quality"]);
    expect(store.selections).toEqual([["cheap", "quality"]]);
  });

  it("rejects invalid cohorts", async () => {
    const store = new MemoryPopulationStore(); const service = new EvolutionPopulationService(store);
    await service.createPopulation(1, { populationKey: "p", speciesId: "s", constraints: { minimumSafety: 1, minimumReliability: 1, minimumSampleSize: 1 } });
    await expect(service.addMember(1, "p", "phenotype", -1)).rejects.toMatchObject({ status: 400 });
  });
});

