/**
 * AiAgentExecutor tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiAgentExecutor } from "@domain/jobs/core/executors/ai-agent-executor.js";
import { CredentialNotFoundError, ConfigurationError } from '../../../server/utils/errors.js';

const mockGetById = vi.fn();
const mockGetClient = vi.fn();
const mockRunAgentLoop = vi.fn();
const mockOrgResolve = vi.fn(async () => null as any);

vi.mock("@domain/ai/core/org-model.service.js", () => ({
    orgModelService: { resolve: (...args: any[]) => mockOrgResolve(...args) },
}));

vi.mock("@server/domain/auth/core/credentials-service.js", () => ({
    credentialsService: {
        getById: (...args: unknown[]) => mockGetById(...args),
    },
}));

vi.mock("@domain/knowledge/core/storage.service.js", () => ({
    storage: {
        getCredential: (...args: unknown[]) => mockGetById(...args),
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
        each: vi.fn(),
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: vi.fn(() => Promise.resolve([])),
                })),
            })),
        })),
    },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));


vi.mock("@server/domain/agents/agent-persona.service.js", () => ({
    AgentPersonaService: {
        augmentSystemPrompt: vi.fn((_persona: string, prompt: string) => prompt),
    },
}));

vi.mock("@server/domain/jobs/core/executors/executor-utils.js", () => ({
    saveJobOutput: vi.fn(),
}));

vi.mock("@server/domain/mission/core/mission.service.js", () => ({
    missionService: {
        recordAgentStep: vi.fn(),
        getMissionForEntity: vi.fn().mockResolvedValue(null),
    },
}));

vi.mock("@server/domain/agents/agent-runner.js", () => ({
    runAgentLoop: (...args: unknown[]) => mockRunAgentLoop(...args),
}));

vi.mock("@domain/audit/core/transaction-log.js", () => ({
    transactionLogService: {
        startTransaction: vi.fn(() => ({
            transactionId: 'tx-1',
            commit: vi.fn(),
            rollback: vi.fn(),
        })),
    },
}));

vi.mock("@server/domain/ai/core/system-ai.service.js", () => ({
    systemAiService: {
        getAiConfig: vi.fn().mockResolvedValue({ apiKey: "test-key", provider: "google" })
    }
}));

describe('AiAgentExecutor', () => {
    const executor = new AiAgentExecutor();

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetClient.mockReturnValue({});
        mockRunAgentLoop.mockResolvedValue({ output: 'Agent response', usage: {} });
    });

    describe('canExecute', () => {
        it('returns true for the job types it claims', () => {
            expect(executor.canExecute('ai_agent')).toBe(true);
            expect(executor.canExecute('data_processing')).toBe(true);
            expect(executor.canExecute('analyst')).toBe(true);
        });

        // NOTE: "agent_ai" is a valid job type in the schema (shared/schema/jobs/types.ts
        // and the config union in table.ts) but NO executor in jobs/core/executors claims
        // it, so such a job finds no executor at dispatch. Asserted here as current
        // behaviour, not as desired behaviour — see the open question in the summary.
        it('does not currently claim the schema-valid agent_ai type', () => {
            expect(executor.canExecute('agent_ai')).toBe(false);
        });

        it('returns false for other job types', () => {
            expect(executor.canExecute('shell')).toBe(false);
            expect(executor.canExecute('curl')).toBe(false);
            expect(executor.canExecute('sql_query')).toBe(false);
        });
    });

    describe('execute', () => {
        const baseJob = { id: 1, organizationId: 1, type: 'ai_agent' } as any;
        const baseConfig = { credentialId: 1, goal: 'Test', allowedTools: [] };
        const basePipeline = {} as any;
        const baseContext = { named: {}, positional: {} };

        it("uses the org's own Gemini key without reading the pinned credential", async () => {
            mockOrgResolve.mockResolvedValueOnce({ provider: "google", model: "gemini-2.5-flash", apiKey: "org-key", credentialId: 0 });
            const result = await executor.execute(baseJob, baseConfig, basePipeline, baseContext);
            expect(result.success).toBe(true);
            expect(mockGetById).not.toHaveBeenCalled();
        });

        it("looks a pinned credential up within the job's org, never across tenants", async () => {
            process.env.TEST_AI_KEY = 'sk-test-key';
            mockGetById.mockResolvedValue({ id: 1, envVarName: 'TEST_AI_KEY', metadata: { provider: 'openai' } });
            await executor.execute(baseJob, baseConfig, basePipeline, baseContext);
            expect(mockGetById).toHaveBeenCalledWith(1, 1, false);
            expect(mockGetById.mock.calls.every((c: any[]) => c[2] !== true)).toBe(true);
        });

        it('falls back to the system AI config when the pinned credential has no key', async () => {
            // A pinned credential whose env var is unset no longer kills the run:
            // the executor degrades to the system AI provider instead.
            mockGetById.mockResolvedValue({
                id: 1,
                envVarName: 'MISSING_API_KEY',
                metadata: { provider: 'openai' },
            });

            const result = await executor.execute(baseJob, baseConfig, basePipeline, baseContext);

            expect(result.success).toBe(true);
            expect(mockRunAgentLoop).toHaveBeenCalled();
        });

        it('throws ConfigurationError when neither the credential nor the system config has a key', async () => {
            mockGetById.mockResolvedValue({
                id: 1,
                envVarName: 'MISSING_API_KEY',
                metadata: { provider: 'openai' },
            });
            const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
            vi.mocked(systemAiService.getAiConfig).mockResolvedValueOnce(null as any);

            await expect(
                executor.execute(baseJob, baseConfig, basePipeline, baseContext)
            ).rejects.toThrow(ConfigurationError);
        });

        it('returns output when credential and API key present', async () => {
            process.env.TEST_AI_KEY = 'sk-test-key';
            mockGetById.mockResolvedValue({
                id: 1,
                envVarName: 'TEST_AI_KEY',
                metadata: { provider: 'openai' },
            });

            const result = await executor.execute(
                baseJob,
                baseConfig,
                basePipeline,
                baseContext
            );

            expect(result).toBeDefined();
            expect(result.output).toBe('Agent response');
            expect(result.success).toBe(true);
            expect(mockGetClient).toHaveBeenCalled();
            expect(mockRunAgentLoop).toHaveBeenCalled();
            delete process.env.TEST_AI_KEY;
        });
    });
});
