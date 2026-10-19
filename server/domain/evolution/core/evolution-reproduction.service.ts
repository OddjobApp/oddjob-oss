import { z } from "zod";
import { genomeMutationSchema } from "@shared/evo-devo/index.js";
import { evolutionPopulationService } from "./evolution-population.service.js";
import { evoDevoService } from "./evo-devo.service.js";

const reproductionPlanSchema = z.object({
  offspring: z.array(z.object({
    parentGenomeId: z.string().min(1), childGenomeId: z.string().min(1), mutation: genomeMutationSchema,
  })).length(1, "Reproduction currently accepts exactly one offspring so creation is atomic"),
});

export interface PopulationSelector {
  select(orgId: number, populationKey: string): Promise<{ selectionRunId: string; selected: Array<{ genomeId: string }> }>;
}
export interface DescendantCreator {
  createChild(orgId: number, parentKey: string, childId: string, mutation: unknown): Promise<{ id: string; document: { id: string; parentIds: string[]; generation: number } }>;
}

export class EvolutionReproductionService {
  constructor(
    private readonly selector: PopulationSelector = evolutionPopulationService,
    private readonly descendants: DescendantCreator = evoDevoService,
  ) {}

  async selectAndReproduce(orgId: number, populationKey: string, input: unknown) {
    const plan = reproductionPlanSchema.parse(input);
    const selection = await this.selector.select(orgId, populationKey);
    const selected = new Set(selection.selected.map((candidate) => candidate.genomeId));
    const unauthorized = plan.offspring.filter((item) => !selected.has(item.parentGenomeId));
    if (unauthorized.length) throw Object.assign(new Error(`Reproduction plan includes unselected parents: ${unauthorized.map((item) => item.parentGenomeId).join(", ")}`), { status: 409 });

    const item = plan.offspring[0];
    const children = [await this.descendants.createChild(orgId, item.parentGenomeId, item.childGenomeId, item.mutation)];
    return { selectionRunId: selection.selectionRunId, selectedParentIds: [...selected], children };
  }
}
export const evolutionReproductionService = new EvolutionReproductionService();
