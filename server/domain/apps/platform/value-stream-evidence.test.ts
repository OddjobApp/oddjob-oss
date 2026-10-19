import { describe, expect, it } from "vitest";
import { computeDora, computeStageTimes } from "../../../blueprints/apps/sdlc-workbench/app/vsm-dashboard/content";
const empty = () => ({ signoffs: [], capacity: [], qualityGates: [], cabApprovals: [], deployments: [], incidents: [] } as any);
describe("value stream evidence correlation", () => {
  it("does not infer a failure rate or cycle time from absent evidence", () => {
    expect(computeDora(empty()).changeFailRate).toBeNull();
    expect(computeStageTimes(empty()).every(s => s.hours === null)).toBe(true);
  });
  it("does not pair unrelated signoffs, incidents and deployments just because their dates are near", () => {
    const data = empty();
    const now = new Date().toISOString();
    data.signoffs = [{ timestamp: now }, { timestamp: now }];
    data.incidents = [{ timestamp: now, severity: "SEV-1", status: "open" }];
    data.deployments = [{ id: "dep", timestamp: now, env: "production", status: "success" }];
    const metrics = computeDora(data);
    expect(metrics.changeFailRate).toBeNull();
    expect(metrics.mttr).toBeNull();
    expect(metrics.leadTime).toBeNull();
    expect(computeStageTimes(data).every(s => s.hours === null)).toBe(true);
  });
  it("uses incident resolution and correlated change evidence", () => {
    const data = empty();
    const start = new Date(Date.now() - 3600000).toISOString();
    const end = new Date().toISOString();
    data.signoffs = [{ changeId: "change-1", submittedAt: start }];
    data.incidents = [{ timestamp: start, resolvedAt: end, status: "resolved", severity: "SEV-1", deploymentId: "dep" }];
    data.deployments = [{ id: "dep", changeId: "change-1", timestamp: end, env: "production", status: "success", requirementsAcceptedAt: start, developmentStartedAt: end }];
    const metrics = computeDora(data);
    expect(metrics.mttr).toBeCloseTo(1);
    expect(metrics.leadTime).toBeCloseTo(1);
    expect(metrics.changeFailRate).toBe(100);
    expect(computeStageTimes(data)[0].hours).toBeCloseTo(1);
  });
});
