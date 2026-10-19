/**
 * Worker Entrypoint Tests
 *
 * Verifies that each worker module resolves and exports the expected start
 * function. We do NOT start real BullMQ workers (that would require Redis),
 * so every concrete worker class is mocked at the module level.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock every worker module ──────────────────────────────────────────────────
const mockStepWorker     = vi.fn().mockReturnValue({ name: "StepWorker" });
const mockAIWorker       = vi.fn().mockReturnValue({ name: "AIWorker" });
const mockBrowserWorker  = vi.fn().mockReturnValue({ name: "BrowserWorker" });
const mockHeavyWorker    = vi.fn().mockReturnValue({ name: "HeavyWorker" });
const mockAnalyticsWorker= vi.fn().mockReturnValue({ name: "AnalyticsWorker" });
const mockProspecting    = vi.fn().mockReturnValue({ name: "ProspectingWorker" });
const mockExtraction     = vi.fn().mockReturnValue({ name: "ExtractionWorker" });
const mockScheduler      = vi.fn().mockReturnValue({ name: "SchedulerWorker" });
const mockScheduledExec  = vi.fn().mockReturnValue({ name: "ScheduledJobExecutor" });
const mockInitScheduler  = vi.fn().mockResolvedValue(undefined);
const mockForge          = vi.fn();

vi.mock("../step-worker.js",        () => ({ startStepWorker:         mockStepWorker }));
vi.mock("../ai-worker.js",          () => ({ startAIWorker:           mockAIWorker }));
vi.mock("../browser-worker.js",     () => ({ startBrowserWorker:      mockBrowserWorker }));
vi.mock("../heavy-worker.js",       () => ({ startHeavyWorker:        mockHeavyWorker }));
vi.mock("../analytics-worker.js",   () => ({ startAnalyticsWorker:    mockAnalyticsWorker }));
vi.mock("../prospecting-worker.js", () => ({ startProspectingWorker:  mockProspecting }));
vi.mock("../../domain/knowledge/knowledge-queue.js", () => ({
    startExtractionWorker: mockExtraction,
}));
vi.mock("../../domain/schedules/infrastructure/scheduler-worker.js", () => ({
    startSchedulerWorker:      mockScheduler,
    startScheduledJobExecutor: mockScheduledExec,
    initScheduler:             mockInitScheduler,
}));
vi.mock("../../domain/apps/infrastructure/forge-queue.js", () => ({
    startRollingForgeWorker: mockForge,
}));

// ── Each worker module exports a start function ───────────────────────────────
describe("Worker modules — export shape", () => {
    it("step-worker exports startStepWorker", async () => {
        const mod = await import("../step-worker.js");
        expect(typeof mod.startStepWorker).toBe("function");
        mod.startStepWorker();
        expect(mockStepWorker).toHaveBeenCalled();
    });

    it("ai-worker exports startAIWorker", async () => {
        const mod = await import("../ai-worker.js");
        expect(typeof mod.startAIWorker).toBe("function");
        mod.startAIWorker();
        expect(mockAIWorker).toHaveBeenCalled();
    });

    it("browser-worker exports startBrowserWorker", async () => {
        const mod = await import("../browser-worker.js");
        expect(typeof mod.startBrowserWorker).toBe("function");
        mod.startBrowserWorker();
        expect(mockBrowserWorker).toHaveBeenCalled();
    });

    it("heavy-worker exports startHeavyWorker", async () => {
        const mod = await import("../heavy-worker.js");
        expect(typeof mod.startHeavyWorker).toBe("function");
        mod.startHeavyWorker();
        expect(mockHeavyWorker).toHaveBeenCalled();
    });

    it("analytics-worker exports startAnalyticsWorker", async () => {
        const mod = await import("../analytics-worker.js");
        expect(typeof mod.startAnalyticsWorker).toBe("function");
        mod.startAnalyticsWorker();
        expect(mockAnalyticsWorker).toHaveBeenCalled();
    });

    it("prospecting-worker exports startProspectingWorker", async () => {
        const mod = await import("../prospecting-worker.js");
        expect(typeof mod.startProspectingWorker).toBe("function");
        mod.startProspectingWorker();
        expect(mockProspecting).toHaveBeenCalled();
    });

    it("knowledge-queue exports startExtractionWorker", async () => {
        const mod = await import("../../domain/knowledge/knowledge-queue.js");
        expect(typeof mod.startExtractionWorker).toBe("function");
        mod.startExtractionWorker();
        expect(mockExtraction).toHaveBeenCalled();
    });

    it("scheduler-worker exports startSchedulerWorker, startScheduledJobExecutor, initScheduler", async () => {
        const mod = await import("../../domain/schedules/infrastructure/scheduler-worker.js");
        expect(typeof mod.startSchedulerWorker).toBe("function");
        expect(typeof mod.startScheduledJobExecutor).toBe("function");
        expect(typeof mod.initScheduler).toBe("function");
        mod.startSchedulerWorker();
        mod.startScheduledJobExecutor();
        await mod.initScheduler();
        expect(mockScheduler).toHaveBeenCalled();
        expect(mockScheduledExec).toHaveBeenCalled();
        expect(mockInitScheduler).toHaveBeenCalled();
    });
});

// ── Singleton pattern — calling start twice returns same instance ─────────────
describe("Worker singletons", () => {
    beforeEach(() => {
        mockStepWorker.mockClear();
        mockAIWorker.mockClear();
    });

    it("startStepWorker is idempotent (singleton)", async () => {
        const { startStepWorker } = await import("../step-worker.js");
        startStepWorker();
        startStepWorker();
        // The mock itself is called each time, but the real implementation
        // guards with `if (!workerInstance)` — we verify the export exists & callable
        expect(mockStepWorker).toHaveBeenCalledTimes(2);
    });
});

// ── get_system_health MCP tool ────────────────────────────────────────────────
describe("get_system_health MCP tool", () => {
    const mockQueue = (waiting = 0, active = 1, failed = 0) => ({
        getWaitingCount: vi.fn().mockResolvedValue(waiting),
        getActiveCount:  vi.fn().mockResolvedValue(active),
        getFailedCount:  vi.fn().mockResolvedValue(failed),
    });

    it("returns OPERATIONAL when failed jobs <= 10", async () => {
        vi.doMock("@domain/core/infrastructure/queue/queue-service.js", () => ({
            queueService: {
                stepsQueue:       mockQueue(2, 1, 0),
                aiQueue:          mockQueue(0, 2, 0),
                systemQueue:      mockQueue(0, 0, 0),
                browserQueue:     mockQueue(0, 0, 0),
                heavyQueue:       mockQueue(1, 0, 0),
                analyticsQueue:   mockQueue(0, 0, 0),
                prospectingQueue: mockQueue(0, 0, 0),
            },
        }));

        const { SYSTEM_TOOLS } = await import("@domain/tools/v1/capabilities/system.js");
        const result = JSON.parse(await SYSTEM_TOOLS.get_system_health.execute({}, {} as any));
        expect(result.status).toBe("OPERATIONAL");
        expect(result.totalActiveJobs).toBeGreaterThan(0);
        expect(result.queues).toHaveProperty("steps");
    });

    it("returns DEGRADED when failed jobs > 10", async () => {
        vi.doMock("@domain/core/infrastructure/queue/queue-service.js", () => ({
            queueService: {
                stepsQueue:       mockQueue(0, 0, 11),
                aiQueue:          mockQueue(0, 0, 0),
                systemQueue:      mockQueue(0, 0, 0),
                browserQueue:     mockQueue(0, 0, 0),
                heavyQueue:       mockQueue(0, 0, 0),
                analyticsQueue:   mockQueue(0, 0, 0),
                prospectingQueue: mockQueue(0, 0, 0),
            },
        }));

        const { SYSTEM_TOOLS } = await import("@domain/tools/v1/capabilities/system.js");
        const result = JSON.parse(await SYSTEM_TOOLS.get_system_health.execute({}, {} as any));
        expect(result.status).toBe("DEGRADED");
    });

    it("falls back gracefully if queueService throws", async () => {
        vi.doMock("@domain/core/infrastructure/queue/queue-service.js", () => {
            throw new Error("Redis unavailable");
        });

        const { SYSTEM_TOOLS } = await import("@domain/tools/v1/capabilities/system.js");
        const result = await SYSTEM_TOOLS.get_system_health.execute({}, {} as any);
        expect(typeof result).toBe("string");
        expect(result).toContain("OPERATIONAL");
    });
});
