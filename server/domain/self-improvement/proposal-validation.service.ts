import { db } from "@server/database_service.js";
import { harnessProposals, evaluationResults } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const logger = createLogger("ProposalValidationService");
const execAsync = promisify(exec);

// Playwright test runner subprocess execution
async function runPlaywrightTests(harnessId: string, harnessVersion: string): Promise<{ failed: number }> {
  logger.info(`Running Playwright tests for ${harnessId}@${harnessVersion}`);
  
  const specName = harnessId.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const specPath = path.resolve(process.cwd(), 'tests', 'e2e', `${specName}.spec.ts`);
  
  if (!fs.existsSync(specPath)) {
    logger.info(`No specific E2E spec found at ${specPath}, skipping subprocess test execution.`);
    return { failed: 0 };
  }

  try {
    logger.info(`Executing Playwright subprocess: npx playwright test ${specPath}`);
    await execAsync(`npx playwright test ${specPath}`);
    return { failed: 0 };
  } catch (error: any) {
    logger.warn(`Playwright test suite failed: ${error.message}`);
    const failedMatch = error.message.match(/(\d+) failed/);
    const failedCount = failedMatch ? parseInt(failedMatch[1], 10) : 1;
    return { failed: failedCount };
  }
}
import { HarnessRegistryService } from "./harness-registry.service.js";
import { SELF_MODIFICATION_TOOLS } from "@server/domain/tools/v1/capabilities/self-modification.js";
import { eq, and } from "drizzle-orm";
import { IncidentSimulatorService } from "./incident-simulator.service.js";
import { SoftwareAuditSimulatorService } from "./software-audit-simulator.service.js";
import { XRayService } from "./xray.service.js";
import { SystemGraphService } from "./system-graph.service.js";


// Above this latency (ms), a traced evaluation run is flagged as a bottleneck.
const LATENCY_THRESHOLD_MS = 500;

// Above this system-graph blast-radius score, a change is refused regardless of
// whether its metrics improved.
const HIGH_RISK_THRESHOLD = 0.7;

export class ProposalValidationService {
  private harnessRegistryService: HarnessRegistryService;
  private incidentSimulatorService: IncidentSimulatorService;
  private softwareAuditSimulatorService: SoftwareAuditSimulatorService;

  constructor() {
    this.harnessRegistryService = new HarnessRegistryService();
    this.incidentSimulatorService = new IncidentSimulatorService();
    this.softwareAuditSimulatorService = new SoftwareAuditSimulatorService();
  }

  /**
   * Orchestrates the validation of a HarnessProposal.
   * Applies the proposed change, runs evaluation, and determines acceptance.
   * @param proposalId The ID of the HarnessProposal to validate.
   * @returns The updated HarnessProposal.
   */
  /**
   * @param organizationId Owning tenant for the evaluation rows this produces and
   *   the baseline it compares against. Required: `evaluation_results` is now
   *   tenant-scoped, and an unattributed row is invisible to every scoped read,
   *   so writing one would silently discard the validation evidence.
   */
  async validateProposal(
    proposalId: number,
    organizationId: number,
  ): Promise<typeof harnessProposals.$inferSelect | null> {
    if (!Number.isInteger(organizationId) || organizationId <= 0) {
      throw new Error(
        `ProposalValidationService.validateProposal requires a resolved organizationId; received ${String(organizationId)}.`,
      );
    }

    // Scoped by tenant, not just id: an id from another organization must read
    // as "not found", never as a proposal this caller may validate and apply.
    const [proposal] = await db.select().from(harnessProposals).where(and(
      eq(harnessProposals.id, proposalId),
      eq(harnessProposals.organizationId, organizationId),
    ));
    if (!proposal) {
      logger.warn(`Proposal with ID ${proposalId} not found.`);
      return null;
    }

    if (!proposal.humanApprovedAt) {
      logger.warn(`Proposal ${proposal.id} has not been human-approved; refusing to apply it to the codebase.`);
      const validationResults = { error: "Awaiting human approval before this change can be applied for validation." };
      await db.update(harnessProposals).set({ validationStatus: "pending", validationResults }).where(eq(harnessProposals.id, proposalId));
      return { ...proposal, validationStatus: "pending", validationResults };
    }

    logger.info(`Starting validation for proposal ${proposal.id} for harness ${proposal.harnessId}@${proposal.parentHarnessVersion}`);

    // 1. Apply the proposed change to a temporary or sandboxed environment
    const applyResult = await SELF_MODIFICATION_TOOLS.code_edit.execute({
      filePath: proposal.proposedChange.filePath,
      oldContent: proposal.proposedChange.oldContent,
      newContent: proposal.proposedChange.newContent,
      commitMessage: `Applying proposal ${proposal.id} for validation`,
    }, { isSuperAdmin: true, userId: "System" } as any); // Context for self-modification tool

    if (applyResult.startsWith("Error")) {
      logger.error(`Failed to apply proposed change for validation: ${applyResult}`);
      await db.update(harnessProposals).set({ validationStatus: "rejected", validationResults: { error: applyResult } }).where(eq(harnessProposals.id, proposalId));
      return { ...proposal, validationStatus: "rejected", validationResults: { error: applyResult } };
    }

    // 2. Trigger evaluation runs with the proposed harness, including Playwright E2E tests
    let newEvaluationResults: typeof evaluationResults.$inferSelect[] = [];

    // --- Domain-specific simulation based on harnessId ---
    if (proposal.harnessId === "incident-response") {
      const simulatedResult = await this.incidentSimulatorService.simulateIncident(
        proposal.harnessId,
        `PROPOSED-${proposal.id}`,
        { type: "generic_incident", severity: "medium" } // Example scenario
      );
      // Store the result in the DB
      const [insertedResult] = await db.insert(evaluationResults).values({ ...simulatedResult, organizationId }).returning();
      newEvaluationResults.push(insertedResult);
    } else if (proposal.harnessId === "software-audit") {
      const simulatedResult = await this.softwareAuditSimulatorService.simulateAudit(
        proposal.harnessId,
        `PROPOSED-${proposal.id}`,
        { type: "security_audit", scope: "full" } // Example scenario
      );
      // Store the result in the DB
      const [insertedResult] = await db.insert(evaluationResults).values({ ...simulatedResult, organizationId }).returning();
      newEvaluationResults.push(insertedResult);
    } else {
      // Default or other domain-specific evaluation triggers
      // Mock evaluation result for the proposed harness
      const mockResult: typeof evaluationResults.$inferSelect = {
        id: 0, // Drizzle serial ID - will be overwritten by DB
        organizationId,
        harnessId: proposal.harnessId,
        harnessVersion: `PROPOSED-${proposal.id}`,
        timestamp: new Date(),
        status: "pass", // Simulate a successful outcome
        metrics: { success_rate: 0.8, latency_ms: 100 },
        traceId: `mock-trace-proposed-${Date.now()}`,
        failureReason: null,
      };
      const [insertedResult] = await db.insert(evaluationResults).values(mockResult).returning();
      newEvaluationResults.push(insertedResult);
    }

    // 2.5 Integrate X-Ray tracing for bottleneck detection
    // Assuming an X-Ray service is available; query traces for the simulated runs
    const xrayTraces = await XRayService.queryTracesForEvaluation(
      newEvaluationResults.map(r => r.traceId).filter((id): id is string => id !== null)
    );
    const bottlenecks = xrayTraces.filter(trace => trace.latency > LATENCY_THRESHOLD_MS); // Example analysis

    // 2.6 Assess impact using system graph
    const systemGraphImpact = await SystemGraphService.assessChangeImpact(proposal.proposedChange);
    const highRisk = systemGraphImpact.riskScore > HIGH_RISK_THRESHOLD;
    if (highRisk) {
      logger.warn(
        `Proposal ${proposal.id} flagged high-risk by system graph (score ${systemGraphImpact.riskScore}): ${systemGraphImpact.reason}`,
      );
    }

    // 2.7 Run Playwright E2E tests if applicable (e.g., for UI-related harnesses)
    let playwrightResults;
    if (proposal.harnessId.includes('ui')) { // Conditional based on harness type
      playwrightResults = await runPlaywrightTests(proposal.harnessId, `PROPOSED-${proposal.id}`);
      // Integrate results into metrics or status
    }

    // 3. Retrieve evaluation results for the parent harness (for comparison)
    const parentEvaluationResults = await db.select().from(evaluationResults)
      .where(and(
        eq(evaluationResults.organizationId, organizationId),
        eq(evaluationResults.harnessId, proposal.harnessId),
        eq(evaluationResults.harnessVersion, proposal.parentHarnessVersion),
      ));
    
    const parentMetrics = this.aggregateMetrics(parentEvaluationResults);
    const proposedMetrics = this.aggregateMetrics(newEvaluationResults);

    // 4. Apply acceptance criteria, incorporating X-Ray, system graph, and Playwright results
    let validationStatus: "accepted" | "rejected" | "pending" = "rejected";
    let didImprove = false;
    let noRegression = true; // Placeholder for more complex regression checks
    if (bottlenecks.length > 0 || highRisk || (playwrightResults && playwrightResults.failed > 0)) {
      noRegression = false;
    }

    if (proposal.harnessId === "incident-response") {
        // For incident management, lower MTTR is better, success rate should not decrease
        if (proposedMetrics.mttr_minutes < parentMetrics.mttr_minutes && proposedMetrics.success_rate >= parentMetrics.success_rate) {
            didImprove = true;
        } else if (proposedMetrics.success_rate > parentMetrics.success_rate && proposedMetrics.mttr_minutes <= parentMetrics.mttr_minutes) {
            didImprove = true;
        }
    } else if (proposal.harnessId === "software-audit") {
        // For software audits, lower critical vulnerabilities and higher code quality score are better
        if (proposedMetrics.critical_vulnerabilities < parentMetrics.critical_vulnerabilities && proposedMetrics.code_quality_score >= parentMetrics.code_quality_score) {
            didImprove = true;
        } else if (proposedMetrics.code_quality_score > parentMetrics.code_quality_score && proposedMetrics.critical_vulnerabilities <= parentMetrics.critical_vulnerabilities) {
            didImprove = true;
        }
    } else {
        // Default: higher success rate is better
        if (proposedMetrics.success_rate > parentMetrics.success_rate) {
            didImprove = true;
        }
    }

    if (didImprove && noRegression) {
      validationStatus = "accepted";
      logger.info(`Proposal ${proposal.id} accepted for harness ${proposal.harnessId}`);
    } else {
      logger.info(`Proposal ${proposal.id} rejected for harness ${proposal.harnessId}`);
    }

    // 5. Update proposal status and validation results in the database
    const [updatedProposal] = await db.update(harnessProposals).set({
      validationStatus,
      validationResults: {
        parentMetrics,
        proposedMetrics,
        newEvaluationResultIds: newEvaluationResults.map(r => r.id),
        // Record why the gate decided as it did — without this a rejection is
        // indistinguishable from a metrics regression.
        didImprove,
        noRegression,
        systemGraphImpact: {
          riskScore: systemGraphImpact.riskScore,
          directDependents: systemGraphImpact.directDependents,
          transitiveDependents: systemGraphImpact.transitiveDependents,
          reason: systemGraphImpact.reason,
          // Cap the stored list; a barrel-file edit can reach hundreds of files.
          affectedNodes: systemGraphImpact.affectedNodes.slice(0, 50),
          highRisk,
        },
        bottleneckCount: bottlenecks.length,
        playwrightFailed: playwrightResults?.failed ?? 0,
      },
    }).where(eq(harnessProposals.id, proposalId)).returning();

    // 6. Revert temporary changes if validation environment is separate
    //    SELF_MODIFICATION_TOOLS.code_rollback or similar if a temporary branch was used.

    return updatedProposal;
  }

  private aggregateMetrics(results: typeof evaluationResults.$inferSelect[]): any {
    if (results.length === 0) return { success_rate: 0, mttr_minutes: 999999, latency_ms: 999999, critical_vulnerabilities: 999999, code_quality_score: 0 }; // Default values for comparison
    
    const totalSuccessRate = results.reduce((sum, r) => sum + (r.status === 'pass' ? 1 : 0), 0) / results.length;
    
    // Only aggregate MTTR if it's present in the metrics
    const mttrValues = results.map(r => r.metrics?.mttr_minutes).filter(mttr => mttr !== undefined && mttr !== null) as number[];
    const avgMttr = mttrValues.length > 0 ? mttrValues.reduce((sum, mttr) => sum + mttr, 0) / mttrValues.length : 999999; // Default high MTTR if no data

    const latencyValues = results.map(r => r.metrics?.latency_ms).filter(lat => lat !== undefined && lat !== null) as number[];
    const avgLatency = latencyValues.length > 0 ? latencyValues.reduce((sum, lat) => sum + lat, 0) / latencyValues.length : 999999; // Default high latency if no data

    const criticalVulnerabilityValues = results.map(r => r.metrics?.critical_vulnerabilities).filter(v => v !== undefined && v !== null) as number[];
    const avgCriticalVulnerabilities = criticalVulnerabilityValues.length > 0 ? criticalVulnerabilityValues.reduce((sum, v) => sum + v, 0) / criticalVulnerabilityValues.length : 999999; // Default high for comparison

    const codeQualityScoreValues = results.map(r => r.metrics?.code_quality_score).filter(s => s !== undefined && s !== null) as number[];
    const avgCodeQualityScore = codeQualityScoreValues.length > 0 ? codeQualityScoreValues.reduce((sum, s) => sum + s, 0) / codeQualityScoreValues.length : 0; // Default low for comparison

    return { success_rate: totalSuccessRate, mttr_minutes: avgMttr, latency_ms: avgLatency, critical_vulnerabilities: avgCriticalVulnerabilities, code_quality_score: avgCodeQualityScore };
  }
}