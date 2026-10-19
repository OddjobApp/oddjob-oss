/**
 * Quality Gate — pure evaluation logic (no side effects).
 */
import type { TestSuiteRecord, DefectRecord, FixtureRecord } from "./collections";

export interface GateRule {
  name: string;
  status: "passed" | "failed";
  value: number | boolean;
  threshold: number | boolean;
}

export interface GateResult {
  overallStatus: "passed" | "failed";
  rules: GateRule[];
}

export function evaluateGate(
  suites: TestSuiteRecord[],
  defects: DefectRecord[],
  fixtures: FixtureRecord[],
  coverageThreshold: number
): GateResult {
  const avgCoverage = suites.length > 0
    ? suites.reduce((sum, s) => sum + s.coveragePercent, 0) / suites.length
    : 0;

  const openCritical = defects.filter(
    (d) => d.severity === "Critical" && d.status === "open"
  ).length;

  const failedSuites = suites.filter((s) => s.status === "failed").length;

  const allHaveEvidence = suites.length > 0 && suites.every(
    (s) => s.evidenceUrl && s.evidenceUrl.trim().length > 0
  );

  const hasFixtures = fixtures.length > 0;

  const rules: GateRule[] = [
    {
      name: "Coverage meets threshold",
      status: avgCoverage >= coverageThreshold ? "passed" : "failed",
      value: Math.round(avgCoverage * 10) / 10,
      threshold: coverageThreshold,
    },
    {
      name: "Zero open critical defects",
      status: openCritical === 0 ? "passed" : "failed",
      value: openCritical === 0,
      threshold: true,
    },
    {
      name: "No failed test suites",
      status: failedSuites === 0 ? "passed" : "failed",
      value: failedSuites === 0,
      threshold: true,
    },
    {
      name: "All suites have evidence links",
      status: allHaveEvidence ? "passed" : "failed",
      value: allHaveEvidence,
      threshold: true,
    },
    {
      name: "Fixture registry populated",
      status: hasFixtures ? "passed" : "failed",
      value: hasFixtures,
      threshold: true,
    },
  ];

  const overallStatus = rules.every((r) => r.status === "passed") ? "passed" : "failed";

  return { overallStatus, rules };
}
