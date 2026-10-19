/**
 * Report Builder — generates Confluence storage format HTML for QA test reports.
 */
import type { TestSuiteRecord, DefectRecord, FixtureRecord, QualityGateRecord } from "./collections";

export interface TestReportData {
  sprintNumber: number;
  date: string;
  suites: TestSuiteRecord[];
  defects: DefectRecord[];
  fixtures: FixtureRecord[];
  latestGate: QualityGateRecord | null;
  investigationSummary?: string;
}

export function buildTestReportHtml(data: TestReportData): string {
  const { suites, defects, fixtures, latestGate } = data;
  const passedSuites = suites.filter((s) => s.status === "passed").length;
  const failedSuites = suites.filter((s) => s.status === "failed").length;
  const avgCoverage = suites.length > 0
    ? Math.round(suites.reduce((s, r) => s + r.coveragePercent, 0) / suites.length)
    : 0;
  const openDefects = defects.filter((d) => d.status === "open");
  const criticalCount = openDefects.filter((d) => d.severity === "Critical").length;
  const highCount = openDefects.filter((d) => d.severity === "High").length;

  const suiteRows = suites.map((s) =>
    `<tr><td>${esc(s.suiteName)}</td><td>${s.passCount}</td><td>${s.failCount}</td><td>${s.coveragePercent}%</td><td>${s.status}</td></tr>`
  ).join("");

  const defectRows = openDefects.map((d) =>
    `<tr><td>${esc(d.title)}</td><td>${d.severity}</td><td>${d.status}</td><td>${d.suiteName}</td><td>${d.externalIssueKey ?? "—"}</td></tr>`
  ).join("");

  const gateRules = latestGate?.rules.map((r) =>
    `<tr><td>${esc(r.name)}</td><td>${r.status === "passed" ? "✅" : "❌"}</td><td>${String(r.value)}</td><td>${String(r.threshold)}</td></tr>`
  ).join("") ?? "";

  return `
<h1>QA Test Report: Sprint ${data.sprintNumber} — ${data.date}</h1>

<h2>Summary</h2>
<table>
  <tr><td><strong>Total Suites</strong></td><td>${suites.length}</td></tr>
  <tr><td><strong>Passed</strong></td><td>${passedSuites}</td></tr>
  <tr><td><strong>Failed</strong></td><td>${failedSuites}</td></tr>
  <tr><td><strong>Average Coverage</strong></td><td>${avgCoverage}%</td></tr>
  <tr><td><strong>Open Defects</strong></td><td>${openDefects.length} (${criticalCount} Critical, ${highCount} High)</td></tr>
  <tr><td><strong>Fixtures Registered</strong></td><td>${fixtures.length}</td></tr>
  <tr><td><strong>Quality Gate</strong></td><td>${latestGate?.overallStatus ?? "Not evaluated"}</td></tr>
</table>

<h2>Test Suites</h2>
<table>
  <tr><th>Suite</th><th>Passed</th><th>Failed</th><th>Coverage</th><th>Status</th></tr>
  ${suiteRows || "<tr><td colspan='5'>No suites logged</td></tr>"}
</table>

<h2>Open Defects</h2>
<table>
  <tr><th>Title</th><th>Severity</th><th>Status</th><th>Suite</th><th>Jira</th></tr>
  ${defectRows || "<tr><td colspan='5'>No open defects</td></tr>"}
</table>

<h2>Quality Gate Evaluation</h2>
${latestGate ? `
<p>Status: <strong>${latestGate.overallStatus.toUpperCase()}</strong> (${new Date(latestGate.evaluatedAt).toLocaleString()})</p>
<table>
  <tr><th>Rule</th><th>Result</th><th>Value</th><th>Threshold</th></tr>
  ${gateRules}
</table>
` : "<p>No gate evaluation performed yet.</p>"}

${data.investigationSummary ? `<h2>Investigation Findings</h2><p>${esc(data.investigationSummary)}</p>` : ""}
`.trim();
}

function esc(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
