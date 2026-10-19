/**
 * Data Lineage Service
 * 
 * Analyzes pipeline structure to build dependency graphs.
 * Detects explicit (step-to-step) and implicit (variable usage) dependencies.
 */

import { db } from "@server/database_service.js";
import { pipelines, pipelineSteps, jobs } from "@shared/schema/index.js";
import { eq, like, or } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("LineageService");

export interface LineageNode {
    id: string;
    type: string; // 'job' | 'trigger' | 'decision'
    data: {
        label: string;
        jobType?: string;
        stepId?: number;
        jobId?: number;
    };
    position?: { x: number; y: number }; // For React Flow
}

export interface LineageEdge {
    id: string;
    source: string;
    target: string;
    label?: string;
    type: "explicit" | "implicit";
    animated?: boolean;
}

export interface LineageGraph {
    nodes: LineageNode[];
    edges: LineageEdge[];
}

export const lineageService = {
    /**
     * Build a lineage graph for a pipeline
     */
    async getPipelineLineage(pipelineId: number): Promise<LineageGraph> {
        const nodes: LineageNode[] = [];
        const edges: LineageEdge[] = [];

        // Get pipeline steps with job details
        const steps = await db
            .select({
                step: pipelineSteps,
                job: jobs,
            })
            .from(pipelineSteps)
            .leftJoin(jobs, eq(pipelineSteps.jobId, jobs.id))
            .where(eq(pipelineSteps.pipelineId, pipelineId))
            .orderBy(pipelineSteps.order);

        // Add Trigger Node
        nodes.push({
            id: "trigger",
            type: "trigger",
            data: { label: "Start" },
            position: { x: 250, y: 0 },
        });

        // Add Step Nodes
        steps.forEach((item, index) => {
            nodes.push({
                id: `step-${item.step.id}`,
                type: "job",
                data: {
                    label: item.step.outputName || item.job?.name || `Step ${item.step.order}`,
                    jobType: item.job?.type,
                    stepId: item.step.id,
                    jobId: item.job?.id,
                },
                position: { x: 250, y: (index + 1) * 100 },
            });
        });

        // 1. Explicit Dependencies (Sequential Order & Destination ID)
        steps.forEach((item, index) => {
            // Edge from Trigger to first step
            if (index === 0) {
                edges.push({
                    id: `e-trigger-${item.step.id}`,
                    source: "trigger",
                    target: `step-${item.step.id}`,
                    type: "explicit",
                });
            }

            // Edge to next step (if no explicit destination overrides)
            if (item.step.destinationStepId) {
                edges.push({
                    id: `e-${item.step.id}-${item.step.destinationStepId}`,
                    source: `step-${item.step.id}`,
                    target: `step-${item.step.destinationStepId}`,
                    type: "explicit",
                    label: "Next",
                });
            } else if (index < steps.length - 1) {
                const nextStep = steps[index + 1];
                edges.push({
                    id: `e-${item.step.id}-${nextStep.step.id}`,
                    source: `step-${item.step.id}`,
                    target: `step-${nextStep.step.id}`,
                    type: "explicit",
                });
            }
        });

        // 2. Implicit Dependencies (Variable Usage)
        // Scan job configs for pattern {{step.123.output...}}
        // Capture the full path after the step order
        const variableRegex = /{{step\.(\d+)\.([^}]+)}}/g;

        steps.forEach((item) => {
            // Check config for variables
            if (!item.job || !item.job.config) return;
            const configStr = JSON.stringify(item.job.config);

            let match;
            while ((match = variableRegex.exec(configStr)) !== null) {
                const sourceStepOrder = parseInt(match[1]);
                const paramPath = match[2]; // e.g., "output.data" or "output"

                // Find the step with this order
                const sourceStep = steps.find(s => s.step.order === sourceStepOrder);

                if (sourceStep && sourceStep.step.id !== item.step.id) {
                    // Check if edge already exists
                    // We allow multiple edges if they represent different parameters (optional, or just append label)
                    // For clarity, let's append to label if edge exists, or create new one.
                    const edgeId = `e-implicit-${sourceStep.step.id}-${item.step.id}`;
                    const existingEdge = edges.find(e => e.id === edgeId);

                    if (existingEdge) {
                        if (!existingEdge.label?.includes(paramPath)) {
                            existingEdge.label = existingEdge.label ? `${existingEdge.label}, ${paramPath}` : paramPath;
                        }
                    } else {
                        edges.push({
                            id: edgeId,
                            source: `step-${sourceStep.step.id}`,
                            target: `step-${item.step.id}`,
                            type: "implicit",
                            label: paramPath,
                            animated: true,
                        });
                    }
                }
            }
        });

        return { nodes, edges };
    },

    /**
     * Find impact of a job change
     * Returns list of pipelines and steps that use this job or depend on it
     */
    async getJobImpact(jobId: number) {
        // 1. Find explicit usage (Steps using this job)
        const directUsage = await db
            .select({
                id: pipelines.id,
                name: pipelines.name,
                stepOrder: pipelineSteps.order,
            })
            .from(pipelineSteps)
            .innerJoin(pipelines, eq(pipelineSteps.pipelineId, pipelines.id))
            .where(eq(pipelineSteps.jobId, jobId));

        // 2. Find downstream jobs (Jobs consuming outputs/datasets from this job)
        // For now returning empty array as placeholder for future implementation
        const affectedJobs: { id: number; name: string }[] = [];

        return {
            affectedPipelines: directUsage,
            affectedJobs: affectedJobs
        };
    }
};


