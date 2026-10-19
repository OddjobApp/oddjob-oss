/**
 * Unit Tests for Software Audit Auto-PR Patching & Continuous SBOM (Level 4)
 */

import { describe, expect, it } from "vitest";
import {
  AutoPatchService,
  type VulnerabilityAdvisory,
} from "./auto-patch.service.js";

describe("Software Audit Auto-PR Patching & Continuous SBOM (Level 4)", () => {
  const service = new AutoPatchService();

  const dependencies = {
    express: "4.18.2",
    jsonwebtoken: "8.5.1",
    lodash: "4.17.21",
  };

  const sampleAdvisories: VulnerabilityAdvisory[] = [
    {
      cveId: "CVE-2026-1001",
      severity: "High",
      targetPackage: "jsonwebtoken",
      affectedVersions: "<= 8.5.1",
      patchedVersion: "9.0.0",
      vulnerablePattern: /jwt\.verify\(([^,]+),\s*secret\)/,
      safeReplacement: "jwt.verify($1, secret, { algorithms: ['HS256'] })",
      summary: "Insecure JWT algorithm fallback allowed token forgery.",
    },
  ];

  it("generates cryptographic SBOM attestation with SHA-256 integrity hashes", () => {
    const sbom = service.generateSbomAttestation(dependencies, "commit-sha-abc1234");

    expect(sbom.format).toBe("CycloneDX");
    expect(sbom.sbomVersion).toBe("1.5");
    expect(sbom.components.length).toBe(3);
    expect(sbom.components[0].sha256).toBeDefined();
    expect(sbom.attestationSignature).toBeDefined();
    expect(sbom.attestationSignature.length).toBe(64); // 256-bit hex
  });

  it("scans codebase files and maps exact line-level vulnerability occurrences", () => {
    const codebaseFiles = [
      {
        path: "server/auth/token.ts",
        content: "import jwt from 'jsonwebtoken';\nconst token = jwt.verify(rawToken, secret);\nexport { token };",
      },
    ];

    const findings = service.analyzeVulnerabilities(sampleAdvisories, codebaseFiles);
    expect(findings.length).toBe(1);
    expect(findings[0].cveId).toBe("CVE-2026-1001");
    expect(findings[0].filePath).toBe("server/auth/token.ts");
    expect(findings[0].lineNumber).toBe(2);
    expect(findings[0].suggestedPatch).toContain("{ algorithms: ['HS256'] }");
  });

  it("synthesizes surgical patch diff for detected vulnerabilities", () => {
    const originalFile = "import jwt from 'jsonwebtoken';\nconst token = jwt.verify(rawToken, secret);\nexport { token };";
    const finding = {
      cveId: "CVE-2026-1001",
      severity: "High" as const,
      filePath: "server/auth/token.ts",
      lineNumber: 2,
      snippet: "const token = jwt.verify(rawToken, secret);",
      suggestedPatch: "const token = jwt.verify(rawToken, secret, { algorithms: ['HS256'] });",
    };

    const patchResult = service.synthesizePatchDiff(finding, originalFile);
    expect(patchResult.patchedContent).toContain("const token = jwt.verify(rawToken, secret, { algorithms: ['HS256'] });");
    expect(patchResult.diff).toContain("- const token = jwt.verify(rawToken, secret);");
    expect(patchResult.diff).toContain("+ const token = jwt.verify(rawToken, secret, { algorithms: ['HS256'] });");
  });

  it("formats a signed Auto-PR payload with benchmark diffs and SBOM attestation", () => {
    const sbom = service.generateSbomAttestation(dependencies, "commit-sha-abc1234");
    const findings = [
      {
        cveId: "CVE-2026-1001",
        severity: "High" as const,
        filePath: "server/auth/token.ts",
        lineNumber: 2,
        snippet: "const token = jwt.verify(rawToken, secret);",
        suggestedPatch: "const token = jwt.verify(rawToken, secret, { algorithms: ['HS256'] });",
      },
    ];

    const prPayload = service.generateAutoPullRequest(
      findings,
      [{ path: "server/auth/token.ts", diff: "--- server/auth/token.ts\n+++ server/auth/token.ts" }],
      sbom
    );

    expect(prPayload.branchName).toContain("security/auto-patch-cve-2026-1001");
    expect(prPayload.title).toContain("Automated remediation for CVE-2026-1001");
    expect(prPayload.body).toContain("Cryptographic SBOM Verification");
    expect(prPayload.body).toContain(sbom.attestationSignature);
    expect(prPayload.isReadyForMerge).toBe(true);
  });
});
