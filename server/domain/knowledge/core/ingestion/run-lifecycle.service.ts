/**
 * Run Lifecycle Service
 *
 * Handles deletion of pipeline execution records for completed research runs
 * while preserving all derived data (Knowledge Graph nodes, edges, and
 * DatasetItems). Foreign keys referencing the execution are nullified so
 * that dependent records persist independently.
 *
 * @module ingestion/run-lifecycle
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { type OrgContext } from "@server/utils/auth-context.js";
import { pipelineExecutions } from "@shared/schema/pipelines/pipeline-execution.js";
import { knowledgeEdges } from "@shared/schema/knowledge/graph.js";
import { pipelineTriggerLogs } from "@shared/schema/pipelines/trigger-logs.js";
import { eq, and } from "drizzle-orm";

const logger = createLogger("RunLifecycle");

export const runLifecycleService = {
  /**
   * Delete a pipeline execution record while preserving all derived data.
   *
   * This method:
   * 1. Nullifies `knowledgeEdges.lastUpdatedByRunId` references to this execution
   *    (no onDelete cascade configured on that FK, so explicit nullification is needed)
   * 2. Deletes the pipeline execution record itself
   *
   * The following are handled automatically by Postgres FK constraints:
   * - `knowledgeNodes.pipelineExecutionId` → SET NULL on delete
   * - `datasetItems.pipelineExecutionId` → SET NULL on delete
   * - `pipelineStepExecutions` → CASCADE on delete
   * - `aiUsageLogs.executionId` → SET NULL on delete
   * - `driftScores.executionId` → CASCADE on delete
   * - `transactionLogs.executionId` → CASCADE on delete
   * - `training.sourcePipelineExecutionId` → SET NULL on delete
   *
   * @param pipelineExecutionId - The ID of the pipeline execution to delete
   * @param orgContext - Organization context for access scoping
   * @throws Error if the pipeline execution does not exist or does not belong to the org
   */
  async deleteRun(pipelineExecutionId: number, orgContext: OrgContext): Promise<void> {
    logger.info("Deleting pipeline execution run", {
      pipelineExecutionId,
      organizationId: orgContext.organizationId,
    });

    // Verify the execution exists and belongs to the organization
    const [execution] = await db
      .select({ id: pipelineExecutions.id, organizationId: pipelineExecutions.organizationId })
      .from(pipelineExecutions)
      .where(
        and(
          eq(pipelineExecutions.id, pipelineExecutionId),
          ...(orgContext.organizationId
            ? [eq(pipelineExecutions.organizationId, orgContext.organizationId)]
            : []),
        ),
      )
      .limit(1);

    if (!execution) {
      const error = new Error(
        `Pipeline execution ${pipelineExecutionId} not found or not accessible`,
      );
      (error as any).status = 404;
      throw error;
    }

    // Nullify knowledgeEdges.lastUpdatedByRunId — this FK has no onDelete policy,
    // so deletion would be blocked by a FK constraint violation without this step.
    await db
      .update(knowledgeEdges)
      .set({ lastUpdatedByRunId: null })
      .where(eq(knowledgeEdges.lastUpdatedByRunId, pipelineExecutionId));

    // Nullify pipelineTriggerLogs.executionId — also lacks an onDelete policy.
    await db
      .update(pipelineTriggerLogs)
      .set({ executionId: null })
      .where(eq(pipelineTriggerLogs.executionId, pipelineExecutionId));

    logger.debug("Nullified foreign key references", { pipelineExecutionId });

    // Delete the pipeline execution record.
    // Postgres cascades/nullifies all other FK references automatically:
    // - knowledgeNodes.pipelineExecutionId → SET NULL
    // - datasetItems.pipelineExecutionId → SET NULL
    // - pipelineStepExecutions → CASCADE
    await db
      .delete(pipelineExecutions)
      .where(eq(pipelineExecutions.id, pipelineExecutionId));

    logger.info("Pipeline execution run deleted successfully", {
      pipelineExecutionId,
      organizationId: orgContext.organizationId,
    });
  },
};
