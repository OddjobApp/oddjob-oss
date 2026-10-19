import { describe, expect, it } from "vitest";
import { normalizeForgeDiagram } from "./forge-wizard-diagram";

describe("normalizeForgeDiagram", () => {
  it("lays out topology-only nodes before React Flow receives them", () => {
    const result = normalizeForgeDiagram({
      nodes: [{ id: "intake", label: "Intake" }, { id: "review", position: { x: 12, y: 34 }, data: { label: "Review" } }],
      edges: [{ source: "intake", target: "review" }],
    });

    expect(result.nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(result.nodes[0].data).toEqual({ label: "Intake" });
    expect(result.nodes[1].position).toEqual({ x: 12, y: 34 });
    expect(result.edges[0]).toMatchObject({ source: "intake", target: "review" });
  });

  it("drops edges that reference nodes the agent did not return", () => {
    const result = normalizeForgeDiagram({
      nodes: [{ id: "known" }],
      edges: [{ source: "known", target: "missing" }],
    });
    expect(result.edges).toEqual([]);
  });
});
