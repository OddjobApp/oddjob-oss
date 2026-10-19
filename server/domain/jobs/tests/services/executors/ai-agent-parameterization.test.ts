/**
 * AiAgentExecutor Parameterization tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiAgentExecutor } from "@domain/jobs/core/executors/ai-agent-executor.js";

const mockGetById = vi.fn();
const mockGetClient = vi.fn();
const mockRunAgentLoop = vi.fn();

// Mock the core dependencies that AiAgentExecutor uses
vi.mock("@domain/knowledge/core/storage.service.js", () => ({
    storage: {
        getCredential: vi.fn().mockImplementation(async (id) => {
            if (id === 1) return { id: 1, envVarName: 'GEMINI_API_KEY', metadata: { provider: 'google' } };
            return null;
        }),
    },
}));

vi.mock("@domain/ai/core/ai-client.service.js", () => ({
    AIClientFactory: {
        getClient: (...args: unknown[]) => mockGetClient(...args),
    },
    normalizeGeminiModel: (m: string) => m,
}));

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                innerJoin: vi.fn(() => ({
                    where: vi.fn(() => ({
                        limit: vi.fn(() => Promise.resolve([])),
                    })),
                })),
                where: vi.fn(() => ({
                    limit: vi.fn(() => Promise.resolve([])),
                })),
            })),
        })),
        insert: vi.fn(() => ({
            values: vi.fn(() => ({
                returning: vi.fn(() => Promise.resolve([{ id: 1 }])),
            })),
        })),
        // The executor wraps its run in an audit TransactionLog, which
        // commits/rolls back via db.update(...).set(...).where(...).
        update: vi.fn(() => ({
            set: vi.fn(() => ({
                where: vi.fn(() => Promise.resolve()),
            })),
        })),
    },
}));

vi.mock("@domain/agents/agent-persona.service.js", () => ({
    AgentPersonaService: {
        augmentSystemPrompt: vi.fn((_persona: string, prompt: string) => prompt),
    },
}));

vi.mock("@domain/mission/core/mission.service.js", () => ({
    missionService: {
        getMissionForEntity: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock("@domain/agents/agent-runner.js", () => ({
    runAgentLoop: (...args: unknown[]) => mockRunAgentLoop(...args),
}));

vi.mock("@domain/audit/transaction-log.js", () => ({
    transactionLogService: {
        startTransaction: vi.fn(() => ({
            transactionId: 'tx-1',
            commit: vi.fn().mockResolvedValue(undefined),
            rollback: vi.fn().mockResolvedValue(undefined),
        })),
    },
}));

vi.mock("@domain/ai/core/system-ai.service.js", () => ({
    systemAiService: {
        getAiConfig: vi.fn().mockResolvedValue({ apiKey: "test-key", provider: "google" })
    }
}));

vi.mock("@server/core/variable-resolver.js", () => ({
    resolveVariables: vi.fn((str: string, _context: any) => {
        // Simple mock implementation: replace {{key}} with context.data[key]
        let result = str || "";
        const matches = result.match(/\{\{([^}]+)\}\}/g);
        if (matches && _context?.data) {
            for (const match of matches) {
                const key = match.replace(/\{\{|\}\}/g, "");
                if (_context.data[key] !== undefined) {
                    result = result.replace(match, _context.data[key]);
                }
            }
        }
        return result;
    }),
}));

vi.mock("@domain/tools/v1/tool-registry.service.js", () => ({
    normalizeToolName: vi.fn((t: string) => t),
    // The executor enforces a baseline tool set via a dynamic import; returning
    // false leaves finalAllowedTools exactly as the test configured it.
    isToolAvailable: vi.fn(async () => false),
}));

describe('AiAgentExecutor Parameterization', () => {
    const executor = new AiAgentExecutor();

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetClient.mockReturnValue({
            execute: vi.fn().mockResolvedValue({ success: true, output: 'Response' })
        });
        mockRunAgentLoop.mockResolvedValue({ output: 'Agent response', usage: {}, history: [] });
    });

    it('resolves variables in systemPrompt and goal', async () => {
        const job = { id: 1, organizationId: 1, type: 'ai_agent' } as any;
        const config = { 
            goal: 'Analyze {{website}}', 
            systemPrompt: 'You are an SEO expert for {{website}}',
            website: 'example.com',
            credentialId: 1
        };
        process.env.GEMINI_API_KEY = 'test-key';
        const context = { named: {}, positional: {}, data: { userId: '1' } };

        await executor.execute(job, config, {} as any, context as any);

        expect(mockRunAgentLoop).toHaveBeenCalled();
        const callArgs = mockRunAgentLoop.mock.calls[0];
        expect(callArgs[2]).toBe('Analyze example.com');
        expect(callArgs[1].systemPrompt).toBe('You are an SEO expert for example.com');
    });

    it('triggers HIL when required parameter is missing', async () => {
        const job = { 
            id: 1, 
            organizationId: 1, 
            type: 'ai_agent',
            parameterSchema: {
                required: ['website'],
                properties: {
                    website: { type: 'string', description: 'The website to analyze' }
                }
            }
        } as any;
        const config = { 
            goal: 'Analyze {{website}}', 
            systemPrompt: 'Analyze {{website}}',
            credentialId: 1
        };
        const context = { named: {}, positional: {}, data: {} };

        const result = await executor.execute(job, config, {} as any, context as any) as any;

        expect(result.status).toBe('waiting_external_input');
        expect(result.suspensionMetadata.type).toBe('input_request');
        expect(result.suspensionMetadata.fields[0].name).toBe('website');
        expect(mockRunAgentLoop).not.toHaveBeenCalled();
    });
});
