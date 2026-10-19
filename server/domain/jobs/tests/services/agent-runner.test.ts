/**
 * Agent Runner Unit Tests (Simplified Injection)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies only
vi.mock("@domain/tools/v1/tool-registry.service.js", () => ({
    AGENT_TOOLS: { "t1": { name: "t1", execute: vi.fn() } },
    normalizeToolName: (name: string) => name,
}));

vi.mock("@server/utils/logger", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn(),
    })),
}));

// Mock dynamic imports needed by Orchestrator
vi.mock("@domain/knowledge/core/sidecar-sync-service.js", () => ({
    sidecarSyncService: { logObservation: vi.fn().mockResolvedValue(undefined) }
}));

vi.mock("@domain/agents/core/critic-service.js", () => ({
    criticService: {
        assessInteraction: vi.fn().mockResolvedValue({ score: 8, criticism: "ok", issues: [] }),
        getRelevantCritiques: vi.fn().mockResolvedValue([])
    }
}));

import { runAgentLoop } from "@domain/agents/agent-runner.js";

describe("AgentRunner", () => {
    const mockClient = { execute: vi.fn() };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("should execute the loop through the real orchestrator with a mock client", async () => {
        mockClient.execute
            .mockResolvedValueOnce({ // plan()
                success: true,
                output: '```json\n{"goal":"Goal","strategy":"S","steps":[],"createdAt":"2024-01-01T00:00:00Z"}\n```'
            })
            .mockResolvedValueOnce({ // iteration 1 execute()
                success: true,
                output: '{"final_answer": "Done!"}'
            });

        const result = await runAgentLoop(
            mockClient as any,
            {} as any,
            "Goal",
            ["t1"],
            5,
            "key"
        );

        expect(result.output).toBe("Done!");
        expect(mockClient.execute).toHaveBeenCalledTimes(2);
    });
});
