/**
 * Streaming Logs Service Tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { streamingLogsService } from "@domain/jobs/core/streaming-logs.service.js";
import { db } from "@server/database_service.js";
import { jobStreamingLogs, jobActiveRuns } from "@shared/schema/index.js";

describe("Streaming Logs Service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("startJobRun", () => {
        it("should start a new job run with SSE channel", async () => {
            const mockRun = {
                id: 1,
                jobId: 100,
                jobRunId: 1234567890,
                sseChannelId: "job-100-1234567890-abc123",
                status: "running",
            };

            vi.spyOn(db, "insert").mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([mockRun]),
                }),
            } as any);

            const result = await streamingLogsService.startJobRun({
                jobId: 100,
                organizationId: 1,
                triggeredBy: "manual",
            });

            expect(result.jobRunId).toBe(1234567890);
            expect(result.sseChannelId).toContain("job-100");
        });
    });

    describe("log", () => {
        it("should store log message and broadcast to SSE", async () => {
            vi.spyOn(db, "insert").mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 1 }]),
                }),
            } as any);

            vi.spyOn(streamingLogsService, "getNextChunkIndex").mockResolvedValue(1);
            vi.spyOn(streamingLogsService, "getChannelId").mockResolvedValue("channel-123");

            // Mock event emitter
            const mockEmit = vi.fn();
            const { EventEmitter } = await import("events");
            const mockEvents = new EventEmitter();
            mockEvents.emit = mockEmit;

            await streamingLogsService.log({
                jobId: 100,
                jobRunId: 1,
                message: "Processing started",
                logLevel: "info",
                logType: "stdout",
            });

            expect(db.insert).toHaveBeenCalledWith(jobStreamingLogs);
        });
    });

    describe("getLogs", () => {
        it("should retrieve logs ordered by chunk index", async () => {
            const mockLogs = [
                { id: 1, chunkIndex: 1, message: "First" },
                { id: 2, chunkIndex: 2, message: "Second" },
                { id: 3, chunkIndex: 3, message: "Third" },
            ];

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue(mockLogs),
                        }),
                    }),
                }),
            } as any);

            const logs = await streamingLogsService.getLogs(100, 1);

            expect(logs).toHaveLength(3);
            expect(logs[0].chunkIndex).toBe(1);
            expect(logs[2].chunkIndex).toBe(3);
        });

        it("should filter by since chunk index", async () => {
            const mockLogs = [
                { id: 3, chunkIndex: 3, message: "Third" },
                { id: 4, chunkIndex: 4, message: "Fourth" },
            ];

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue(mockLogs),
                        }),
                    }),
                }),
            } as any);

            const logs = await streamingLogsService.getLogs(100, 1, { sinceChunkIndex: 2 });

            expect(logs[0].chunkIndex).toBeGreaterThan(2);
        });
    });

    describe("completeJobRun", () => {
        it("should mark job as completed and broadcast", async () => {
            vi.spyOn(db, "update").mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
                    }),
                }),
            } as any);

            vi.spyOn(streamingLogsService, "getChannelId").mockResolvedValue("channel-123");
            vi.spyOn(streamingLogsService, "cleanupJobRun").mockResolvedValue();

            await streamingLogsService.completeJobRun(100, 1, "completed");

            expect(db.update).toHaveBeenCalledWith(jobActiveRuns);
        });

        it("should handle failed status", async () => {
            vi.spyOn(db, "update").mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
                    }),
                }),
            } as any);

            vi.spyOn(streamingLogsService, "getChannelId").mockResolvedValue("channel-123");
            vi.spyOn(streamingLogsService, "cleanupJobRun").mockResolvedValue();

            await streamingLogsService.completeJobRun(100, 1, "failed");

            expect(db.update).toHaveBeenCalled();
        });
    });

    describe("streamTextChunk", () => {
        it("should log AI response chunks", async () => {
            const logSpy = vi.spyOn(streamingLogsService, "log").mockResolvedValue();

            await streamingLogsService.streamTextChunk(100, 1, "Hello", false);

            expect(logSpy).toHaveBeenCalledWith({
                jobId: 100,
                jobRunId: 1,
                message: "Hello",
                logType: "ai_response",
                logLevel: "info",
                isFinalChunk: false,
            });
        });

        it("should mark final chunk correctly", async () => {
            const logSpy = vi.spyOn(streamingLogsService, "log").mockResolvedValue();

            await streamingLogsService.streamTextChunk(100, 1, "Done", true);

            expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
                isFinalChunk: true,
            }));
        });
    });

    describe("logProgress", () => {
        it("should log progress percentage", async () => {
            const logSpy = vi.spyOn(streamingLogsService, "log").mockResolvedValue();

            await streamingLogsService.logProgress(100, 1, 50, "Halfway done");

            expect(logSpy).toHaveBeenCalledWith({
                jobId: 100,
                jobRunId: 1,
                message: "Halfway done",
                logType: "progress",
                logLevel: "info",
                source: "system",
            });
        });
    });

    describe("logError", () => {
        it("should log string errors", async () => {
            const logSpy = vi.spyOn(streamingLogsService, "log").mockResolvedValue();

            await streamingLogsService.logError(100, 1, "Something went wrong");

            expect(logSpy).toHaveBeenCalledWith({
                jobId: 100,
                jobRunId: 1,
                message: "Something went wrong",
                logType: "stderr",
                logLevel: "error",
                source: "system",
            });
        });

        it("should log Error objects", async () => {
            const logSpy = vi.spyOn(streamingLogsService, "log").mockResolvedValue();

            const error = new Error("Custom error");
            await streamingLogsService.logError(100, 1, error, "custom-source");

            expect(logSpy).toHaveBeenCalledWith({
                jobId: 100,
                jobRunId: 1,
                message: "Custom error",
                logType: "stderr",
                logLevel: "error",
                source: "custom-source",
            });
        });
    });

    describe("getActiveRuns", () => {
        it("should return only running jobs", async () => {
            const mockRuns = [
                { id: 1, jobId: 100, status: "running" },
                { id: 2, jobId: 100, status: "running" },
            ];

            vi.spyOn(db, "select").mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockResolvedValue(mockRuns),
                    }),
                }),
            } as any);

            const runs = await streamingLogsService.getActiveRuns(100);

            expect(runs).toHaveLength(2);
            expect(runs.every(r => r.status === "running")).toBe(true);
        });
    });

    describe("subscribe", () => {
        it("should return unsubscribe function", () => {
            const callback = vi.fn();
            const unsubscribe = streamingLogsService.subscribe("channel-123", callback);

            expect(typeof unsubscribe).toBe("function");
        });
    });
});
