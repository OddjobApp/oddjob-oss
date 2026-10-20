/**
 * Software & Security Audit Cycle & Capability Tools Tests
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { securityAuditHandlers, SECURITY_AUDIT_TOOLS } from "@domain/tools/v1/capabilities/security-audit-tools.js";
import { evaluateSecurityScore } from "@domain/knowledge/core/calculations/evaluators/security-score.evaluator.js";

describe("Software & Security Audit Blueprint Cycle", () => {
    it("loads and parses software-audit.cycle.yaml with all operational phases", () => {
        const yamlPath = path.resolve(process.cwd(), "server/cycles/software-audit.cycle.yaml");
        const fileContent = readFileSync(yamlPath, "utf-8");
        const parsed: any = yaml.load(fileContent);

        expect(parsed).toBeDefined();
        expect(parsed.name).toContain("Software & Security Audit");
        expect(parsed.version).toBe("1.0.0");
        expect(parsed.missions).toHaveLength(4);

        // Verify all 4 required operational phases exist (each phase is a mission,
        // so Org Forge can install it; the ids are unchanged)
        const phaseIds = parsed.missions.map((p: any) => p.id);
        expect(phaseIds).toContain("phase_1_ast_and_sca_scanning");
        expect(phaseIds).toContain("phase_2_aggregation_and_prioritization");
        expect(phaseIds).toContain("phase_3_hil_security_gate");
        expect(phaseIds).toContain("phase_4_remediation_and_compliance");

        // Verify agents and tools are declared
        expect(parsed.agents).toHaveLength(2);
        const tools = parsed.agents.flatMap((a: any) => a.tools);
        expect(tools).toContain("trigger_sast_scan");
        expect(tools).toContain("trigger_sca_scan");
        expect(tools).toContain("aggregate_findings");
        expect(tools).toContain("generate_security_patch");
    });
});

describe("Security Audit Capability Tools", () => {
    describe("SAST AST Static Analysis (trigger_sast_scan)", () => {
        it("detects hardcoded secret tokens", async () => {
            const vulnerableCode = `
                const apiKey = "AKIAIOSFODNN7EXAMPLE";
                const dbPassword = "password123456_super_secret_token";
            `;

            const findings = await securityAuditHandlers.triggerSastScan({ code: vulnerableCode });
            expect(findings.length).toBeGreaterThanOrEqual(1);

            const secretFinding = findings.find((f) => f.ruleId === "SEC-SECRET-001");
            expect(secretFinding).toBeDefined();
            expect(secretFinding?.severity).toBe("critical");
            expect(secretFinding?.cvssScore).toBeGreaterThanOrEqual(9.0);
        });

        it("detects SQL injection template literals", async () => {
            const vulnerableCode = `
                async function getUser(req, res) {
                    const userId = req.query.id;
                    const result = await db.query(\`SELECT * FROM users WHERE id = \${userId}\`);
                    return result;
                }
            `;

            const findings = await securityAuditHandlers.triggerSastScan({ code: vulnerableCode });
            const sqliFinding = findings.find((f) => f.ruleId === "SEC-SQLI-001");
            expect(sqliFinding).toBeDefined();
            expect(sqliFinding?.severity).toBe("critical");
        });

        it("detects command injection", async () => {
            const vulnerableCode = `
                import { execSync } from "child_process";
                function runScript(userDir) {
                    execSync(\`ls -la \${userDir}\`);
                }
            `;

            const findings = await securityAuditHandlers.triggerSastScan({ code: vulnerableCode });
            const cmdiFinding = findings.find((f) => f.ruleId === "SEC-CMDI-001");
            expect(cmdiFinding).toBeDefined();
            expect(cmdiFinding?.severity).toBe("high");
        });
    });

    describe("SCA Dependency Scanning (trigger_sca_scan)", () => {
        it("flags known vulnerable dependencies and suggests upgrade versions", async () => {
            const packageJson = JSON.stringify({
                dependencies: {
                    lodash: "4.17.15",
                    jsonwebtoken: "8.5.1",
                    express: "4.18.0",
                },
            });

            const findings = await securityAuditHandlers.triggerScaScan({ packageJsonContent: packageJson });
            expect(findings.length).toBeGreaterThanOrEqual(2);

            const jwtFinding = findings.find((f) => f.packageInfo?.name === "jsonwebtoken");
            expect(jwtFinding).toBeDefined();
            expect(jwtFinding?.packageInfo?.fixedVersion).toBe("9.0.0");
            expect(jwtFinding?.packageInfo?.cveId).toBe("CVE-2022-23529");
        });
    });

    describe("Aggregation, Prioritization & Patch Generation", () => {
        it("aggregates findings and computes posture score", async () => {
            const sastFindings = await securityAuditHandlers.triggerSastScan({
                code: 'const token = "ghp_123456789012345678901234567890123456";',
            });
            const scaFindings = await securityAuditHandlers.triggerScaScan({
                dependencies: { lodash: "4.17.15" },
            });

            const report = await securityAuditHandlers.aggregateFindings({
                sastFindings,
                scaFindings,
            });

            expect(report.summary.totalFindings).toBe(2);
            expect(report.summary.critical).toBeGreaterThanOrEqual(1);
            expect(report.summary.status).toBe("FAILED");
            expect(report.summary.postureScore).toBeLessThan(80);

            const { blockers, sprintFixes } = await securityAuditHandlers.prioritizeVulnerabilities({ report });
            expect(blockers.length).toBeGreaterThanOrEqual(1);
            expect(sprintFixes.length).toBeGreaterThanOrEqual(1);
        });

        it("generates surgical patch suggestions for dependencies", async () => {
            const finding: any = {
                type: "sca",
                packageInfo: {
                    name: "lodash",
                    currentVersion: "4.17.15",
                    fixedVersion: "4.17.21",
                    cveId: "CVE-2021-23337",
                },
            };

            const patch = await securityAuditHandlers.generateSecurityPatch({ finding });
            expect(patch.file).toBe("package.json");
            expect(patch.suggestedFix).toContain('"lodash": "^4.17.21"');
        });
    });

    describe("Security Score Calculation Evaluator", () => {
        it("calculates accurate posture scores and grades", () => {
            // Clean codebase
            const cleanResult = evaluateSecurityScore({ criticalFindings: 0, highFindings: 0, mediumFindings: 0 });
            expect(cleanResult.score).toBe(100);
            expect(cleanResult.status).toBe("PASSED");
            expect(cleanResult.grade).toBe("A");
            expect(cleanResult.complianceThresholdMet).toBe(true);

            // Codebase with 1 critical finding
            const criticalResult = evaluateSecurityScore({ criticalFindings: 1, highFindings: 0 });
            expect(criticalResult.score).toBe(75);
            expect(criticalResult.status).toBe("FAILED");
            expect(criticalResult.complianceThresholdMet).toBe(false);

            // Codebase with minor findings
            const warningResult = evaluateSecurityScore({ criticalFindings: 0, highFindings: 1, mediumFindings: 2 });
            expect(warningResult.score).toBe(84);
            expect(warningResult.status).toBe("WARNING");
            expect(warningResult.grade).toBe("C");
        });
    });

    describe("Capability Tool Registration", () => {
        it("verifies all SECURITY_AUDIT_TOOLS are properly defined with parameter schemas", () => {
            expect(SECURITY_AUDIT_TOOLS.trigger_sast_scan).toBeDefined();
            expect(SECURITY_AUDIT_TOOLS.trigger_sca_scan).toBeDefined();
            expect(SECURITY_AUDIT_TOOLS.aggregate_findings).toBeDefined();
            expect(SECURITY_AUDIT_TOOLS.prioritize_vulnerabilities).toBeDefined();
            expect(SECURITY_AUDIT_TOOLS.generate_security_patch).toBeDefined();
        });
    });
});
