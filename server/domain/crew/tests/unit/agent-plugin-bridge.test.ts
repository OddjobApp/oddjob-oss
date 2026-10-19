import { describe, it, expect, beforeEach } from "vitest";
import { agentPluginBridge } from "../../core/agent-plugin-bridge.service.js";

describe("AgentPluginBridgeService", () => {
    beforeEach(() => {
        agentPluginBridge.clear();
    });

    it("registers third-party plugins and executes sandboxed tool capabilities", async () => {
        agentPluginBridge.registerPlugin({
            id: "plugin_fin_calc",
            name: "Financial ROI Calculator",
            version: "1.0.0",
            author: "Oddjob FinOps Team",
            sandboxLevel: "isolated",
            capabilities: [
                {
                    name: "calculate_projected_savings",
                    description: "Calculates projected annual savings under SLM model routing",
                    inputSchema: { monthlySpend: "number", slmRoutingRatio: "number" },
                    execute: async (args) => {
                        const savings = (args.monthlySpend || 0) * (args.slmRoutingRatio || 0.8) * 0.85;
                        return { projectedAnnualSavingsUsd: savings * 12 };
                    },
                },
            ],
        });

        expect(agentPluginBridge.listPlugins().length).toBe(1);

        const execution = await agentPluginBridge.invokeTool("plugin_fin_calc", "calculate_projected_savings", {
            monthlySpend: 10000,
            slmRoutingRatio: 0.8,
        });

        expect(execution.status).toBe("success");
        expect(execution.result.projectedAnnualSavingsUsd).toBe(81600); // 10000 * 0.8 * 0.85 * 12
    });
});
