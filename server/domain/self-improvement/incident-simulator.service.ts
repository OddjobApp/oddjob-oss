import { createLogger } from "@server/utils/logger.js";
import { EvaluationResult } from "@shared/schema/index.js";
import { validateProposalChange } from "./proposal-heuristics.js";

const logger = createLogger("IncidentSimulatorService");

// A resilient incident-response change should introduce at least one of these in
// actual code (comments/strings are stripped before matching).
const RESILIENCE_PATTERNS = [
  /\bretry\b/i, /backoff/i, /\bpool\b/i, /reconnect/i,
  /\bhealth ?check\b/i, /\bmonitor\b/i, /circuit ?breaker/i, /\btimeout\b/i,
];

export class IncidentSimulatorService {
  /**
   * Statically validates an incident-response harness change and emits an
   * EvaluationResult. This is a deterministic gate (not a runtime chaos
   * simulation): a PROPOSED change must be syntactically valid and introduce a
   * resilience construct in code; baseline versions are the reference point.
   * Validation that cannot run fails closed.
   * @param harnessId The ID of the harness to simulate.
   * @param harnessVersion The version of the harness to simulate.
   * @param scenario A description or ID of the incident scenario to simulate.
   * @returns A simulated EvaluationResult.
   */
  async simulateIncident(harnessId: string, harnessVersion: string, scenario: any): Promise<EvaluationResult> {
    logger.info(`Simulating incident for harness ${harnessId}@${harnessVersion} with scenario: ${JSON.stringify(scenario)}`);

    const check = await validateProposalChange(harnessVersion, RESILIENCE_PATTERNS, {
      code: 'SIM_FAILURE',
      message: 'Proposed change lacks resilience constructs in code (e.g. retry/backoff, connection pool limits, reconnect, health-check/monitoring, circuit-breaker, or timeout handling).',
    });
    const isSuccess = check.ok;
    const failureReason: any = check.reason ?? null;

    // Deterministic metrics derived from the outcome (reproducible — no randomness).
    const mttr = isSuccess ? 25 : 90;
    const humanIntervention = isSuccess ? 1 : 4;

    const status = isSuccess ? 'pass' : 'fail';

    const result: EvaluationResult = {
      id: 0, // Will be set by DB insert
      // Unattributed draft: the simulator does not know the tenant. The caller
      // that persists this stamps the real organization before insert.
      organizationId: null,
      harnessId: harnessId,
      harnessVersion: harnessVersion,
      timestamp: new Date(),
      status: status,
      metrics: { mttr_minutes: mttr, human_intervention_count: humanIntervention },
      traceId: `sim-trace-${Date.now()}`,
      failureReason: failureReason,
    };

    logger.info(`Simulation complete for ${harnessId}@${harnessVersion}. Result: ${status}`);
    return result;
  }
}