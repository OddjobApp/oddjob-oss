/**
 * Agent Orchestrator Unit Tests (Simplified Injection)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dynamic imports only
vi.mock("@domain/knowledge/core/sidecar-sync-service.js", () => ({
    sidecarSyncService: { logObservation: vi.fn().mockResolvedValue(undefined) }
}));

vi.mock("@domain/knowledge/core/rag.service.js", () => ({
    ragService: { fetchRelevantExamples: vi.fn().mockResolvedValue({ context: "examples" }) }
}));

vi.mock("@domain/governor/core/governor-service.js", () => ({
    governorService: { redactSensitiveData: vi.fn(x => x) }
}));

// Mock logger to avoid noise
vi.mock("@server/utils/logger", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    })),
}));

// Note: ToolExecutor.execute is static, so we mock it specifically
vi.mock("@domain/tools/v1/tool-executor.service.js", () => ({
    ToolExecutor: {
        execute: vi.fn().mockResolvedValue("Observation")
    }
}));

vi.mock("@domain/agents/core/critic-service.js", () => ({
    criticService: {
        assessInteraction: vi.fn().mockResolvedValue({ score: 8, criticism: "ok", issues: [] }),
        getRelevantCritiques: vi.fn().mockResolvedValue([])
    }
}));

import { AgentOrchestrator } from "@domain/agents/core/agent-orchestrator.js";
import { ToolExecutor } from "@domain/tools/v1/tool-executor.service.js";

describe("AgentOrchestrator", () => {
    const mockClient = { execute: vi.fn() };
    const context: any = { organizationId: 1, userId: "u1" };
    let orchestrator: AgentOrchestrator;

    beforeEach(() => {
        vi.clearAllMocks();
        orchestrator = new AgentOrchestrator(mockClient as any, "api-key", context);
    });

    it("should run the loop and return final answer", async () => {
        // Mock the manifest generation (AutonomousLifecycleManager.plan)
        mockClient.execute
            .mockResolvedValueOnce({ // plan() call
                success: true,
                output: '```json\n{"goal":"Goal","strategy":"S","steps":[],"createdAt":"2024-01-01T00:00:00Z"}\n```'
            })
            .mockResolvedValueOnce({ // first iteration execute() call
                success: true,
                output: '{"final_answer": "Complete!"}',
                metadata: { tokensUsed: 10 }
            });

        const result = await orchestrator.run("Goal", {} as any, [], 5);
        expect(result.output).toBe("Complete!");
        expect(mockClient.execute).toHaveBeenCalledTimes(2);
    });

    it("should invoke tools and continue loop if no final answer", async () => {
        mockClient.execute
            .mockResolvedValueOnce({ // plan()
                success: true,
                output: '```json\n{"goal":"Goal","strategy":"S","steps":[],"createdAt":"2024-01-01T00:00:00Z"}\n```'
            })
            .mockResolvedValueOnce({ // iteration 1 execute()
                success: true,
                output: '{"tool": "t1", "params": {}}'
            })
            .mockResolvedValueOnce({ // iteration 2 execute()
                success: true,
                output: '{"final_answer": "Done after tool!"}'
            });

        const result = await orchestrator.run("Goal", {} as any, [{ name: "t1" }], 5);
        expect(ToolExecutor.execute).toHaveBeenCalled();
        expect(result.output).toBe("Done after tool!");
    });
});
