import { ciImpactGateService } from "../core/ci-impact-gate.service.js";

describe("CI/CD Impact Gate Service", () => {
  it("should evaluate PR impact for unmapped code files and pass below threshold", async () => {
    const result = await ciImpactGateService.evaluatePullRequestImpact({
      modifiedFiles: ["client/src/components/Button.tsx", "server/utils/logger.ts"],
      maxBlastRadiusScore: 50,
    });

    expect(result.passed).toBe(true);
    expect(result.totalImpactScore).toBeLessThanOrEqual(50);
    expect(result.blastRadiusCategory).toBe("minimal");
    expect(result.details.length).toBe(2);
    expect(result.summary.modifiedFilesCount).toBe(2);
  });

  it("should assign elevated impact score to database schema files", async () => {
    const result = await ciImpactGateService.evaluatePullRequestImpact({
      modifiedFiles: ["shared/schema/database.ts"],
      maxBlastRadiusScore: 50,
    });

    expect(result.details[0].impactScore).toBeGreaterThanOrEqual(15);
    expect(result.summary.recommendedActions.some((a) => a.includes("schema regression"))).toBe(true);
  });

  it("should block pull request when cumulative blast radius exceeds max threshold", async () => {
    const result = await ciImpactGateService.evaluatePullRequestImpact({
      modifiedFiles: [
        "shared/schema/database.ts",
        "shared/schema/users.ts",
        "server/domain/agents/core/orchestrator.service.ts",
        "server/domain/xray/core/xray-lineage.service.ts",
      ],
      maxBlastRadiusScore: 10,
    });

    expect(result.passed).toBe(false);
    expect(result.blockedReason).toBeDefined();
    expect(result.blockedReason).toContain("exceeds maximum allowed PR threshold");
  });
});
