/**
 * Unit Tests for Autoresearch Bayesian Hypothesis Engine & MAB Allocator
 */

import { describe, expect, it } from "vitest";
import {
  AutoresearchHypothesisService,
  type ResearchHypothesis,
} from "./autoresearch-hypothesis.service.js";

describe("Autoresearch Bayesian Hypothesis Engine (Level 3)", () => {
  const service = new AutoresearchHypothesisService();

  it("initializes a hypothesis with default Beta(1, 1) prior", () => {
    const hyp = service.createHypothesis({
      id: "hyp-prompt-temp-01",
      organizationId: 1,
      title: "Lower Temperature for JSON Formatting",
      premise: "Lowering LLM temperature from 0.7 to 0.1 will eliminate JSON parse syntax errors.",
      testVector: {
        parameterOverrides: { temperature: 0.1 },
      },
    });

    expect(hyp.id).toBe("hyp-prompt-temp-01");
    expect(hyp.alpha).toBe(1.0);
    expect(hyp.beta).toBe(1.0);
    expect(hyp.pullCount).toBe(0);
    expect(hyp.status).toBe("active");
    expect(service.computePosteriorMean(hyp)).toBe(0.5); // (1 / (1+1))
  });

  it("selects un-pulled arms first during initial exploration", () => {
    const h1 = service.createHypothesis({ id: "h1", organizationId: 1, title: "H1", premise: "P1" });
    const h2 = service.createHypothesis({ id: "h2", organizationId: 1, title: "H2", premise: "P2" });

    // H1 has 1 pull, H2 has 0 pulls
    const h1Updated = service.recordExperimentOutcome(h1, true);

    const selected = service.selectHypothesisViaBandit([h1Updated, h2]);
    expect(selected?.id).toBe("h2");
  });

  it("balances exploitation and exploration via UCB1", () => {
    let h1 = service.createHypothesis({ id: "h1", organizationId: 1, title: "High Performer", premise: "P1" });
    let h2 = service.createHypothesis({ id: "h2", organizationId: 1, title: "Low Performer", premise: "P2" });

    // Seed h1 with 5 successes out of 5 trials
    for (let i = 0; i < 5; i++) {
      h1 = service.recordExperimentOutcome(h1, true);
    }

    // Seed h2 with 1 success out of 5 trials
    h2 = service.recordExperimentOutcome(h2, true);
    for (let i = 0; i < 4; i++) {
      h2 = service.recordExperimentOutcome(h2, false);
    }

    const selected = service.selectHypothesisViaBandit([h1, h2]);
    // High performer should be selected
    expect(selected?.id).toBe("h1");
  });

  it("automatically validates hypothesis upon achieving high statistical confidence", () => {
    let hyp = service.createHypothesis({ id: "h-valid", organizationId: 1, title: "Robust Fix", premise: "Fixes race condition" });

    for (let i = 0; i < 10; i++) {
      hyp = service.recordExperimentOutcome(hyp, true);
    }

    expect(hyp.pullCount).toBe(10);
    expect(hyp.successCount).toBe(10);
    expect(hyp.status).toBe("validated");
    expect(service.computePosteriorMean(hyp)).toBeGreaterThanOrEqual(0.90);
  });

  it("automatically rejects hypothesis upon continuous failure", () => {
    let hyp = service.createHypothesis({ id: "h-reject", organizationId: 1, title: "Broken Mod", premise: "Degrades throughput" });

    for (let i = 0; i < 10; i++) {
      hyp = service.recordExperimentOutcome(hyp, false);
    }

    expect(hyp.pullCount).toBe(10);
    expect(hyp.successCount).toBe(0);
    expect(hyp.status).toBe("rejected");
    expect(service.computePosteriorMean(hyp)).toBeLessThanOrEqual(0.35);
  });

  it("generates markdown benchmark report with strategic recommendations", () => {
    let h1 = service.createHypothesis({ id: "h-eval", organizationId: 1, title: "Fast Embeddings", premise: "Switch to local SLM" });
    for (let i = 0; i < 10; i++) {
      h1 = service.recordExperimentOutcome(h1, true);
    }

    const report = service.generateBenchmarkReport([h1]);
    expect(report).toContain("# Autoresearch Bayesian Benchmark Report");
    expect(report).toContain("h-eval");
    expect(report).toContain("validated");
    expect(report).toContain("Promote to Production");
  });
});
