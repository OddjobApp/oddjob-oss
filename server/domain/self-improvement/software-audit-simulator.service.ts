import { createLogger } from "@server/utils/logger.js";
import { EvaluationResult } from "@shared/schema/index.js";
import { validateProposalChange } from "./proposal-heuristics.js";

const logger = createLogger("SoftwareAuditSimulatorService");

// A compliance/audit change should introduce at least one of these in actual
// code (comments/strings are stripped before matching).
const AUDIT_PATTERNS = [
  /\bsast\b/i, /\bscan\b/i, /vulnerab/i, /\baudit\b/i,
  /\bpolicy\b/i, /compliance/i, /\bowasp\b/i, /\blint\b/i,
];

export class SoftwareAuditSimulatorService {
  /**
   * Statically validates a software-audit harness change and emits an
   * EvaluationResult. Deterministic gate (not a real audit run): a PROPOSED
   * change must be syntactically valid and introduce a security/compliance
   * construct in code; baseline versions are the reference point. Validation
   * that cannot run fails closed.
   */
  async simulateAudit(harnessId: string, harnessVersion: string, scenario: any): Promise<EvaluationResult> {
    logger.info(`Simulating software audit for harness ${harnessId}@${harnessVersion} with scenario: ${JSON.stringify(scenario)}`);

    const check = await validateProposalChange(harnessVersion, AUDIT_PATTERNS, {
      code: 'SIM_AUDIT_FAILURE',
      message: 'Proposed change lacks security/compliance constructs in code (e.g. SAST/scan triggers, OWASP/vulnerability checks, audit policy or lint rules).',
    });
    const isCompliant = check.ok;
    const failureReason: any = check.reason ?? null;

    // Deterministic metrics derived from the outcome (reproducible — no randomness).
    const criticalVulnerabilities = isCompliant ? 0 : 6;
    const codeQualityScore = isCompliant ? 92 : 55;

    const status = isCompliant ? 'pass' : 'fail';

    const result: EvaluationResult = {
      id: 0,
      // Unattributed draft: the simulator does not know the tenant. The caller
      // that persists this stamps the real organization before insert.
      organizationId: null,
      harnessId: harnessId,
      harnessVersion: harnessVersion,
      timestamp: new Date(),
      status: status,
      metrics: { critical_vulnerabilities: criticalVulnerabilities, code_quality_score: codeQualityScore },
      traceId: `sim-audit-trace-${Date.now()}`,
      failureReason: failureReason,
    };

    logger.info(`Simulation complete for ${harnessId}@${harnessVersion}. Result: ${status}`);
    return result;
  }
}
