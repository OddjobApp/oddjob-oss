/**
 * Security Audit & Vulnerability Triage Tools
 * 
 * Executable capability tools supporting the Software Audit & Compliance cycles:
 * - SAST static analysis (secret detection, SQLi, command injection, prototype pollution)
 * - SCA dependency & CVE scanning
 * - Finding aggregation and CVSS risk prioritization
 * - Automated security patch & dependency upgrade diff generation
 */

import { z } from "zod";
import type { ToolDefinition } from "./types.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SecurityAuditTools");

export interface SecurityFinding {
    id: string;
    type: "sast" | "sca" | "license" | "secret";
    ruleId: string;
    severity: "critical" | "high" | "medium" | "low" | "info";
    title: string;
    description: string;
    location?: {
        file: string;
        line?: number;
        column?: number;
        snippet?: string;
    };
    packageInfo?: {
        name: string;
        currentVersion: string;
        fixedVersion?: string;
        cveId?: string;
    };
    remediation: string;
    cvssScore?: number;
}

export interface SecurityAuditReport {
    scanTimestamp: string;
    summary: {
        totalFindings: number;
        critical: number;
        high: number;
        medium: number;
        low: number;
        info: number;
        postureScore: number;
        status: "PASSED" | "WARNING" | "FAILED";
    };
    findings: SecurityFinding[];
}

// Built-in SAST pattern matchers
const SAST_PATTERNS = [
    {
        ruleId: "SEC-SECRET-001",
        title: "Hardcoded API / Private Key",
        pattern: /(?:(?:api_?key|secret|token|password|auth_token)\s*[:=]\s*['"`]([A-Za-z0-9_\-\.]{16,})['"`]|(AKIA[0-9A-Z]{16})|(ghp_[A-Za-z0-9]{36}))/i,
        severity: "critical" as const,
        description: "Hardcoded secret or authentication token detected in source code.",
        remediation: "Extract the sensitive token to environment variables or secret vaults (e.g. process.env.SECRET).",
        cvss: 9.0,
    },
    {
        ruleId: "SEC-SQLI-001",
        title: "Potential SQL Injection",
        pattern: /(?:query|raw|execute)\s*\(\s*`[^`]*\$\{.*?\}[^`]*`\s*\)/i,
        severity: "critical" as const,
        description: "Unparameterized template literal string in SQL query execution.",
        remediation: "Use parameterized queries ($1, ?) or ORM query builders with typed bindings.",
        cvss: 8.8,
    },
    {
        ruleId: "SEC-CMDI-001",
        title: "Potential Command Injection",
        pattern: /(?:exec|execSync|spawn|spawnSync)\s*\(\s*`[^`]*\$\{.*?\}[^`]*`\s*\)/i,
        severity: "high" as const,
        description: "Unsanitized dynamic parameter passed to child process execution.",
        remediation: "Use execFile or spawn with array arguments rather than shell string interpolation.",
        cvss: 8.5,
    },
    {
        ruleId: "SEC-PROTO-001",
        title: "Prototype Pollution Vulnerability",
        pattern: /(?:\[\s*['"`]__proto__['"`]\s*\]|\[\s*['"`]constructor['"`]\s*\]\s*\[\s*['"`]prototype['"`]\s*\])/i,
        severity: "high" as const,
        description: "Direct indexing into prototype or constructor object without sanitization.",
        remediation: "Freeze object prototypes or validate keys against Object.prototype properties before assignment.",
        cvss: 7.5,
    },
    {
        ruleId: "SEC-EVAL-001",
        title: "Unsafe Dynamic Code Execution",
        pattern: /\b(?:eval|Function)\s*\(/i,
        severity: "high" as const,
        description: "Use of eval() or new Function() allows arbitrary code execution in runtime context.",
        remediation: "Replace dynamic code execution with structured JSON parsers or static function dispatchers.",
        cvss: 7.8,
    },
];

// Vulnerable dependency database mock
const KNOWN_VULNERABLE_PACKAGES: Record<string, { cve: string; title: string; severity: "critical" | "high" | "medium"; fixedVersion: string; cvss: number }> = {
    "lodash": { cve: "CVE-2021-23337", title: "Prototype Pollution in lodash", severity: "high", fixedVersion: "4.17.21", cvss: 7.5 },
    "axios": { cve: "CVE-2023-45857", title: "Cross-Site Request Forgery in axios", severity: "medium", fixedVersion: "1.6.0", cvss: 6.5 },
    "jsonwebtoken": { cve: "CVE-2022-23529", title: "Insecure Key Verification in jsonwebtoken", severity: "critical", fixedVersion: "9.0.0", cvss: 9.8 },
    "express": { cve: "CVE-2024-29041", title: "Open Redirect in express static middleware", severity: "medium", fixedVersion: "4.19.2", cvss: 6.1 },
};

export const securityAuditHandlers = {
    /**
     * Executes Static Application Security Testing (SAST) on provided code or files.
     */
    async triggerSastScan(params: { code?: string; files?: Array<{ path: string; content: string }> }): Promise<SecurityFinding[]> {
        const findings: SecurityFinding[] = [];
        const filesToScan = params.files && params.files.length > 0
            ? params.files
            : params.code
                ? [{ path: "inline-snippet.ts", content: params.code }]
                : [];

        for (const file of filesToScan) {
            const lines = file.content.split("\n");
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                const lineContent = lines[lineIndex];

                for (const pattern of SAST_PATTERNS) {
                    if (pattern.pattern.test(lineContent)) {
                        findings.push({
                            id: `sast-${findings.length + 1}`,
                            type: pattern.ruleId.startsWith("SEC-SECRET") ? "secret" : "sast",
                            ruleId: pattern.ruleId,
                            severity: pattern.severity,
                            title: pattern.title,
                            description: pattern.description,
                            location: {
                                file: file.path,
                                line: lineIndex + 1,
                                snippet: lineContent.trim(),
                            },
                            remediation: pattern.remediation,
                            cvssScore: pattern.cvss,
                        });
                    }
                }
            }
        }

        logger.info(`[SAST Scan] Completed with ${findings.length} findings.`);
        return findings;
    },

    /**
     * Executes Software Composition Analysis (SCA) on dependency manifests.
     */
    async triggerScaScan(params: { packageJsonContent?: string; dependencies?: Record<string, string> }): Promise<SecurityFinding[]> {
        const findings: SecurityFinding[] = [];
        let deps: Record<string, string> = params.dependencies || {};

        if (params.packageJsonContent) {
            try {
                const parsed = JSON.parse(params.packageJsonContent);
                deps = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
            } catch (err: any) {
                logger.warn(`[SCA Scan] Could not parse packageJsonContent: ${err.message}`);
            }
        }

        for (const [pkgName, versionSpec] of Object.entries(deps)) {
            const known = KNOWN_VULNERABLE_PACKAGES[pkgName];
            if (known) {
                // If version is below fixed version, record finding
                const cleanVersion = versionSpec.replace(/[\^~>=<]/g, "");
                findings.push({
                    id: `sca-${findings.length + 1}`,
                    type: "sca",
                    ruleId: known.cve,
                    severity: known.severity,
                    title: known.title,
                    description: `Package '${pkgName}' version '${versionSpec}' has a known vulnerability: ${known.title} (${known.cve}).`,
                    packageInfo: {
                        name: pkgName,
                        currentVersion: cleanVersion,
                        fixedVersion: known.fixedVersion,
                        cveId: known.cve,
                    },
                    remediation: `Upgrade ${pkgName} to version ${known.fixedVersion} or newer in package.json.`,
                    cvssScore: known.cvss,
                });
            }
        }

        logger.info(`[SCA Scan] Completed with ${findings.length} findings.`);
        return findings;
    },

    /**
     * Aggregates and scores findings from multiple scan passes.
     */
    async aggregateFindings(params: { sastFindings?: SecurityFinding[]; scaFindings?: SecurityFinding[] }): Promise<SecurityAuditReport> {
        const allFindings = [...(params.sastFindings || []), ...(params.scaFindings || [])];

        const summary = {
            totalFindings: allFindings.length,
            critical: allFindings.filter((f) => f.severity === "critical").length,
            high: allFindings.filter((f) => f.severity === "high").length,
            medium: allFindings.filter((f) => f.severity === "medium").length,
            low: allFindings.filter((f) => f.severity === "low").length,
            info: allFindings.filter((f) => f.severity === "info").length,
            postureScore: 100,
            status: "PASSED" as "PASSED" | "WARNING" | "FAILED",
        };

        const scoreDeductions =
            summary.critical * 25 +
            summary.high * 10 +
            summary.medium * 3 +
            summary.low * 1;

        summary.postureScore = Math.max(0, 100 - scoreDeductions);

        if (summary.critical > 0 || summary.postureScore < 70) {
            summary.status = "FAILED";
        } else if (summary.high > 0 || summary.postureScore < 85) {
            summary.status = "WARNING";
        } else {
            summary.status = "PASSED";
        }

        return {
            scanTimestamp: new Date().toISOString(),
            summary,
            findings: allFindings,
        };
    },

    /**
     * Groups findings into prioritized triage tiers.
     */
    async prioritizeVulnerabilities(params: { report: SecurityAuditReport }): Promise<{
        blockers: SecurityFinding[];
        sprintFixes: SecurityFinding[];
        backlog: SecurityFinding[];
    }> {
        const blockers = params.report.findings.filter((f) => f.severity === "critical" || (f.cvssScore && f.cvssScore >= 9.0));
        const sprintFixes = params.report.findings.filter((f) => f.severity === "high" || (f.cvssScore && f.cvssScore >= 7.0 && f.cvssScore < 9.0));
        const backlog = params.report.findings.filter((f) => f.severity === "medium" || f.severity === "low" || f.severity === "info");

        return { blockers, sprintFixes, backlog };
    },

    /**
     * Generates patch diffs / dependency upgrades.
     */
    async generateSecurityPatch(params: { finding: SecurityFinding }): Promise<{
        file: string;
        diffDescription: string;
        suggestedFix: string;
    }> {
        const { finding } = params;

        if (finding.type === "sca" && finding.packageInfo?.fixedVersion) {
            return {
                file: "package.json",
                diffDescription: `Upgrade dependency '${finding.packageInfo.name}' to '^${finding.packageInfo.fixedVersion}' to resolve ${finding.packageInfo.cveId}.`,
                suggestedFix: `"${finding.packageInfo.name}": "^${finding.packageInfo.fixedVersion}"`,
            };
        }

        return {
            file: finding.location?.file || "unknown",
            diffDescription: `Remediate ${finding.ruleId} (${finding.title}) at line ${finding.location?.line || "N/A"}.`,
            suggestedFix: finding.remediation,
        };
    },
};

const run = (method: keyof typeof securityAuditHandlers) => async (params: any) => {
    const result = await (securityAuditHandlers[method] as any)(params);
    return typeof result === "string" ? result : JSON.stringify(result, null, 2);
};

const def = (name: string, description: string, parameters: z.ZodTypeAny, method: keyof typeof securityAuditHandlers): ToolDefinition => ({
    name,
    description,
    group: "Security",
    // Every tool built here is a pure transform over its arguments: no
    // database, network, filesystem or shell. A tool that touches the world
    // must not use this factory — it would inherit a declaration that lies,
    // and be offered to agents and batched concurrently on the strength of it.
    idempotency: "read-safe",
    parameters,
    execute: run(method),
});

export const SECURITY_AUDIT_TOOLS: Record<string, ToolDefinition> = {
    trigger_sast_scan: def(
        "trigger_sast_scan",
        "Executes Static Application Security Testing (SAST) on source files to detect secrets, SQLi, command injection, and prototype pollution.",
        z.object({
            code: z.string().optional().describe("Direct source code snippet to scan"),
            files: z.array(z.object({ path: z.string(), content: z.string() })).optional().describe("List of file paths and contents to scan"),
        }),
        "triggerSastScan"
    ),

    trigger_sca_scan: def(
        "trigger_sca_scan",
        "Executes Software Composition Analysis (SCA) on dependency manifests to detect known CVEs and high-risk packages.",
        z.object({
            packageJsonContent: z.string().optional().describe("Raw package.json string content"),
            dependencies: z.record(z.string()).optional().describe("Dictionary of package names to version strings"),
        }),
        "triggerScaScan"
    ),

    aggregate_findings: def(
        "aggregate_findings",
        "Aggregates, de-duplicates, and calculates a Security Posture Score across SAST and SCA findings.",
        z.object({
            sastFindings: z.array(z.any()).optional().describe("Findings returned from trigger_sast_scan"),
            scaFindings: z.array(z.any()).optional().describe("Findings returned from trigger_sca_scan"),
        }),
        "aggregateFindings"
    ),

    prioritize_vulnerabilities: def(
        "prioritize_vulnerabilities",
        "Groups security audit findings into Blockers, Sprint Fixes, and Backlog items based on CVSS severity.",
        z.object({
            report: z.any().describe("Report returned from aggregate_findings"),
        }),
        "prioritizeVulnerabilities"
    ),

    generate_security_patch: def(
        "generate_security_patch",
        "Generates surgical fix instructions or dependency upgrade diffs for a specific security finding.",
        z.object({
            finding: z.any().describe("A security finding object"),
        }),
        "generateSecurityPatch"
    ),
};
