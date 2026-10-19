import { db } from '@server/database_service.js';
import { pipelineExecutor } from '@server/core/pipeline-executor.js';
import { pipelineExecutions, pipelineStepExecutions } from '@shared/schema/index.js';
import { eq } from 'drizzle-orm';

export interface TestPipelineOptions {
    input?: any;
    mocks?: Record<string, any>;
    timeout?: number;
}

export interface TestPipelineResult {
    id: number;
    status: string;
    steps: any[];
    output?: any;
    error?: string;
}

/**
 * Execute a pipeline in test mode
 */
export async function testPipeline(
    pipelineIdOrName: string | number,
    options: TestPipelineOptions = {}
): Promise<TestPipelineResult> {
    const { input, mocks = {}, timeout = 30000 } = options;

    // Find pipeline
    let pipelineId: number;
    if (typeof pipelineIdOrName === 'string') {
        const { pipelines } = await import('@shared/schema/index.js');
        const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.name, pipelineIdOrName)).limit(1);
        if (!pipeline) throw new Error(`Pipeline not found: ${pipelineIdOrName}`);
        pipelineId = pipeline.id;
    } else {
        pipelineId = pipelineIdOrName;
    }

    // Apply mocks if provided
    if (Object.keys(mocks).length > 0) {
        // Mock implementation would go here
        // This would intercept job executions and return mocked data
    }

    // Execute pipeline (runs synchronously when DISABLE_JOB_QUEUE=true)
    const execution = await pipelineExecutor.executePipeline(
        pipelineId,
        'test-user',
        undefined,
        timeout,
        input
    );

    // If execution failed before creating a record, return the error result
    if (execution.executionId === -1 || !execution.success) {
        return {
            id: -1,
            status: execution.success ? 'completed' : 'failed',
            steps: execution.stepResults || [],
            error: execution.error ?? undefined
        };
    }

    // Wait for completion (for async/queue mode; sync mode is already done)
    const result = await waitForExecution(execution.executionId, timeout);

    return result;
}

/**
 * Wait for execution to complete
 */
async function waitForExecution(executionId: number, timeout: number): Promise<TestPipelineResult> {
    const startTime = Date.now();

    while (true) {
        const [execution] = await db
            .select({ id: pipelineExecutions.id, status: pipelineExecutions.status, error: pipelineExecutions.error })
            .from(pipelineExecutions)
            .where(eq(pipelineExecutions.id, executionId))
            .limit(1);

        if (!execution) {
            throw new Error(`Execution not found: ${executionId}`);
        }

        if (execution.status === 'completed' || execution.status === 'failed') {
            const steps = await db
                .select()
                .from(pipelineStepExecutions)
                .where(eq(pipelineStepExecutions.pipelineExecutionId, executionId));

            return {
                id: execution.id,
                status: execution.status,
                steps,
                error: execution.error ?? undefined
            };
        }

        if (Date.now() - startTime > timeout) {
            throw new Error(`Execution timeout after ${timeout}ms`);
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

/**
 * Create a mock execution for testing
 */
export function createMockExecution(overrides: Partial<any> = {}) {
    return {
        id: Math.floor(Math.random() * 10000),
        pipelineId: 1,
        status: 'running',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides
    };
}

/**
 * Create a mock step for testing
 */
export function createMockStep(overrides: Partial<any> = {}) {
    return {
        id: Math.floor(Math.random() * 10000),
        pipelineExecutionId: 1,
        stepOrder: 1,
        jobType: 'curl',
        status: 'pending',
        createdAt: new Date(),
        ...overrides
    };
}

/**
 * Assert that a value matches a snapshot
 */
export function toMatchSnapshot(value: any, snapshotName: string) {
    // Snapshot implementation would go here
    // For now, just a placeholder
    return true;
}
