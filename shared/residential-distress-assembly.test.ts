import { describe, it, expect } from "vitest";
import {
  RESIDENTIAL_DISTRESS_ASSEMBLY_BLUEPRINT,
  validateResidentialDistressBlueprint,
  generateResidentialDistressMermaid,
} from "./residential-distress-assembly.js";

describe("Residential Real Estate Distress Assembly Blueprint", () => {
  it("validates cleanly against AssemblyBlueprintSchema with zero errors", () => {
    const result = validateResidentialDistressBlueprint();
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(JSON.stringify(result.error));
    }
    expect(result.data.id).toBe("app-residential-distress-acquisition");
    expect(result.data.stages).toHaveLength(4);
  });

  it("declares the 4 expected stages in topological execution order", () => {
    const stageIds = RESIDENTIAL_DISTRESS_ASSEMBLY_BLUEPRINT.stages.map((s) => s.id);
    expect(stageIds).toEqual(["spatial_radar", "mortgage_tape", "property_dossier", "hil_signoff"]);

    // Prerequisites chain
    expect(RESIDENTIAL_DISTRESS_ASSEMBLY_BLUEPRINT.stages[0].requires).toEqual([]);
    expect(RESIDENTIAL_DISTRESS_ASSEMBLY_BLUEPRINT.stages[1].requires).toEqual(["spatial_radar"]);
    expect(RESIDENTIAL_DISTRESS_ASSEMBLY_BLUEPRINT.stages[2].requires).toEqual(["mortgage_tape"]);
    expect(RESIDENTIAL_DISTRESS_ASSEMBLY_BLUEPRINT.stages[3].requires).toEqual(["property_dossier"]);
  });

  it("wires cross-screen input/output bindings cleanly across stages", () => {
    const tape = RESIDENTIAL_DISTRESS_ASSEMBLY_BLUEPRINT.stages[1];
    expect(tape.inputs.sourceParcels.sourceStageId).toBe("spatial_radar");
    expect(tape.inputs.sourceParcels.outputKey).toBe("matchedParcels");

    const dossier = RESIDENTIAL_DISTRESS_ASSEMBLY_BLUEPRINT.stages[2];
    expect(dossier.inputs.loanTape.sourceStageId).toBe("mortgage_tape");
    expect(dossier.inputs.loanTape.outputKey).toBe("loanTapeCsv");

    const hil = RESIDENTIAL_DISTRESS_ASSEMBLY_BLUEPRINT.stages[3];
    expect(hil.inputs.dossier.sourceStageId).toBe("property_dossier");
    expect(hil.inputs.dossier.outputKey).toBe("dossierMarkdown");
  });

  it("produces valid Mermaid flowchart diagram syntax", () => {
    const mermaid = generateResidentialDistressMermaid();
    expect(mermaid).toContain("graph TD");
    expect(mermaid).toContain("S1 --> S2 --> S3 --> S4");
  });
});
