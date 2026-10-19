/**
 * AsyncPollerService Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkStepStatus, handleAirflowStep, handleSupervisorStep } from '@server/domain/core/async-poller.service.js';
import { pipelineService } from '@server/domain/pipeline/core/pipeline.service.js';
import { pipelineExecutor } from '@server/core/pipeline-executor.js';
import { jobService } from '@server/domain/jobs/job.service.js';
import { credentialsService } from '@server/domain/auth/core/credentials-service.js';
import { supervisorService } from '@server/domain/integrations/core/supervisor.service.js';
import { db } from '@server/database_service.js';

// Mock Dependencies
vi.mock('@server/database_service.js', () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: vi.fn().mockResolvedValue([]),
                })),
            })),
        })),
    }
}));

vi.mock('@server/domain/pipeline/core/pipeline.service.js', () => ({
    pipelineService: {
        updateStepExecution: vi.fn().mockResolvedValue({}),
        getStepById: vi.fn().mockResolvedValue({ onFailureAction: 'Stop Pipeline' }),
        updateExecution: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('@server/core/pipeline-executor.js', () => ({
    pipelineExecutor: {
        resumePipelineExecution: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('@server/domain/jobs/job.service.js', () => ({
    jobService: {
        getById: vi.fn(),
    },
}));

vi.mock('@server/domain/auth/core/credentials-service.js', () => ({
    credentialsService: {
        getById: vi.fn(),
        getForExecution: vi.fn(),
    },
}));

vi.mock('@server/domain/integrations/core/supervisor.service.js', () => ({
    supervisorService: {
        executePlan: vi.fn(),
    },
}));

describe('AsyncPollerService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('checkStepStatus', () => {
        it('should resume sleep steps if time has passed', async () => {
            const now = new Date();
            const past = new Date(now.getTime() - 1000);
            const stepExec = {
                id: 1,
                sleepUntil: past.toISOString(),
                pipelineExecutionId: 10
            };

            await checkStepStatus(stepExec as any);

            expect(pipelineService.updateStepExecution).toHaveBeenCalledWith(1, expect.objectContaining({
                status: 'success'
            }));
            expect(pipelineExecutor.resumePipelineExecution).toHaveBeenCalledWith(10);
        });

        it('should skip if jobId is missing', async () => {
            const stepExec = { id: 2, sleepUntil: null, jobId: null };
            await checkStepStatus(stepExec as any);
            expect(jobService.getById).not.toHaveBeenCalled();
        });

        it('should call handleAirflowStep for airflow jobs', async () => {
            const stepExec = { id: 3, jobId: 300, traceId: 'run-1' };
            const mockJob = { id: 300, type: 'airflow_dag_run', config: { dagId: 'test-dag' } };

            vi.mocked(jobService.getById).mockResolvedValueOnce(mockJob as any);
            vi.mocked(credentialsService.getForExecution).mockResolvedValueOnce({ id: 1, metadata: { baseUrl: 'http://airflow' } } as any);

            // Mock Fetch for airflow status
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ state: 'success' })
            }) as any;

            await checkStepStatus(stepExec as any);

            expect(pipelineExecutor.resumePipelineExecution).toHaveBeenCalled();
        });
    });

    describe('handleAirflowStep', () => {
        it('should succeed if airflow state is success', async () => {
            const stepExec = { id: 4, traceId: 'run-4', pipelineExecutionId: 40 };
            const job = { type: 'airflow_dag_run', credentialId: 1, config: { dagId: 'my-dag' } };

            vi.mocked(credentialsService.getForExecution).mockResolvedValueOnce({
                id: 1,
                metadata: { baseUrl: 'http://airflow' },
                value: JSON.stringify({ url: 'http://airflow', username: 'u', password: 'p' })
            } as any);

            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ state: 'success' })
            }) as any;

            await handleAirflowStep(stepExec, job as any);

            expect(pipelineService.updateStepExecution).toHaveBeenCalledWith(4, expect.objectContaining({
                status: 'success'
            }));
            expect(pipelineExecutor.resumePipelineExecution).toHaveBeenCalledWith(40);
        });

        it('should fail if airflow state is failed', async () => {
            const stepExec = { id: 5, traceId: 'run-5' };
            const job = { type: 'airflow_dag_run', credentialId: 1, config: { dagId: 'my-dag' } };

            vi.mocked(credentialsService.getForExecution).mockResolvedValueOnce({
                id: 1,
                metadata: { baseUrl: 'http://airflow' }
            } as any);
            global.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: async () => ({ state: 'failed' })
            }) as any;

            await handleAirflowStep(stepExec, job as any);

            expect(pipelineService.updateStepExecution).toHaveBeenCalledWith(5, expect.objectContaining({
                status: 'failed'
            }));
        });
    });

    describe('handleSupervisorStep', () => {
        const stepExec = {
            id: 6,
            output: JSON.stringify({ tasks: [] }),
            pipelineExecutionId: 60
        };
        const job = { id: 600, organizationId: 10, type: 'supervisor' };

        it('should update output and resume if supervisor reports completed', async () => {
            const mockPlan = { tasks: [{ name: 't1', status: 'success' }] };
            vi.mocked(supervisorService.executePlan).mockResolvedValueOnce({
                state: 'completed',
                plan: mockPlan
            } as any);

            // Mock db.select for pipelineExec
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValueOnce([{ id: 60 }])
            });

            await handleSupervisorStep(stepExec, job as any);

            expect(pipelineService.updateStepExecution).toHaveBeenCalledWith(6, expect.objectContaining({
                output: JSON.stringify(mockPlan)
            }));
            expect(pipelineService.updateStepExecution).toHaveBeenCalledWith(6, expect.objectContaining({
                status: 'success'
            }));
            expect(pipelineExecutor.resumePipelineExecution).toHaveBeenCalledWith(60);
        });

        it('should fail if supervisor reports failed', async () => {
            vi.mocked(supervisorService.executePlan).mockResolvedValueOnce({
                state: 'failed',
                plan: { tasks: [{ name: 'bad-task', status: 'failed' }] }
            } as any);
            (db.select as any).mockReturnValueOnce({
                from: vi.fn().mockReturnThis(),
                where: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValueOnce([{ id: 60 }])
            });

            await handleSupervisorStep(stepExec, job as any);

            expect(pipelineService.updateStepExecution).toHaveBeenCalledWith(6, expect.objectContaining({
                status: 'failed'
            }));
        });
    });
});
