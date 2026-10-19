/**
 * Performance Evaluation Jobs
 *
 * Scheduled jobs for daily agent performance evaluation and automated actions.
 */

import { performanceManagerService } from "./performance-manager.service.js";
import { governanceService } from "@server/domain/governor/core/governance.service.js";
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@server/domain/core/infrastructure/event-stream.service.js";
import { db } from "@server/database_service.js";
import { missionRuns } from "@shared/schema/missions/runs.js";
import { missionAgentAssignments } from "@shared/schema/mission-agent-assignments.js";
import { eq, and, desc } from "drizzle-orm";

const logger = createLogger("PerformanceJobs");

/**
 * The evidence an agent is evaluated on: its mission runs, with what they cost.
 *
 * Everything here is measured. That is worth stating because the previous version
 * was not: it stamped `cost: 1200` on every mission row and `cost: 800` on every
 * tool row, and those constants flowed into evaluateAgent's
 * `costPerSuccess = totalCost / successful`, which is compared against a real
 * 10,000-unit efficiency threshold. Cost efficiency could therefore only ever
 * reflect the ratio of successes to rows — never cost — while reading as a
 * measurement. On the self-healing path in tool-analytics.service, a bad enough
 * score opens and starts a Performance Improvement Plan.
 *
 * The tool-usage fallback is gone rather than repaired. agent_tool_usage has no
 * agent column at all — only agent_run_id, "link to agent run if applicable" —
 * so the old `eq(agentToolUsage.agentRunId, numericAgentId)` compared an agent id
 * against a run id, two unrelated id spaces, and whichever run happened to share
 * that number was attributed to the agent. Worse, a non-numeric agent id fell
 * through to `sql\`true\``, which attributed the entire organization's tool
 * history to one agent. In practice it matched nothing either way: all 335 rows
 * in that table have a null agent_run_id, because the one caller of logToolUsage
 * never sets it. There is no correct query to write here, so none is written.
 *
 * An agent with no attributable runs now yields an empty history, and
 * evaluateAgent already treats that as "Insufficient mission history" and takes
 * no action — which is the right answer when there is no evidence.
 */
export async function fetchAgentMissionHistory(
  agentId: string,
  organizationId: number
): Promise<Array<{ missionId: number; success: boolean; cost: number; timestamp: Date }>> {
  const numericAgentId = Number(agentId);
  if (!Number.isInteger(numericAgentId)) return [];

  try {
    const assignments = await db
      .select({
        runId: missionRuns.id,
        status: missionRuns.status,
        isSuccess: missionRuns.isSuccess,
        costUsd: missionRuns.costUsd,
        createdAt: missionRuns.lastCheckpointAt,
      })
      .from(missionAgentAssignments)
      .innerJoin(missionRuns, eq(missionAgentAssignments.missionRunId, missionRuns.id))
      .where(
        and(
          eq(missionAgentAssignments.agentDeploymentId, numericAgentId),
          eq(missionRuns.organizationId, organizationId)
        )
      )
      .orderBy(desc(missionRuns.id))
      .limit(50);

    return assignments.map((row) => ({
      missionId: row.runId,
      success: row.isSuccess ?? (row.status === "completed" || row.status === "success"),
      // drizzle decimal() comes back a string, so Number() rather than a bare read.
      // Note cost_usd DEFAULTs to '0', so a run whose cost was never recorded reads
      // as free and flatters the score. That is a gap in what the runs record — 84
      // of 86 rows currently carry no cost — and the fix belongs at the write side,
      // not in a constant invented here.
      cost: Number(row.costUsd ?? 0),
      timestamp: row.createdAt ?? new Date(),
    }));
  } catch (err: any) {
    logger.warn(`Failed to fetch mission history for agent ${agentId}: ${err.message}`);
    return [];
  }
}

/**
 * Daily evaluation job configuration
 */
export interface DailyEvaluationConfig {
  organizationId: number;
  evaluationHour: number; // 0-23, default 2 (2 AM)
  resetDayOfMonth: number; // 1-31, default 1
  timezone: string; // default "UTC"
}

/**
 * Run daily performance evaluation for all agents in an organization
 */
export async function runDailyPerformanceEvaluation(
  organizationId: number,
  options?: {
    missionHistoryProvider?: (agentId: string, orgId: number) => Promise<
      Array<{
        missionId: number;
        success: boolean;
        cost: number;
        timestamp: Date;
      }>
    >;
  }
): Promise<{
  evaluated: number;
  warnings: number;
  pipsCreated: number;
  pipsCompleted: number;
  upskillingInitiated: number;
  errors: string[];
}> {
  const results = {
    evaluated: 0,
    warnings: 0,
    pipsCreated: 0,
    pipsCompleted: 0,
    upskillingInitiated: 0,
    errors: [] as string[],
  };

  logger.info(`Starting daily performance evaluation for org ${organizationId}`);

  try {
    // Get performance summary to identify all agents
    const summary = await performanceManagerService.getPerformanceSummary(organizationId);

    // Evaluate each agent
    for (const perf of summary.topPerformers.concat(summary.atRiskAgents)) {
      try {
        // Skip recently evaluated (within 20 hours)
        const hoursSinceEval =
          (Date.now() - new Date(perf.lastEvaluatedAt).getTime()) / (1000 * 60 * 60);
        if (hoursSinceEval < 20) {
          logger.debug(`Skipping ${perf.agentId} - evaluated ${Math.round(hoursSinceEval)}h ago`);
          continue;
        }

        // Fetch mission history from provider or database
        const historyProvider = options?.missionHistoryProvider || fetchAgentMissionHistory;
        const missionHistory = await historyProvider(perf.agentId, organizationId);

        // Run evaluation
        const evaluation = await performanceManagerService.evaluateAgent(
          perf.agentId,
          organizationId,
          missionHistory
        );

        results.evaluated++;

        // Handle PIP completion if in PIP
        if (perf.status === "pip") {
          const activePIP = performanceManagerService.getActivePIP(perf.agentId, organizationId);

          if (activePIP && activePIP.startedAt) {
            const daysActive =
              (Date.now() - new Date(activePIP.startedAt).getTime()) / (1000 * 60 * 60 * 24);

            if (daysActive >= activePIP.deadlineDays) {
              // PIP deadline reached - complete it
              await performanceManagerService.completePIP(activePIP.id, {
                successRate: perf.successRate,
                costEfficiency: perf.costPerSuccess,
              });
              results.pipsCompleted++;

              logger.info(`Completed PIP for ${perf.agentId} after ${Math.round(daysActive)} days`);
              continue;
            }
          }
        }

        // Handle status-based actions
        switch (evaluation.actionRequired) {
          case "warn":
            results.warnings++;
            logger.warn(`Agent ${perf.agentId} performance warning: ${evaluation.reasons.join(", ")}`);
            break;

          case "pip":
            if (perf.status !== "pip") {
              const pip = await performanceManagerService.createPIP(
                perf.agentId,
                organizationId,
                evaluation.reasons[0],
                "below_threshold"
              );
              await performanceManagerService.startPIP(pip.id);
              results.pipsCreated++;
              results.upskillingInitiated++;
              logger.info(`Created and started PIP for ${perf.agentId}`);
            }
            break;

          case "terminate":
            // Would trigger deprovision workflow
            logger.error(`Agent ${perf.agentId} recommended for termination`);
            break;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.errors.push(`Error evaluating ${perf.agentId}: ${errorMsg}`);
        logger.error(`Failed to evaluate agent ${perf.agentId}`, error);
      }
    }

    // Publish summary event
    eventStream.publish(
      "agent.daily_evaluation_complete",
      {
        organizationId,
        ...results,
        timestamp: new Date().toISOString(),
      },
      { organizationId },
      "performance_jobs"
    );

    logger.info(`Daily evaluation complete for org ${organizationId}`, results);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    results.errors.push(`Fatal error: ${errorMsg}`);
    logger.error(`Daily evaluation failed for org ${organizationId}`, error);
  }

  return results;
}

/**
 * Monthly budget reset job
 */
export async function runMonthlyBudgetReset(organizationId: number): Promise<{
  agentsReset: number;
  errors: string[];
}> {
  const results = {
    agentsReset: 0,
    errors: [] as string[],
  };

  logger.info(`Starting monthly budget reset for org ${organizationId}`);

  try {
    await governanceService.resetMonthlySpend(organizationId);

    // Get all salaries to count
    const salaries = await governanceService.getSalaries(organizationId);
    results.agentsReset = salaries.length;

    // Publish event
    eventStream.publish(
      "governance.monthly_reset_complete",
      {
        organizationId,
        agentsReset: salaries.length,
        timestamp: new Date().toISOString(),
      },
      { organizationId },
      "performance_jobs"
    );

    logger.info(`Monthly budget reset complete for org ${organizationId}. ${salaries.length} agents reset.`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    results.errors.push(errorMsg);
    logger.error(`Monthly budget reset failed for org ${organizationId}`, error);
  }

  return results;
}

/**
 * Initialize scheduled jobs
 * Call this from your main server initialization
 */
export function initializePerformanceJobs(config: DailyEvaluationConfig): void {
  // Note: In production, use a proper scheduler like node-cron, bullmq, or pg-boss
  // This is a simplified version for demonstration

  logger.info(`Initializing performance jobs for org ${config.organizationId}`, config);

  // Schedule daily evaluation
  scheduleDailyJob(config.evaluationHour, async () => {
    logger.info("Running scheduled daily performance evaluation");
    await runDailyPerformanceEvaluation(config.organizationId);
  });

  // Schedule monthly budget reset
  scheduleMonthlyJob(config.resetDayOfMonth, async () => {
    logger.info("Running scheduled monthly budget reset");
    await runMonthlyBudgetReset(config.organizationId);
  });

  logger.info("Performance jobs initialized");
}

/**
 * Simple scheduler - REPLACE with proper scheduler in production
 */
function scheduleDailyJob(hour: number, job: () => Promise<void>): void {
  const now = new Date();
  const nextRun = new Date();
  nextRun.setHours(hour, 0, 0, 0);

  if (nextRun <= now) {
    nextRun.setDate(nextRun.getDate() + 1);
  }

  const delay = nextRun.getTime() - now.getTime();

  setTimeout(async () => {
    await job();
    // Reschedule for next day
    scheduleDailyJob(hour, job);
  }, delay);

  logger.info(`Scheduled daily job for ${hour}:00 (in ${Math.round(delay / 1000 / 60)} minutes)`);
}

/**
 * Simple monthly scheduler - REPLACE with proper scheduler in production
 */
function scheduleMonthlyJob(dayOfMonth: number, job: () => Promise<void>): void {
  const now = new Date();
  const nextRun = new Date();
  nextRun.setDate(dayOfMonth);
  nextRun.setHours(2, 0, 0, 0);

  if (nextRun <= now) {
    nextRun.setMonth(nextRun.getMonth() + 1);
  }

  const delay = nextRun.getTime() - now.getTime();

  setTimeout(async () => {
    await job();
    // Reschedule for next month
    scheduleMonthlyJob(dayOfMonth, job);
  }, delay);

  logger.info(`Scheduled monthly job for day ${dayOfMonth} (in ${Math.round(delay / 1000 / 60 / 60)} hours)`);
}

// ============================================================================
// MANUAL TRIGGER ENDPOINTS (for testing/admin)
// ============================================================================

/**
 * Express route handler for triggering manual evaluation
 */
export async function handleManualEvaluationRequest(
  req: { body: { organizationId: number; agentId?: string } },
  res: { json: (data: any) => void; status: (code: number) => { json: (data: any) => void } }
): Promise<void> {
  try {
    const { organizationId, agentId } = req.body;

    if (!organizationId) {
      res.status(400).json({ error: "organizationId required" });
      return;
    }

    if (agentId) {
      const history = await fetchAgentMissionHistory(agentId, organizationId);
      const evaluation = await performanceManagerService.evaluateAgent(
        agentId,
        organizationId,
        history
      );
      if (evaluation.actionRequired === "pip") {
        const activePIP = performanceManagerService.getActivePIP(agentId, organizationId);
        if (!activePIP) {
          const pip = await performanceManagerService.createPIP(
            agentId,
            organizationId,
            evaluation.reasons[0] || "Evaluation below threshold",
            "below_threshold"
          );
          await performanceManagerService.startPIP(pip.id);
        }
      }
      res.json(evaluation);
      return;
    } else {
      // Run full daily evaluation
      const results = await runDailyPerformanceEvaluation(organizationId);
      res.json(results);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errorMsg });
  }
}

/**
 * Express route handler for triggering manual budget reset
 */
export async function handleManualBudgetResetRequest(
  req: { body: { organizationId: number } },
  res: { json: (data: any) => void; status: (code: number) => { json: (data: any) => void } }
): Promise<void> {
  try {
    const { organizationId } = req.body;

    if (!organizationId) {
      res.status(400).json({ error: "organizationId required" });
      return;
    }

    const results = await runMonthlyBudgetReset(organizationId);
    res.json(results);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errorMsg });
  }
}
