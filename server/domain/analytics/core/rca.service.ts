/**
 * Root Cause Analysis Service
 * Traces back through pipeline execution to find the origin of an error
 */

import { createLogger } from '@server/utils/logger.js';
import { db } from '@server/database_service.js';
import { sql, eq, and, desc } from 'drizzle-orm';
import { pipelineStepExecutions, pipelineSteps, jobs } from '@shared/schema/index.js';

const logger = createLogger('RootCauseAnalysisService');

export interface RootCauseNode {
    stepExecutionId: number;
    stepName: string;
    stepId: number;
    status: string;
    error?: string;
    outputSummary?: string;
    executionTimeMs?: number;
    occurredAt: Date;
    impactScore: number; // 0-1 confidence this is the root cause
    relation: 'root_cause' | 'contributor' | 'victim' | 'unknown';
}

export interface RootCauseTrace {
    targetErrorId: number;
    rootCauseNode: RootCauseNode | null;
    tracePath: RootCauseNode[];
    analysisSummary: string;
}

export class RootCauseAnalysisService {

    /**
     * Analyze the root cause of a failed step execution
     */
    async analyzeRootCause(failedStepExecutionId: number): Promise<RootCauseTrace> {
        logger.info('Starting root cause analysis', { failedStepExecutionId });

        // 1. Get the failed execution details
        const failedStep = await this.getStepExecution(failedStepExecutionId);
        if (!failedStep) {
            throw new Error(`Step execution ${failedStepExecutionId} not found`);
        }

        // 2. Get all executions in the same pipeline run (up to this point)
        const pipelineHistory = await this.getPipelineRunHistory(
            failedStep.pipelineExecutionId,
            failedStep.createdAt
        );

        // 3. Trace back dependencies
        // For now, we assume simple chronological dependency for linear pipelines
        // In complex graphs, we would traverse edges.

        const tracePath: RootCauseNode[] = [];
        let rootCauseNode: RootCauseNode | null = null;
        let currentBestScore = 0;

        // Add the victim (the failed step)
        tracePath.push(this.mapToNode(failedStep, 'victim', 0));

        // Analyze upstream steps
        for (const step of pipelineHistory) {
            if (step.id === failedStep.id) continue;

            let relation: RootCauseNode['relation'] = 'unknown';
            let impactScore = 0;

            // Logic to determine if this step contributed to the failure

            // Case A: Step failed previously (Cascading failure)
            if (step.status === 'failed' || step.status === 'cancelled') {
                relation = 'root_cause';
                impactScore = 0.9;
            }
            // Case B: Step succeeded but produced empty/anomalous output (Silent failure)
            else if (step.status === 'completed') {
                const anomalyScore = this.detectOutputAnomaly(step.output);
                if (anomalyScore > 0.5) {
                    relation = 'contributor';
                    impactScore = anomalyScore;
                }
            }

            if (impactScore > 0) {
                const node = this.mapToNode(step, relation, impactScore);
                tracePath.push(node);

                if (impactScore > currentBestScore) {
                    currentBestScore = impactScore;
                    rootCauseNode = node;
                }
            }
        }

        // If no upstream cause found, the failed step itself is the root cause
        if (!rootCauseNode) {
            rootCauseNode = tracePath[0];
            rootCauseNode.relation = 'root_cause';
            rootCauseNode.impactScore = 1.0;
        }

        // Sort trace by time ascending
        tracePath.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

        return {
            targetErrorId: failedStepExecutionId,
            rootCauseNode,
            tracePath,
            analysisSummary: this.generateSummary(rootCauseNode, tracePath),
        };
    }

    private async getStepExecution(id: number) {
        const [step] = await db.select({
            id: pipelineStepExecutions.id,
            pipelineExecutionId: pipelineStepExecutions.pipelineExecutionId,
            stepId: pipelineStepExecutions.pipelineStepId,
            status: pipelineStepExecutions.status,
            error: pipelineStepExecutions.error,
            output: pipelineStepExecutions.output,
            createdAt: pipelineStepExecutions.executedAt,
            completedAt: pipelineStepExecutions.completedAt,
            name: jobs.name,
        })
            .from(pipelineStepExecutions)
            .innerJoin(pipelineSteps, eq(pipelineSteps.id, pipelineStepExecutions.pipelineStepId))
            .leftJoin(jobs, eq(jobs.id, pipelineSteps.jobId))
            .where(eq(pipelineStepExecutions.id, id));

        return {
            ...step,
            executionTimeMs: step.completedAt && step.createdAt
                ? step.completedAt.getTime() - step.createdAt.getTime()
                : 0
        };
    }

    private async getPipelineRunHistory(pipelineExecutionId: number | null, beforeDate: Date) {
        if (!pipelineExecutionId) return [];

        const steps = await db.select({
            id: pipelineStepExecutions.id,
            stepId: pipelineStepExecutions.pipelineStepId,
            status: pipelineStepExecutions.status,
            error: pipelineStepExecutions.error,
            output: pipelineStepExecutions.output,
            createdAt: pipelineStepExecutions.executedAt,
            completedAt: pipelineStepExecutions.completedAt,
            name: jobs.name,
        })
            .from(pipelineStepExecutions)
            .innerJoin(pipelineSteps, eq(pipelineSteps.id, pipelineStepExecutions.pipelineStepId))
            .leftJoin(jobs, eq(jobs.id, pipelineSteps.jobId))
            .where(and(
                eq(pipelineStepExecutions.pipelineExecutionId, pipelineExecutionId),
                // Only look at steps that finished before the failed step
                sql`${pipelineStepExecutions.executedAt} <= ${beforeDate}`
            ))
            .orderBy(desc(pipelineStepExecutions.executedAt));

        return steps.map(step => ({
            ...step,
            executionTimeMs: step.completedAt && step.createdAt
                ? step.completedAt.getTime() - step.createdAt.getTime()
                : 0
        }));
    }

    private detectOutputAnomaly(output: any): number {
        if (!output) return 0.6; // Null output is suspicious

        if (typeof output === 'object') {
            if (Object.keys(output).length === 0) return 0.7; // Empty object

            // Check for error-like properties in successful output
            if (output.error || output.errors || output.errorMessage) return 0.8;
            if (output.success === false) return 0.9;
        }

        if (Array.isArray(output) && output.length === 0) return 0.5; // Empty array (might be valid, but suspicious)

        return 0;
    }

    private mapToNode(step: any, relation: RootCauseNode['relation'], score: number): RootCauseNode {
        return {
            stepExecutionId: step.id,
            stepName: step.name,
            stepId: step.stepId,
            status: step.status,
            error: step.error,
            outputSummary: this.summarizeOutput(step.output),
            executionTimeMs: step.executionTimeMs,
            occurredAt: step.createdAt,
            impactScore: score,
            relation,
        };
    }

    private summarizeOutput(output: any): string {
        if (!output) return 'No output';
        if (typeof output === 'string') return output.substring(0, 50) + (output.length > 50 ? '...' : '');
        return JSON.stringify(output).substring(0, 50) + '...';
    }

    private generateSummary(root: RootCauseNode, trace: RootCauseNode[]): string {
        if (root.relation === 'victim') {
            return `The error originated in the step "${root.stepName}" itself. No upstream failures detected.`;
        }

        const contributors = trace.filter(n => n.relation === 'contributor');
        let summary = `Root cause identified in step "${root.stepName}" (${root.status}).`;

        if (contributors.length > 0) {
            summary += ` Additionally, ${contributors.length} earlier steps showed anomalies that may have contributed.`;
        }

        return summary;
    }
}

// Singleton instance
export const rootCauseAnalysisService = new RootCauseAnalysisService();

