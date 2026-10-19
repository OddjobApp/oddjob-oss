import { describe, expect, it, vi } from "vitest";
import { EvolutionReproductionService } from "./evolution-reproduction.service.js";

const selector = { select: vi.fn(async () => ({ selectionRunId: "selection-1", selected: [{ genomeId: "winner" }] })) };
const descendants = { createChild: vi.fn(async (_org: number, parent: string, child: string) => ({ id: `db-${child}`, document: { id: child, parentIds: [parent], generation: 2 } })) };

describe("EvolutionReproductionService", () => {
  it("creates typed descendants only from selected parents", async () => {
    const service = new EvolutionReproductionService(selector, descendants);
    const result = await service.selectAndReproduce(1, "population", { offspring: [{
      parentGenomeId: "winner", childGenomeId: "winner-child",
      mutation: { type: "replace_step_config", stepId: "ask", config: { concise: true } },
    }] });
    expect(result).toMatchObject({ selectionRunId: "selection-1", selectedParentIds: ["winner"], children: [{ document: { parentIds: ["winner"], generation: 2 } }] });
  });
  it("rejects reproduction from a losing parent", async () => {
    const service = new EvolutionReproductionService(selector, descendants);
    await expect(service.selectAndReproduce(1, "population", { offspring: [{
      parentGenomeId: "loser", childGenomeId: "bad-child",
      mutation: { type: "replace_step_config", stepId: "ask", config: {} },
    }] })).rejects.toMatchObject({ status: 409 });
  });
  it("rejects multi-child batches to prevent partial reproduction writes", async () => {
    const service = new EvolutionReproductionService(selector, descendants);
    const item = { parentGenomeId: "winner", childGenomeId: "duplicate", mutation: { type: "replace_step_config", stepId: "ask", config: {} } };
    await expect(service.selectAndReproduce(1, "population", { offspring: [item, item] })).rejects.toThrow(/exactly one offspring/);
  });
});
