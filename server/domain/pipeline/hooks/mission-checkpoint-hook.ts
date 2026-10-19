/**
 * Mission Checkpoint Hook
 *
 * Checkpoints mission when a pipeline step completes and execution has missionId
 * and a linked mission. Per plan: merge step output into missionContext, write
 * checkpoint to missionBlackboardHistory with changeReason: "checkpoint:step_N".
 *
 * When requireGoldenRecordForMilestone is true (pipeline governorSettings),
 * additionally require Golden Record for milestone checkpoints.
 *
 * onPipelineComplete: marks active missions for this mission as completed when
 * the pipeline finishes. Ensures missions don't stay stuck in "active" if the
 * launch promise handler fails or the pipeline was triggered by another path.
 */

import { ExecutionHook, HookParams, PipelineCompleteParams } from "./execution-hooks.js";

import { db } from "@server/database_service.js";
import { missions as missionsTable } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("MissionCheckpointHook");
logger.info("MissionCheckpointHook module loaded");

export class MissionCheckpointHook implements ExecutionHook {
  name = "MissionCheckpointHook";

  async onPipelineComplete(params: PipelineCompleteParams): Promise<void> {
    const { pipelineExecution } = params;
    const missionId = pipelineExecution?.missionId;
    if (!missionId) return;

    const { missionRunService } = await import("../../mission/core/mission-run.service.js");
    try {
      const missions = await missionRunService.list({
        missionId,
        statuses: ['active', 'waiting_on_human'] as any,
      });
      logger.info(`onPipelineComplete: Found ${missions.length} active runs for mission ${missionId}`);
      for (const m of missions) {
        logger.info(`Checking run ${m.id}, status=${m.status}, currentPipelineId=${m.currentPipelineId}`);
        // Only mark mission completed if this is the LAST pipeline in the sequence
        const sequence = (m.pipelineSequence as number[]) || [pipelineExecution.pipelineId];
        const isLastInSequence = Array.isArray(sequence) && 
            (sequence.length === 0 || sequence[sequence.length - 1] === pipelineExecution.pipelineId);

        const { missionRunService } = await import("../../mission/core/mission-run.service.js");
        if (pipelineExecution.status === "failed") {
          await missionRunService.update(m.id, {
            status: "failed",
            pipelineExecutionId: pipelineExecution.id
          });
          logger.info(`Marked mission ${m.id} failed (pipeline ${pipelineExecution.id} failed)`);
        } else if (pipelineExecution.status === "waiting_external_input") {
          await missionRunService.update(m.id, {
            status: "waiting_on_human",
            pipelineExecutionId: pipelineExecution.id
          });
          logger.info(`Marked mission ${m.id} waiting_on_human (pipeline ${pipelineExecution.id} suspended for interaction)`);
        } else if (pipelineExecution.status === "waiting_async") {
          logger.info(`Mission ${m.id} remains active; pipeline ${pipelineExecution.id} is waiting asynchronously.`);
        } else if (isLastInSequence && (pipelineExecution.status === "completed" || pipelineExecution.status === "success")) {
          // Link pipeline ID and update status
          await missionRunService.update(m.id, {
            status: "completed",
            pipelineExecutionId: pipelineExecution.id
          });
          logger.info(`Marked mission ${m.id} completed (pipeline ${pipelineExecution.id} finished successfully)`);
        } else if (!isLastInSequence && (pipelineExecution.status === "completed" || pipelineExecution.status === "success")) {
          logger.info(`Mission ${m.id} pipeline ${pipelineExecution.id} finished; advancing to next in sequence.`);
          const { missionService } = await import("../../mission/core/mission.service.js");
          await missionService.advanceSequence(m.id);
        } else {
          logger.info(`Mission ${m.id} remains active; pipeline ${pipelineExecution.id} finished with status ${pipelineExecution.status} but sequence has more steps or is suspended.`);
        }
      }
    } catch (err) {
      logger.error(`Failed to complete missions on pipeline finish: ${err}`);
    }
  }

  async onStepComplete(params: HookParams): Promise<void> {
    const { pipelineExecution, result, currentStep, pipeline, context, userId } = params;
    const missionId = pipelineExecution?.missionId;
    
    if (!result.success) {
        return;
    }

    const governorSettings = pipeline?.governorSettings as { requireGoldenRecordForMilestone?: boolean } | undefined;
    // For missions, we want to capture progress on every step to build the 'Chain of Evidence'
    logger.info(`onStepComplete called for missionId ${missionId}, step ${currentStep?.id}`);
    if (!missionId) {
      logger.info(`No missionId found on pipelineExecution, returning early.`);
      return;
    }

    try {
      let mission: any = null;
      const missionRunId = pipelineExecution?.missionRunId;

      if (missionRunId) {
        const { missionRunService } = await import("../../mission/core/mission-run.service.js");
        logger.info(`Using missionRunId ${missionRunId} from pipelineExecution`);
        const run = await missionRunService.getById(missionRunId);
        if (run) {
           // Verify missionId matches for safety
           if (run.missionId === missionId) {
             mission = run;
           } else {
             logger.warn(`Mission ID mismatch: run.missionId=${run.missionId}, expected=${missionId}`);
           }
        }
      }

      if (!mission) {
        const { missionRunService } = await import("../../mission/core/mission-run.service.js");
        logger.info(`Searching for runs for missionId ${missionId}`);
        // `statuses`, not `status`: list() filters `status` with eq(), so an array there
        // never matched a row and this fallback checkpointed nothing. The `as any` hid it.
        const missions = await missionRunService.list({
          missionId,
          statuses: ["active", "waiting_on_human", "completed"], // Include completed for resume support
        });

        logger.info(`Found ${missions.length} potential runs`);
        if (missions.length === 0) {
          logger.info(`No suitable mission run found for mission ${missionId}, returning early.`);
          return;
        }
        // Take the most recent one
        mission = missions[0];
      }
      logger.info(`Found mission run ${mission.id} for mission ${missionId} (Status: ${mission.status})`);

      const stepOutputs: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(context.positional || {})) {
        stepOutputs[`step_${k}`] = v;
      }
      const mergedContext: Record<string, unknown> = {
        ...(mission.missionContext as Record<string, unknown>),
        ...stepOutputs,
        ...(context.named || {}),
      };

      // Step Order
      const stepOrder = currentStep?.order ?? 0;

      // --- Heuristic Deliverable Capture ---
      // If the step has a named output, and it looks like a substantial finding,
      // or if it's explicitly named 'final_product' or 'deliverable', capture it as result.
      const namedOutputs = context.named || {};
      
      // 1. High-priority explicit names
      if (namedOutputs.final_product || namedOutputs.deliverable || namedOutputs.report) {
          mergedContext.result = namedOutputs.final_product || namedOutputs.deliverable || namedOutputs.report;
          logger.info(`Captured explicit deliverable from named output.`);
      } 
      // 2. Heuristic: First substantial string output if no result yet
      else {
          for (const [name, val] of Object.entries(namedOutputs)) {
              if (typeof val === 'string' && val.length > 100 && !mergedContext.result) {
                  logger.info(`Heuristically captured substantial output '${name}' as mission result.`);
                  mergedContext.result = val;
                  break;
              }
          }
      }

      // 3. Fallback: If this step had an outputName, capture it regardless of length
      if (!mergedContext.result && currentStep?.outputName && namedOutputs[currentStep.outputName]) {
          mergedContext.result = namedOutputs[currentStep.outputName];
      }

      logger.info(`Updating mission run ${mission.id} and blackboard for step ${stepOrder}`);
      const { missionRunService } = await import("../../mission/core/mission-run.service.js");
      await missionRunService.checkpoint({
        missionRunId: mission.id,
        missionId,
        missionContext: mergedContext,
        reason: params.goldenRecordWritten ? "checkpoint:milestone_complete" : `checkpoint:step_${stepOrder}`,
        changedBy: userId || "system",
      });
      logger.info(`Checkpoint successful for step ${stepOrder}`);

      // Ensure pipeline link is stored
      if (mission.pipelineExecutionId !== pipelineExecution.id) {
        const { missionRunService } = await import("../../mission/core/mission-run.service.js");
        await missionRunService.update(mission.id, { pipelineExecutionId: pipelineExecution.id });
      }
    } catch (error) {
      logger.error(`Error checkpointing mission: ${error}`);
    }
  }
}


