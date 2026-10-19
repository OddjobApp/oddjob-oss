import { describe, expect, it } from "vitest";
import { transitionPhenotype } from "./lifecycle.js";

describe("phenotype developmental lifecycle", () => {
  it("advances one stage at a time", () => {
    expect(transitionPhenotype("embryonic", "promote", { reason: "schema valid" }).to).toBe("validation");
    expect(transitionPhenotype("sandbox", "promote", { reason: "evaluated", evaluationId: "eval-1" }).to).toBe("shadow");
  });
  it("requires selection evidence and human approval before exposure", () => {
    expect(() => transitionPhenotype("shadow", "promote", { reason: "looks good" })).toThrowError(expect.objectContaining({ code: "APPROVAL_REQUIRED" }));
    expect(transitionPhenotype("shadow", "promote", { reason: "selected", selectionRunId: "selection-1", approvedBy: "operator-1" }).to).toBe("canary");
  });
  it("supports kill switches from every active stage", () => {
    expect(transitionPhenotype("mature", "kill", { reason: "incident" }).to).toBe("suspended");
  });
  it("only rolls back to an earlier stage", () => {
    expect(transitionPhenotype("canary", "rollback", { reason: "regression", rollbackTarget: "sandbox" }).to).toBe("sandbox");
    expect(() => transitionPhenotype("sandbox", "rollback", { reason: "invalid", rollbackTarget: "mature" })).toThrowError(expect.objectContaining({ code: "INVALID_ROLLBACK" }));
  });
  it("does not revive terminal phenotypes", () => {
    expect(() => transitionPhenotype("retired", "promote", { reason: "revive" })).toThrowError(expect.objectContaining({ code: "TERMINAL_STAGE" }));
  });
});
