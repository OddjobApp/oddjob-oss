import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { QueueService } from "@domain/core/infrastructure/queue/queue-service.js";
import { prospectingRouter } from '../../../server/domain/prospecting/prospecting.route';
import { db } from '../../../server/db';
import { ProspectingWorker } from '../../../server/workers/prospecting-worker';
import { prospectingService } from '../../../server/domain/prospecting/prospecting.service';

// Mock dependencies
vi.mock('@domain/core/infrastructure/queue/queue-service.js', () => {
    return {
        QUEUE_NAMES: { PROSPECTING: 'oddjob-prospecting' },
        queueService: {
            addJobWithTrace: vi.fn(),
            prospectingQueue: {}
        }
    };
});

vi.mock('../../../server/domain/prospecting/prospecting.service', () => {
    return {
        prospectingService: {
            processEvent: vi.fn(),
            enqueueBatchedEvents: vi.fn().mockResolvedValue({ count: 2, mainProspectUid: 'user-1' })
        }
    };
});

vi.mock('../../../server/db', () => ({
    db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockReturnThis(),
    }
}));

vi.mock('bullmq', () => {
    class MockWorker {
        on = vi.fn();
        close = vi.fn();
    }
    class MockQueue {
        add = vi.fn();
        close = vi.fn();
    }
    class MockQueueEvents {
        close = vi.fn();
    }
    return {
        Queue: MockQueue,
        Worker: MockWorker,
        QueueEvents: MockQueueEvents,
    };
});

// The specifier carried a literal `from "..."` inside the string, so this
// mocked nothing — the same copy-paste artifact that was in this file's
// imports.
vi.mock('@domain/core/infrastructure/redis/redis-client.js', async () => {
    const { redisClientMockModule } = await import('../../../tests/helpers/ioredis-mock.js');
    return redisClientMockModule();
});

/**
 * The ingest route is guarded: propertyIngestGuard looks the propertyUid up
 * and answers 403 for an unknown property, then checks the request origin
 * against the property's domain. These tests are about batching and queueing
 * and post a fixture uid that no property owns, so every one of them was
 * refused before reaching the handler. The guard is exercised on its own in
 * prospecting-ingest-guard.test.ts.
 */
vi.mock('../../../server/domain/prospecting/ingest-guard.js', () => ({
    propertyIngestGuard: () => (_req: any, _res: any, next: any) => next(),
    invalidatePropertyCache: vi.fn(),
}));

// Setup Express app for route testing
const app = express();
app.use(express.json());
// Mock privacy middleware
app.use((req, res, next) => next());
app.use('/api/prospecting', prospectingRouter);

describe('Prospecting Asynchronous Event Ingestion', () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('POST /api/prospecting/events Batch Processing', () => {
        it('should accept a batched payload and return 202 Accepted instantly', async () => {
            const { queueService } = await import('@domain/core/infrastructure/queue/queue-service.js');

            const batchedPayload = [
                {
                    propertyUid: 'test-prop-uid',
                    prospectUid: 'user-1',
                    activity: 'page_view',
                    payload: { url: '/pricing' }
                },
                {
                    propertyUid: 'test-prop-uid',
                    prospectUid: 'user-1',
                    activity: 'click',
                    payload: { selector: 'button.checkout' }
                }
            ];

            const response = await request(app)
                .post('/api/prospecting/events')
                .send(batchedPayload);

            expect(response.status).toBe(202);
            expect(response.body).toEqual({
                status: "accepted",
                prospectUid: "user-1"
            });

            // Verify service was called with correct batch
            expect(prospectingService.enqueueBatchedEvents).toHaveBeenCalledTimes(1);
            expect(prospectingService.enqueueBatchedEvents).toHaveBeenCalledWith(
                batchedPayload,
                undefined,
                expect.any(String) // IP Address
            );
        });

        it('should reject empty payloads', async () => {
            const response = await request(app)
                .post('/api/prospecting/events')
                .send([]);

            expect(response.status).toBe(400);
            expect(response.body.error).toBe('Empty payload');
        });

        it('should handle single event payloads seamlessly', async () => {
            const { queueService } = await import('@domain/core/infrastructure/queue/queue-service.js');

            const singlePayload = {
                propertyUid: 'test-prop-uid-2',
                prospectUid: 'user-2',
                activity: 'dwell',
                payload: { duration: 30 }
            };

            const response = await request(app)
                .post('/api/prospecting/events')
                .send(singlePayload);

            expect(response.status).toBe(202);
            expect(prospectingService.enqueueBatchedEvents).toHaveBeenCalledTimes(1);
        });
    });

    describe('ProspectingWorker Execution', () => {
        it('should process jobs from the queue via the prospecting service', async () => {
            const worker = new ProspectingWorker();

            const mockJob = {
                id: 'job-123',
                data: {
                    propertyUid: 'prop-1',
                    prospectUid: 'visitor-1',
                    activity: 'click',
                    payload: {},
                    themes: []
                }
            };

            // @ts-ignore - accessing protected method for testing
            await worker.execute(mockJob as any);

            expect(prospectingService.processEvent).toHaveBeenCalledTimes(1);
            expect(prospectingService.processEvent).toHaveBeenCalledWith(mockJob.data);
        });
    });
});
