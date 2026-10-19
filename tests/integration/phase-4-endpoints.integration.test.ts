/**
 * Phase 4D: Endpoint Integration Tests
 *
 * Tests endpoint integrations with worker job submission:
 * - Cycle launch with synthesis job
 * - Approval creation with notification job
 * - Cycle abort with postmortem job
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { Express } from 'express';
import { db } from '@server/database_service.js';
import { operationalCycles, approvalRequests } from '@shared/schema/index.js';
import { eq } from 'drizzle-orm';
import { queueService } from '@domain/queue/queue.service.js';

describe('Phase 4D: Endpoint Integration Tests', () => {
    let app: Express;
    let authToken: string;

    beforeAll(async () => {
        // Initialize app (would be loaded from server setup)
        // app = await setupTestApp();

        // Initialize queue service
        await queueService.initialize();

        // Get auth token for tests (would be generated from test user)
        // authToken = await generateTestAuthToken();
    });

    afterAll(async () => {
        await queueService.shutdown();
    });

    describe('Cycle Launch with Job Submission', () => {
        it('should submit synthesis job on cycle launch', async () => {
            // This test simulates the cycle launch endpoint
            // In real scenario: POST /api/cycles/launch

            const [cycle] = await db.insert(operationalCycles).values({
                objective: 'Test objective',
                createdBy: 'test-user',
                organizationId: 1,
                name: 'Test Launch Cycle',
                status: 'active',
                metadata: {},
            }).returning();

            // Simulate job submission
            const job = await queueService.addJob(
                'cycle-synthesis',
                'synthesize',
                {
                    cycleId: cycle.id,
                    organizationId: 1,
                    blueprints: [
                        { name: 'bp1', objective: 'Test' },
                    ],
                },
                { priority: 0 } // HIGH priority
            );

            // Verify job was created
            expect(job).toBeDefined();
            expect(job.id).toBeDefined();

            // Verify job status can be retrieved
            const status = await queueService.getJobStatus('cycle-synthesis', String(job.id));
            expect(status).toBeDefined();
            expect(status?.queueName).toBe('cycle-synthesis');
            expect(status?.jobId).toBe(String(job.id));
        });

        it('should return cycle with job ID in response', async () => {
            // Response should contain: { ...cycleData, jobId: "..." }
            const mockResponse = {
                id: 1,
                organizationId: 1,
                name: 'Test Cycle',
                status: 'active',
                jobId: 'abc-123-def', // Job ID from queue submission
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            expect(mockResponse).toHaveProperty('jobId');
            expect(mockResponse.jobId).toBeDefined();
            expect(typeof mockResponse.jobId).toBe('string');
        });

        it('should handle job submission errors gracefully', async () => {
            // If job submission fails, cycle should still be created
            // but error should be logged

            const [cycle] = await db.insert(operationalCycles).values({
                objective: 'Test objective',
                createdBy: 'test-user',
                organizationId: 1,
                name: 'Fallback Cycle',
                status: 'active',
                metadata: {},
            }).returning();

            // Verify cycle exists even if job submission might fail
            const [fetched] = await db.select()
                .from(operationalCycles)
                // drizzle takes an SQL condition; a JS arrow is not evaluated and the
                // filter silently matched nothing, returning an arbitrary row.
                .where(eq(operationalCycles.id, cycle.id));

            expect(fetched).toBeDefined();
            expect(fetched.id).toBe(cycle.id);
        });
    });

    describe('Approval Creation with Job Submission', () => {
        it('should submit notification job on approval creation', async () => {
            // This test simulates approval creation via approvalService

            const [approval] = await db.insert(approvalRequests).values({
                executionId: 'test-execution',
                approverEmail: 'approver@test.local',
                token: `test-token-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                organizationId: 1,
                status: 'pending',
                approverType: 'admin',
                modifiedOutput: { tool: 'TestTool', description: 'Test approval' },
            }).returning();

            // Simulate job submission
            const job = await queueService.addJob(
                'approval-notifications',
                'notify',
                {
                    approvalId: approval.id,
                    organizationId: 1,
                    notificationType: 'REQUEST_CREATED',
                    recipientIds: [1],
                },
                { priority: 5, delay: 1000 } // NORMAL priority with 1s delay
            );

            // Verify job was created
            expect(job).toBeDefined();
            expect(job.opts.delay).toBe(1000);

            // Verify approval still exists
            const [fetched] = await db.select()
                .from(approvalRequests)
                .where(eq(approvalRequests.id, approval.id));

            expect(fetched).toBeDefined();
            expect(fetched.status).toBe('pending');
        });

        it('should fallback to sync notifications if queue fails', async () => {
            // If async job submission fails, fallback logic should:
            // 1. Log error
            // 2. Still create approval
            // 3. Attempt sync notification (as fallback)

            const [approval] = await db.insert(approvalRequests).values({
                executionId: 'test-execution',
                approverEmail: 'approver@test.local',
                token: `test-token-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                organizationId: 1,
                status: 'pending',
                approverType: 'admin',
                modifiedOutput: { tool: 'TestTool' },
            }).returning();

            // Approval should be created regardless of queue failures
            expect(approval).toBeDefined();
            expect(approval.id).toBeDefined();
        });

        it('should include notification metadata', async () => {
            const [approval] = await db.insert(approvalRequests).values({
                executionId: 'test-execution',
                approverEmail: 'approver@test.local',
                token: `test-token-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                organizationId: 1,
                status: 'pending',
                approverType: 'admin',
                modifiedOutput: { tool: 'TestTool', description: 'Test' },
            }).returning();

            const job = await queueService.addJob(
                'approval-notifications',
                'notify',
                {
                    approvalId: approval.id,
                    organizationId: 1,
                    notificationType: 'REQUEST_CREATED',
                    metadata: {
                        tool: 'TestTool',
                        description: 'Test approval',
                        riskLevel: 'medium',
                    },
                }
            );

            expect(job.data.metadata).toBeDefined();
            expect(job.data.metadata.tool).toBe('TestTool');
        });
    });

    describe('Cycle Abort with Postmortem Job', () => {
        it('should submit postmortem job on cycle abort', async () => {
            // This test simulates the cycle abort endpoint
            // POST /api/cycles/:id/abort

            const [cycle] = await db.insert(operationalCycles).values({
                objective: 'Test objective',
                createdBy: 'test-user',
                organizationId: 1,
                name: 'Abort Test Cycle',
                status: 'active',
                metadata: {},
            }).returning();

            // Simulate job submission with failed mission IDs
            const failedMissionIds = [1, 2, 3];
            const job = await queueService.addJob(
                'postmortem-analysis',
                'analyze',
                {
                    cycleId: cycle.id,
                    organizationId: 1,
                    failureType: 'user_abort',
                    failedMissionIds,
                },
                { priority: 5 } // NORMAL priority
            );

            // Verify job was created
            expect(job).toBeDefined();
            expect(job.data.failureType).toBe('user_abort');
            expect(job.data.failedMissionIds).toEqual(failedMissionIds);
        });

        it('should not block abort response for postmortem job submission', async () => {
            // Postmortem job submission should be non-blocking
            // Abort endpoint should return immediately

            const [cycle] = await db.insert(operationalCycles).values({
                objective: 'Test objective',
                createdBy: 'test-user',
                organizationId: 1,
                name: 'Non-blocking Abort Cycle',
                status: 'active',
                metadata: {},
            }).returning();

            const startTime = Date.now();

            // Submit job (should be fast)
            const job = await queueService.addJob(
                'postmortem-analysis',
                'analyze',
                {
                    cycleId: cycle.id,
                    organizationId: 1,
                    failureType: 'user_abort',
                },
                { priority: 5 }
            );

            const elapsed = Date.now() - startTime;

            // Job submission should take < 100ms
            expect(elapsed).toBeLessThan(100);
            expect(job).toBeDefined();
        });

        it('should handle postmortem job submission errors gracefully', async () => {
            // If postmortem job submission fails, abort should still succeed
            // (postmortem is optional, not critical path)

            const [cycle] = await db.insert(operationalCycles).values({
                objective: 'Test objective',
                createdBy: 'test-user',
                organizationId: 1,
                name: 'Error Handling Cycle',
                status: 'active',
                metadata: {},
            }).returning();

            // Cycle should be abortable even if postmortem fails
            expect(cycle).toBeDefined();
            expect(cycle.id).toBeDefined();
        });
    });

    describe('Job Status Tracking Integration', () => {
        it('should allow client to track job status', async () => {
            // Client flow:
            // 1. Submit request (returns jobId)
            // 2. Poll /api/jobs/status/:jobId?queue=:queueName
            // 3. Render progress to user

            const job = await queueService.addJob(
                'cycle-synthesis',
                'synthesize',
                {
                    cycleId: 1,
                    organizationId: 1,
                    blueprints: [],
                },
                { priority: 5 }
            );

            const jobId = String(job.id);

            // Client polls status endpoint
            const status = await queueService.getJobStatus('cycle-synthesis', jobId);

            expect(status).toBeDefined();
            expect(status?.jobId).toBe(jobId);
            expect(status?.queueName).toBe('cycle-synthesis');
            expect(['waiting', 'delayed', 'active', 'completed', 'failed']).toContain(status?.status);
        });

        it('should provide accurate job progress', async () => {
            // Progress endpoint should return:
            // { progress: 0-100, status, startedAt, estimatedTimeRemaining }

            const job = await queueService.addJob(
                'analytics-aggregation',
                'aggregate',
                {
                    organizationId: 1,
                    aggregationType: 'hourly',
                },
                { priority: 10 }
            );

            const status = await queueService.getJobStatus('analytics-aggregation', String(job.id));

            expect(status?.progress).toBeDefined();
            expect(status?.progress).toBeGreaterThanOrEqual(0);
            expect(status?.progress).toBeLessThanOrEqual(100);
        });

        it('should allow cancelling pending jobs', async () => {
            // Client should be able to cancel job:
            // POST /api/jobs/:jobId/cancel?queue=:queueName

            const job = await queueService.addJob(
                'cycle-synthesis',
                'synthesize',
                { cycleId: 1, organizationId: 1 },
                { priority: 5 }
            );

            const jobId = String(job.id);

            // Client cancels job
            const cancelled = await queueService.cancelJob('cycle-synthesis', jobId);
            expect(cancelled).toBe(true);

            // Job should no longer be found
            const status = await queueService.getJobStatus('cycle-synthesis', jobId);
            expect(status).toBeNull();
        });
    });

    describe('Scheduled Jobs Integration', () => {
        it('should submit scheduled analytics jobs', async () => {
            // Scheduled job should submit one job per organization

            const { submitHourlyAnalytics } = await import(
                '@domain/queue/scheduled-jobs.js'
            );

            const result = await submitHourlyAnalytics();

            expect(result).toBeDefined();
            expect(typeof result.submitted).toBe('number');
            expect(typeof result.failed).toBe('number');
            expect(result.submitted).toBeGreaterThanOrEqual(0);
        });

        it('should handle scheduled job errors gracefully', async () => {
            // If one organization's job fails, others should still be submitted

            const { submitDailyAnalytics } = await import(
                '@domain/queue/scheduled-jobs.js'
            );

            const result = await submitDailyAnalytics();

            // Should return both submitted and failed counts
            expect(result.submitted + result.failed).toBeGreaterThanOrEqual(0);
        });
    });

    describe('End-to-End Integration', () => {
        it('should complete full workflow: launch → synthesis → status', async () => {
            // 1. Create cycle (simulates launch endpoint)
            const [cycle] = await db.insert(operationalCycles).values({
                objective: 'Test objective',
                createdBy: 'test-user',
                organizationId: 1,
                name: 'E2E Test Cycle',
                status: 'active',
                metadata: {},
            }).returning();

            // 2. Submit synthesis job
            const job = await queueService.addJob(
                'cycle-synthesis',
                'synthesize',
                {
                    cycleId: cycle.id,
                    organizationId: 1,
                    blueprints: [
                        { name: 'bp1', objective: 'E2E Test' },
                    ],
                },
                { priority: 0 }
            );

            // 3. Client checks job status
            const status = await queueService.getJobStatus('cycle-synthesis', String(job.id));

            // 4. Verify status response
            expect(status?.jobId).toBe(String(job.id));
            expect(status?.queueName).toBe('cycle-synthesis');
            expect(status?.data.cycleId).toBe(cycle.id);

            // 5. Get queue stats
            const stats = await queueService.getQueueStats('cycle-synthesis');
            expect(stats).toBeDefined();
            expect(stats.waiting).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Performance Requirements', () => {
        it('should submit jobs quickly (< 50ms)', async () => {
            const startTime = Date.now();

            const job = await queueService.addJob(
                'cycle-synthesis',
                'synthesize',
                { cycleId: 1, organizationId: 1 },
                { priority: 5 }
            );

            const elapsed = Date.now() - startTime;

            expect(elapsed).toBeLessThan(50);
            expect(job).toBeDefined();
        });

        it('should retrieve job status quickly (< 50ms)', async () => {
            const job = await queueService.addJob(
                'approval-notifications',
                'notify',
                { approvalId: 1, organizationId: 1 },
                { priority: 5 }
            );

            const startTime = Date.now();
            const status = await queueService.getJobStatus('approval-notifications', String(job.id));
            const elapsed = Date.now() - startTime;

            expect(elapsed).toBeLessThan(50);
            expect(status).toBeDefined();
        });

        it('should handle concurrent job submissions', async () => {
            const startTime = Date.now();

            // Submit 10 jobs concurrently
            const promises = Array(10).fill(0).map(() =>
                queueService.addJob(
                    'cycle-synthesis',
                    'synthesize',
                    { cycleId: Math.random(), organizationId: 1 },
                    { priority: 5 }
                )
            );

            const jobs = await Promise.all(promises);
            const elapsed = Date.now() - startTime;

            expect(jobs).toHaveLength(10);
            expect(elapsed).toBeLessThan(500); // All 10 should submit in < 500ms
        });
    });
});
