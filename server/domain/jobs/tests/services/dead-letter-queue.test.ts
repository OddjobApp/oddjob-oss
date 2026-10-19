/**
 * DeadLetterQueue Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { moveToDeadLetterQueue, retryDLQJob, dlqQueue } from "@domain/core/infrastructure/queue/dead-letter-queue.service.js";
import { db } from "@server/database_service.js";

// Mock BullMQ - Must be hoisted or handled carefully for constructor usage
vi.mock("bullmq", () => {
    const QueueMock = {
        add: vi.fn().mockResolvedValue({ id: "new-job-id" }),
        getJob: vi.fn(),
        getJobs: vi.fn().mockResolvedValue([]),
        getWaitingCount: vi.fn().mockResolvedValue(0),
        getDelayedCount: vi.fn().mockResolvedValue(0),
    };

    // Using a function that can be used as a constructor
    const QueueFn = vi.fn().mockImplementation(function () {
        return QueueMock;
    });

    return {
        Queue: QueueFn,
        Job: vi.fn(),
        QueueEvents: vi.fn().mockImplementation(function () {
            return { on: vi.fn() };
        })
    };
});

// Mock DB
vi.mock("@server/database_service.js", () => {
    const mockDb = {
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockResolvedValue({}),
    };
    return { db: mockDb };
});

describe("DeadLetterQueue", () => {

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("moveToDeadLetterQueue", () => {
        it("adds job to DLQ and creates alert", async () => {
            const mockJob = {
                id: "job-123",
                name: "test-job",
                data: { foo: "bar" },
                attemptsMade: 3
            };
            const mockError = new Error("Max retries exceeded");
            mockError.stack = "Error: Max retries exceeded\n at line 1";

            await moveToDeadLetterQueue(mockJob as any, mockError, "main-queue");

            // Check DLQ addition
            expect(dlqQueue.add).toHaveBeenCalledWith(
                "failed-job",
                expect.objectContaining({
                    originalQueue: "main-queue",
                    originalJobId: "job-123",
                    jobName: "test-job",
                    error: "Max retries exceeded"
                }),
                expect.any(Object)
            );

            // Check alert creation
            expect(db.insert).toHaveBeenCalled();
            expect((db as any).values).toHaveBeenCalledWith(expect.objectContaining({
                category: "job_failure",
                message: expect.stringContaining("test-job")
            }));
        });
    });

    describe("retryDLQJob", () => {
        it("re-enqueues job to original queue and removes from DLQ", async () => {
            const mockDlqJob = {
                id: "dlq-1",
                data: {
                    originalQueue: "original-q",
                    jobName: "retry-me",
                    data: { key: "val" }
                },
                remove: vi.fn().mockResolvedValue(undefined)
            };
            (dlqQueue.getJob as any).mockResolvedValueOnce(mockDlqJob);

            const result = await retryDLQJob("dlq-1");

            expect(result).toBe(true);

            // Check that a Queue was created for the original queue name
            // Note: dlqQueue itself is a Queue created at module load
            const { Queue } = await import("bullmq");
            expect(Queue).toHaveBeenCalledWith("original-q", expect.any(Object));

            expect(mockDlqJob.remove).toHaveBeenCalled();
        });

        it("returns false if job not found in DLQ", async () => {
            (dlqQueue.getJob as any).mockResolvedValueOnce(null);
            const result = await retryDLQJob("missing");
            expect(result).toBe(false);
        });
    });
});
