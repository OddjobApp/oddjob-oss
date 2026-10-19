/**
 * CausalTracer Tests — full graph mock coverage
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateNode, mockCreateEdge } = vi.hoisted(() => ({
    mockCreateNode: vi.fn(),
    mockCreateEdge: vi.fn()
}));

vi.mock("@domain/knowledge/core/graph/graph-service.js", () => ({
    graphService: {
        createNode: mockCreateNode,
        createEdge: mockCreateEdge
    }
}));

vi.mock("@server/utils/logger", () => ({
    createLogger: vi.fn(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }))
}));

vi.mock("@domain/jobs/job.service.js", () => ({ OrgContext: {} }));

import { CausalTracer } from "@domain/core/infrastructure/causal-tracer.service.js";

describe("CausalTracer", () => {
    let tracer: CausalTracer;

    beforeEach(() => {
        vi.clearAllMocks();
        tracer = new CausalTracer({
            sessionId: "sess-123",
            organizationId: 1,
            jobId: 42,
            missionId: 10,
            userId: "user-1"
        });
    });

    describe("traceThought", () => {
        it("should create a node and return its id", async () => {
            mockCreateNode.mockResolvedValue({ id: 100 });
            const id = await tracer.traceThought("Thinking about step", 1);
            expect(id).toBe(100);
            expect(mockCreateNode).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: "Reasoning: Step 1",
                    label: "AgentReasoning",
                    properties: expect.objectContaining({ type: "thought", iteration: 1 })
                }),
                expect.objectContaining({ organizationId: 1 })
            );
        });

        it("should truncate long content to 200 chars with ellipsis", async () => {
            mockCreateNode.mockResolvedValue({ id: 1 });
            const longContent = "A".repeat(250);
            await tracer.traceThought(longContent, 1);
            const call = mockCreateNode.mock.calls[0][0];
            expect(call.description).toHaveLength(203); // 200 + "..."
            expect(call.description.endsWith("...")).toBe(true);
        });

        it("should not add ellipsis for content <= 200 chars", async () => {
            mockCreateNode.mockResolvedValue({ id: 1 });
            const shortContent = "A".repeat(100);
            await tracer.traceThought(shortContent, 1);
            const call = mockCreateNode.mock.calls[0][0];
            expect(call.description.endsWith("...")).toBe(false);
        });

        it("should link to previous node after second trace", async () => {
            mockCreateNode
                .mockResolvedValueOnce({ id: 1 })
                .mockResolvedValueOnce({ id: 2 });
            mockCreateEdge.mockResolvedValue({});

            await tracer.traceThought("first", 1);
            await tracer.traceThought("second", 2);

            expect(mockCreateEdge).toHaveBeenCalledWith(
                expect.objectContaining({ sourceNodeId: 1, targetNodeId: 2, relation: "FOLLOWED_BY" }),
                expect.anything()
            );
        });

        it("should return null and not throw on error", async () => {
            mockCreateNode.mockRejectedValue(new Error("DB down"));
            const id = await tracer.traceThought("thought", 1);
            expect(id).toBeNull();
        });
    });

    describe("traceToolExecution", () => {
        it("should create an action node with tool details", async () => {
            mockCreateNode.mockResolvedValue({ id: 200 });
            const id = await tracer.traceToolExecution("search_tool", { query: "hello" }, "result text", 2);
            expect(id).toBe(200);
            expect(mockCreateNode).toHaveBeenCalledWith(
                expect.objectContaining({
                    name: "Action: search_tool",
                    properties: expect.objectContaining({ type: "tool_execution", tool: "search_tool" })
                }),
                expect.anything()
            );
        });

        it("should truncate output preview at 1000 chars", async () => {
            mockCreateNode.mockResolvedValue({ id: 1 });
            const longOutput = "X".repeat(1500);
            await tracer.traceToolExecution("tool", {}, longOutput, 1);
            const props = mockCreateNode.mock.calls[0][0].properties;
            expect(props.outputPreview).toHaveLength(1000);
        });

        it("should link to previous node in chain", async () => {
            mockCreateNode
                .mockResolvedValueOnce({ id: 10 })
                .mockResolvedValueOnce({ id: 20 });
            mockCreateEdge.mockResolvedValue({});

            await tracer.traceThought("thought", 1);
            await tracer.traceToolExecution("my_tool", {}, "output", 2);

            expect(mockCreateEdge).toHaveBeenCalledWith(
                expect.objectContaining({ sourceNodeId: 10, targetNodeId: 20 }),
                expect.anything()
            );
        });

        it("should return null on error", async () => {
            mockCreateNode.mockRejectedValue(new Error("fail"));
            const id = await tracer.traceToolExecution("tool", {}, "output", 1);
            expect(id).toBeNull();
        });

        it("should suppress edge link errors gracefully", async () => {
            mockCreateNode
                .mockResolvedValueOnce({ id: 1 })
                .mockResolvedValueOnce({ id: 2 });
            // Edge link fails
            mockCreateEdge.mockRejectedValue(new Error("edge fail"));

            const first = await tracer.traceThought("thought", 1);
            const second = await tracer.traceToolExecution("tool", {}, "out", 2);

            // Both return IDs despite edge failure
            expect(first).toBe(1);
            expect(second).toBe(2);
        });
    });
});
