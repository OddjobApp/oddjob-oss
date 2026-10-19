/**
 * Agentic Consensus Matrix (Extension 1 — change_plan phase)
 *
 * Expands single-pass plan generation into a deterministic 3-agent critique:
 *   - Architect Agent        — owns the drafted operations.
 *   - Security/Performance    — audits the diffed code for token/secret leaks,
 *                               vulnerability patterns, and risky dependencies.
 *   - Refiner Agent           — compiles the matrix, records which security-
 *                               critical structures are targeted, and decides
 *                               whether human review must be forced.
 *
 * The human-review flip is gated on *concrete findings* in the new code (a
 * high/critical vulnerability or a leaked secret), not merely a security-
 * sounding file path — a benign edit to `src/auth.ts` should not, by itself,
 * force review. Targeted security-critical structures are still recorded as
 * audit telemetry in `refinerDecision.securityCriticalStructuresTargeted`.
 *
 * Pure, deterministic domain logic — no LLM calls (mirrors the planner).
 */

import type {
  FileOperation,
  DetectedConventions,
  ConsensusMatrix,
  ConsensusAgent,
  SecurityAudit,
  ConsensusSeverity,
} from "../core/types.js";

// Model ids reflect the platform's Gemini-first policy.
const MODEL_PREMIUM = "gemini-1.5-pro";
const MODEL_STANDARD = "gemini-1.5-flash";

// Paths whose modification is recorded as touching a security-critical structure.
const SECURITY_CRITICAL_PATH_RE =
  /(^|[/\\])(auth|security|credentials?|secrets?|permissions?|rbac|acl|session|oauth|jwt|crypto|payment|billing|middleware)([/\\._-]|$)|\.env(\.|$)/i;

// Vulnerability patterns matched against the *new* code of each operation.
const VULN_PATTERNS: Array<{
  re: RegExp;
  description: string;
  cwe: string;
  severity: ConsensusSeverity;
}> = [
  { re: /\beval\s*\(/, description: "eval() enables arbitrary code execution", cwe: "CWE-95", severity: "critical" },
  { re: /new\s+Function\s*\(/, description: "Function constructor executes arbitrary code", cwe: "CWE-95", severity: "high" },
  { re: /child_process|\bexecSync?\s*\(|\bspawnSync?\s*\(/, description: "Shell/process execution surface", cwe: "CWE-78", severity: "high" },
  { re: /dangerouslySetInnerHTML/, description: "Raw HTML injection (XSS vector)", cwe: "CWE-79", severity: "medium" },
  { re: /\b(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,80}?["'`]\s*\+/i, description: "Possible SQL string concatenation", cwe: "CWE-89", severity: "high" },
  { re: /\.innerHTML\s*=/, description: "Direct innerHTML assignment (XSS vector)", cwe: "CWE-79", severity: "medium" },
];

// Hard-coded secret / token assignment patterns.
const SECRET_ASSIGN_RE =
  /(api[_-]?key|secret|access[_-]?token|client[_-]?secret|password|passwd|private[_-]?key|bearer)\s*[:=]\s*["'][^"'\n]{6,}["']/i;

// Risky module imports recorded as dependency risks.
const RISKY_DEPENDENCIES: Array<{ re: RegExp; reason: string; severity: ConsensusSeverity }> = [
  { re: /require\(\s*["']vm["']\s*\)|from\s+["']vm["']/, reason: "Node vm module can execute untrusted code", severity: "high" },
  { re: /require\(\s*["']child_process["']\s*\)|from\s+["']child_process["']/, reason: "child_process exposes shell execution", severity: "high" },
  { re: /import\s*\(\s*`[^`]*\$\{/, reason: "Dynamic import with interpolated specifier", severity: "medium" },
];

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function severityPenalty(sev: ConsensusSeverity): number {
  switch (sev) {
    case "critical": return 0.3;
    case "high": return 0.2;
    case "medium": return 0.1;
    case "low": return 0.05;
  }
}

/** Concatenate the new code an operation introduces (create + modify diffs). */
function operationCode(op: FileOperation): string {
  const parts: string[] = [];
  if (op.newContent) parts.push(op.newContent);
  if (op.changes) for (const c of op.changes) parts.push(c.newCode);
  return parts.join("\n");
}

function auditSecurity(operations: FileOperation[]): {
  securityAudit: SecurityAudit;
  severities: ConsensusSeverity[];
} {
  const audit: SecurityAudit = {
    tokenLeakFindings: [],
    vulnerabilityPatterns: [],
    dependencyRisks: [],
  };
  const severities: ConsensusSeverity[] = [];

  for (const op of operations) {
    const code = operationCode(op);
    if (!code.trim()) continue;

    if (SECRET_ASSIGN_RE.test(code)) {
      audit.tokenLeakFindings.push({
        location: op.filePath,
        severity: "critical",
        description: "Hard-coded secret/token literal detected in generated code",
      });
      severities.push("critical");
    }

    for (const vp of VULN_PATTERNS) {
      if (vp.re.test(code)) {
        audit.vulnerabilityPatterns.push({
          pattern: vp.description,
          cwe: vp.cwe,
          filePath: op.filePath,
          severity: vp.severity,
        });
        severities.push(vp.severity);
      }
    }

    for (const dep of RISKY_DEPENDENCIES) {
      if (dep.re.test(code)) {
        audit.dependencyRisks.push({
          dependency: op.filePath,
          reason: dep.reason,
          severity: dep.severity,
        });
        severities.push(dep.severity);
      }
    }
  }

  return { securityAudit: audit, severities };
}

export interface ConsensusResult {
  consensusMatrix: ConsensusMatrix;
  /** True when concrete high/critical findings should force human review. */
  humanReviewTriggered: boolean;
}

/**
 * Run the 3-agent critique over a drafted operation set and produce the
 * consensus matrix plus the human-review decision.
 */
export function buildConsensusMatrix(
  operations: FileOperation[],
  _conventions: DetectedConventions,
  objective: string
): ConsensusResult {
  const opCounts = operations.reduce<Record<string, number>>((acc, op) => {
    acc[op.type] = (acc[op.type] ?? 0) + 1;
    return acc;
  }, {});
  const countSummary = Object.entries(opCounts)
    .map(([type, n]) => `${n} ${type}`)
    .join(", ") || "no operations";

  const { securityAudit, severities } = auditSecurity(operations);

  const securityCriticalStructuresTargeted = operations
    .filter((op) => SECURITY_CRITICAL_PATH_RE.test(op.filePath))
    .map((op) => op.filePath);

  const dissentCount = severities.filter((s) => s === "high" || s === "critical").length;
  const humanReviewTriggered = dissentCount > 0;

  const consensusScore = clamp01(
    1 - severities.reduce((sum, s) => sum + severityPenalty(s), 0)
  );

  const triggerReasons: string[] = [];
  if (humanReviewTriggered) {
    for (const f of securityAudit.tokenLeakFindings) {
      triggerReasons.push(`${f.severity}: ${f.description} (${f.location})`);
    }
    for (const f of securityAudit.vulnerabilityPatterns) {
      if (f.severity === "high" || f.severity === "critical") {
        triggerReasons.push(`${f.severity}: ${f.pattern} (${f.filePath})`);
      }
    }
    for (const f of securityAudit.dependencyRisks) {
      if (f.severity === "high" || f.severity === "critical") {
        triggerReasons.push(`${f.severity}: ${f.reason} (${f.dependency})`);
      }
    }
  }

  const securityFindingsCount =
    securityAudit.tokenLeakFindings.length +
    securityAudit.vulnerabilityPatterns.length +
    securityAudit.dependencyRisks.length;

  const agents: ConsensusAgent[] = [
    {
      role: "architect",
      model: MODEL_PREMIUM,
      confidence: operations.length > 0 ? 0.85 : 0.5,
      findings: [
        `Drafted plan for objective "${objective.slice(0, 80)}": ${countSummary}.`,
      ],
      durationMs: 0,
    },
    {
      role: "security_performance",
      model: MODEL_STANDARD,
      confidence: clamp01(1 - 0.15 * severities.length) || 0.3,
      findings:
        securityFindingsCount > 0
          ? [
              ...securityAudit.tokenLeakFindings.map((f) => `Token leak: ${f.description} (${f.location})`),
              ...securityAudit.vulnerabilityPatterns.map((f) => `Vulnerability: ${f.pattern} (${f.filePath})`),
              ...securityAudit.dependencyRisks.map((f) => `Dependency risk: ${f.reason} (${f.dependency})`),
            ]
          : ["No token leaks, vulnerability patterns, or risky dependencies detected."],
      durationMs: 0,
    },
    {
      role: "refiner",
      model: MODEL_PREMIUM,
      confidence: consensusScore,
      findings: [
        `Consensus score ${consensusScore.toFixed(2)}; human review ${humanReviewTriggered ? "required" : "not required"}.`,
        securityCriticalStructuresTargeted.length > 0
          ? `Targets ${securityCriticalStructuresTargeted.length} security-critical structure(s).`
          : "No security-critical structures targeted.",
      ],
      durationMs: 0,
    },
  ];

  const consensusMatrix: ConsensusMatrix = {
    iterations: 3,
    architectDraftId: "architect-draft",
    agents,
    securityAudit,
    refinerDecision: {
      finalizedBy: "refiner",
      humanReviewTriggered,
      triggerReasons,
      securityCriticalStructuresTargeted,
    },
    consensusScore,
    dissentCount,
  };

  return { consensusMatrix, humanReviewTriggered };
}

/**
 * Calculates epistemic model ambiguity and consensus divergence across multi-agent model critiques.
 */
export function calculateModelDivergence(matrix: ConsensusMatrix): {
  epistemicAmbiguityScore: number;
  modelAgreementPct: number;
  dissentCount: number;
  requiresGqeAttestation: boolean;
} {
  const epistemicAmbiguityScore = Number((1.0 - matrix.consensusScore).toFixed(2));
  const modelAgreementPct = Math.round(matrix.consensusScore * 100);
  const requiresGqeAttestation = epistemicAmbiguityScore > 0.35 || matrix.refinerDecision.humanReviewTriggered;

  return {
    epistemicAmbiguityScore,
    modelAgreementPct,
    // Optional on ConsensusMatrix; absent means nothing dissented.
    dissentCount: matrix.dissentCount ?? 0,
    requiresGqeAttestation,
  };
}

