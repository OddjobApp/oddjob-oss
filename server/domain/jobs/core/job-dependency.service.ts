import { db } from "@server/database_service.js";
import { eq, and, desc } from "drizzle-orm";
import { jobDependencies, type JobDependency } from "@shared/schema/index.js";
import { pipelineStepExecutions } from "@shared/schema/index.js";

export type DependencyType = 'hard' | 'soft';

export interface CreateJobDependency {
    jobId: number;
    dependsOnJobId: number;
    dependencyType?: DependencyType;
    organizationId?: number;
}

export class JobDependencyService {
    async addDependency(dependency: CreateJobDependency): Promise<void> {
        await db.insert(jobDependencies).values({
            jobId: dependency.jobId,
            dependsOnJobId: dependency.dependsOnJobId,
            dependencyType: dependency.dependencyType || 'hard',
            organizationId: dependency.organizationId || null,
        });
    }

    async removeDependency(jobId: number, dependsOnJobId: number): Promise<void> {
        await db.delete(jobDependencies)
            .where(and(
                eq(jobDependencies.jobId, jobId),
                eq(jobDependencies.dependsOnJobId, dependsOnJobId)
            ));
    }

    async getDependencies(jobId: number): Promise<JobDependency[]> {
        return await db.select().from(jobDependencies)
            .where(eq(jobDependencies.jobId, jobId));
    }

    async getDependents(jobId: number): Promise<JobDependency[]> {
        return await db.select().from(jobDependencies)
            .where(eq(jobDependencies.dependsOnJobId, jobId));
    }

    async detectCircularDependency(jobId: number, dependsOnJobId: number): Promise<boolean> {
        // DFS to detect cycles
        const visited = new Set<number>();
        const stack = [dependsOnJobId];

        while (stack.length > 0) {
            const current = stack.pop()!;
            if (current === jobId) return true;
            if (visited.has(current)) continue;
            visited.add(current);

            const deps = await this.getDependencies(current);
            for (const dep of deps) {
                stack.push(dep.dependsOnJobId);
            }
        }

        return false;
    }

    /**
     * Finds the last successful run of a given job, optionally scoped to a specific pipeline execution.
     */
    async getLastSuccessfulRun(jobId: number, pipelineExecutionId?: number) {
        let conditions = [
            eq(pipelineStepExecutions.jobId, jobId),
            eq(pipelineStepExecutions.status, 'success')
        ];

        if (pipelineExecutionId) {
            conditions.push(eq(pipelineStepExecutions.pipelineExecutionId, pipelineExecutionId));
        }

        const result = await db.select()
            .from(pipelineStepExecutions)
            .where(and(...conditions))
            .orderBy(desc(pipelineStepExecutions.completedAt))
            .limit(1);

        return result.length > 0 ? result[0] : null;
    }

    /**
     * Resolves dependencies for a job.
     * If pipelineExecutionId is provided, it resolves based on the current pipeline run.
     * Otherwise, it resolves based on the global state of jobs.
     */
    async resolveDependencies(jobId: number, pipelineExecutionId?: number): Promise<{
        ready: boolean;
        blocking: number[];
        softBlocking: number[];
    }> {
        const dependencies = await this.getDependencies(jobId);
        const hardBlocking: number[] = [];
        const softBlocking: number[] = [];

        for (const dep of dependencies) {
            const lastRun = await this.getLastSuccessfulRun(dep.dependsOnJobId, pipelineExecutionId);
            if (!lastRun) {
                if (dep.dependencyType === 'hard') {
                    hardBlocking.push(dep.dependsOnJobId);
                } else {
                    softBlocking.push(dep.dependsOnJobId);
                }
            }
        }

        return {
            ready: hardBlocking.length === 0,
            blocking: hardBlocking,
            softBlocking,
        };
    }
}

export const jobDependencyService = new JobDependencyService();
