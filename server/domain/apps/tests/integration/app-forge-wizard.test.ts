
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appForgeService } from '../../app-forge.service.js';

// Mock the AI Client to avoid making real LLM calls
const mockAIClient = {
    execute: vi.fn(),
};

vi.mock('@domain/ai/core/ai-client.service.js', () => ({
    AIClientFactory: {
        getClient: () => mockAIClient,
    },
}));

// Mock dependent services
vi.mock('@domain/ai/core/system-ai.service.js', () => ({
    systemAiService: {
        getAiConfig: () => Promise.resolve({ model: 'mock-model' }),
    },
}));

vi.mock('@domain/agents/core/agent-persona.service.js', () => ({
    AgentPersonaService: {
        augmentSystemPrompt: (prompt: string) => `Augmented: ${prompt}`,
    },
}));

vi.mock('@domain/agents/core/capability-discovery.service.js', () => ({
    capabilityDiscoveryService: {
        discoverCapabilities: () => Promise.resolve([
            { name: 'Existing Mission', type: 'Mission', score: 92, explanation: 'This mission already performs a similar function.' }
        ]),
    }
}));

describe("App Forge Co-Pilot Wizard", () => {

    beforeEach(() => {
        mockAIClient.execute.mockClear();
    });

    it("should analyze an idea and return a structured business case", async () => {
        const mockBusinessCase = {
            problemStatement: "Test problem",
            proposedSolution: "Test solution",
            keyFeatures: [],
            successMetrics: [],
        };
        mockAIClient.execute.mockResolvedValue({ success: true, output: JSON.stringify(mockBusinessCase) });

        const result = await appForgeService.analyzeIdea("A test idea");

        expect(mockAIClient.execute).toHaveBeenCalledOnce();
        expect(result).toEqual(mockBusinessCase);
    });

    it("should discover relevant assets based on a business case", async () => {
        const mockBusinessCase = { problemStatement: 'Test', proposedSolution: 'Test', keyFeatures: [{ feature: 'Test' }] } as any;
        const result = await appForgeService.discoverAssets(mockBusinessCase);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Existing Mission');
    });

    it("should generate a system architecture diagram", async () => {
        const mockBlueprint = { proposedSolution: 'Test App', keyFeatures: [{ feature: 'Feature 1' }] } as any;
        const result = await appForgeService.generateDiagram(mockBlueprint, []);

        expect(result.nodes).toHaveLength(2);
        expect(result.edges).toHaveLength(1);
        expect(result.nodes[0].id).toBe('app');
        expect(result.nodes[1].id).toBe('feature-0');
    });

    it("should run a pre-flight check and return forecast and compliance reports", async () => {
        const mockBlueprint = { components: [] } as any;
        const mockForecast = { estimates: [] };
        const mockCompliance = { score: 100, flags: [] };
        
        mockAIClient.execute
            .mockResolvedValueOnce({ success: true, output: JSON.stringify(mockForecast) })
            .mockResolvedValueOnce({ success: true, output: JSON.stringify(mockCompliance) });

        const result = await appForgeService.runPreFlightCheck(mockBlueprint, {});

        expect(mockAIClient.execute).toHaveBeenCalledTimes(2);
        expect(result.forecast).toEqual(mockForecast);
        expect(result.compliance).toEqual(mockCompliance);
    });
});
