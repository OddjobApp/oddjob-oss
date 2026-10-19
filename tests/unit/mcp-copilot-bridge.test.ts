import { describe, it, expect } from "vitest";
import { McpCopilotBridgeService } from "../../server/domain/ai/core/mcp-copilot-bridge.service.js";

describe("MCP Copilot Bridge Service Integration", () => {
    it("should filter MCP tools based on lifecycle phase", () => {
        const tools = [
            { name: "read_file", description: "Read file contents" },
            { name: "delete_database_table", description: "Drop DB table" },
            { name: "deploy_service", description: "Deploy service" }
        ];

        const readOnlyTools = McpCopilotBridgeService.filterMcpToolsForStage("Diagnose", tools);
        expect(readOnlyTools.length).toBe(1);
        expect(readOnlyTools[0].name).toBe("read_file");
    });

    it("should permit low-risk MCP tool execution", () => {
        const result = McpCopilotBridgeService.governMcpToolCall({
            agentId: "dispatch_agent",
            stage: "Diagnose",
            serverName: "fs_server",
            toolName: "read_logs",
            toolArguments: { path: "/var/log/dispatch.log" }
        });

        expect(result.permitted).toBe(true);
        expect(result.trajectoryResult.safeTransitionScore).toBeGreaterThan(0.85);
    });

    it("should block restricted MCP tools and emit GQE FormAgent payload", () => {
        const result = McpCopilotBridgeService.governMcpToolCall({
            agentId: "dispatch_agent",
            stage: "Deploy",
            serverName: "k8s_server",
            toolName: "deploy_production",
            toolArguments: { target: "prod-cluster" },
            userRoles: ["operator"]
        });

        expect(result.permitted).toBe(false);
        expect(result.gqeQuestion).toBeDefined();
        expect(result.gqeQuestion?.formAgentPayload.type).toBe("FormAgent");
    });
});
