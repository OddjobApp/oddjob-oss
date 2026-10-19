/**
 * TryCua MCP Handler Tests
 *
 * Covers the six computer-use tool handlers:
 * - createTask, listTasks, getTaskDetails, confirmTask, cancelTask, runAutonomousLoop
 *
 * Verifies: correct org/user context resolution, Zod validation, success/error responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Infrastructure mocks ──────────────────────────────────────────────────────

const mockService = vi.hoisted(() => ({
    createTask: vi.fn(),
    listTasks: vi.fn(),
    getTaskWithSteps: vi.fn(),
    confirmTask: vi.fn(),
    cancelTask: vi.fn(),
    runAutonomousLoop: vi.fn(),
}));

vi.mock('../../server/domain/integrations/trycua/computer-use-task.service.js', () => ({
    trycuaComputerUseTaskService: mockService,
}));

vi.mock('../../server/utils/logger.js', () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    })),
}));

// Mock getOrgId() fallback used by getOrgContext when no context is provided
vi.mock('../../server/mcp/handlers/utils.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../server/mcp/handlers/utils.js')>();
    return {
        ...actual,
        // Override getOrgId to return a predictable value in tests
        getOrgContext: vi.fn((context?: any) => ({
            organizationId: context?.organizationId ?? 99,
            userId: context?.userId ?? 'mcp-server',
            isAdmin: false,
            isOrgAdmin: false,
            isSuperAdmin: false,
        })),
    };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContext(overrides: Record<string, unknown> = {}) {
    return {
        organizationId: 42,
        userId: 'user-123',
        named: {},
        positional: {},
        isAdmin: false,
        isOrgAdmin: false,
        isSuperAdmin: false,
        ...overrides,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TryCua MCP Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('handleCreateTrycuaTask', () => {
        it('calls createTask with correct org/user from context', async () => {
            mockService.createTask.mockResolvedValue({ id: 'task-1', status: 'pending' });
            const { handleCreateTrycuaTask } = await import('../../server/mcp/handlers/trycua.js');

            const ctx = makeContext();
            await handleCreateTrycuaTask({ sessionId: 'sess-1', task: 'Do something' }, ctx as any);

            expect(mockService.createTask).toHaveBeenCalledWith(
                expect.objectContaining({ organizationId: 42, userId: 'user-123' })
            );
        });

        it('passes optional fields through', async () => {
            mockService.createTask.mockResolvedValue({ id: 'task-2' });
            const { handleCreateTrycuaTask } = await import('../../server/mcp/handlers/trycua.js');

            await handleCreateTrycuaTask(
                { sessionId: 's', task: 't', requireConfirmation: true, allowSensitive: false, executeImmediately: true },
                makeContext() as any
            );

            expect(mockService.createTask).toHaveBeenCalledWith(
                expect.objectContaining({ requireConfirmation: true, allowSensitive: false, executeImmediately: true })
            );
        });

        it('returns error response on invalid args (missing required fields)', async () => {
            const { handleCreateTrycuaTask } = await import('../../server/mcp/handlers/trycua.js');
            const result = await handleCreateTrycuaTask({}, makeContext() as any) as any;
            // Zod parse failure should yield an error response, not a thrown exception
            expect(result?.content?.[0]?.text ?? result?.error).toBeTruthy();
        });

        it('returns error response when service throws', async () => {
            mockService.createTask.mockRejectedValue(new Error('Service unavailable'));
            const { handleCreateTrycuaTask } = await import('../../server/mcp/handlers/trycua.js');
            const result = await handleCreateTrycuaTask(
                { sessionId: 's', task: 't' }, makeContext() as any
            ) as any;
            expect(result?.content?.[0]?.text ?? result?.error).toMatch(/Service unavailable/);
        });
    });

    describe('handleListTrycuaTasks', () => {
        it('passes orgId and userId from context', async () => {
            mockService.listTasks.mockResolvedValue([]);
            const { handleListTrycuaTasks } = await import('../../server/mcp/handlers/trycua.js');

            await handleListTrycuaTasks({}, makeContext() as any);

            expect(mockService.listTasks).toHaveBeenCalledWith(
                expect.objectContaining({ organizationId: 42, userId: 'user-123' })
            );
        });

        it('forwards optional limit', async () => {
            mockService.listTasks.mockResolvedValue([]);
            const { handleListTrycuaTasks } = await import('../../server/mcp/handlers/trycua.js');

            await handleListTrycuaTasks({ limit: 5 }, makeContext() as any);

            expect(mockService.listTasks).toHaveBeenCalledWith(
                expect.objectContaining({ limit: 5 })
            );
        });
    });

    describe('handleGetTrycuaTaskDetails', () => {
        it('passes taskId, orgId, userId', async () => {
            mockService.getTaskWithSteps.mockResolvedValue({ id: 'task-x', steps: [] });
            const { handleGetTrycuaTaskDetails } = await import('../../server/mcp/handlers/trycua.js');

            await handleGetTrycuaTaskDetails({ taskId: 'task-x' }, makeContext() as any);

            expect(mockService.getTaskWithSteps).toHaveBeenCalledWith('task-x', 42, 'user-123');
        });

        it('returns error when taskId is missing', async () => {
            const { handleGetTrycuaTaskDetails } = await import('../../server/mcp/handlers/trycua.js');
            const result = await handleGetTrycuaTaskDetails({}, makeContext() as any) as any;
            expect(result?.content?.[0]?.text ?? result?.error).toBeTruthy();
        });
    });

    describe('handleConfirmTrycuaTask', () => {
        it('passes all confirmation fields', async () => {
            mockService.confirmTask.mockResolvedValue({ status: 'confirmed' });
            const { handleConfirmTrycuaTask } = await import('../../server/mcp/handlers/trycua.js');

            await handleConfirmTrycuaTask(
                { taskId: 'task-y', allow: true, text: 'yes', clipboardText: 'copied' },
                makeContext() as any
            );

            expect(mockService.confirmTask).toHaveBeenCalledWith(
                expect.objectContaining({
                    taskId: 'task-y', allow: true, text: 'yes', clipboardText: 'copied',
                    organizationId: 42, userId: 'user-123',
                })
            );
        });

        it('returns error when allow is missing', async () => {
            const { handleConfirmTrycuaTask } = await import('../../server/mcp/handlers/trycua.js');
            const result = await handleConfirmTrycuaTask({ taskId: 'task-y' }, makeContext() as any) as any;
            expect(result?.content?.[0]?.text ?? result?.error).toBeTruthy();
        });
    });

    describe('handleCancelTrycuaTask', () => {
        it('calls cancelTask with correct args', async () => {
            mockService.cancelTask.mockResolvedValue({ status: 'cancelled' });
            const { handleCancelTrycuaTask } = await import('../../server/mcp/handlers/trycua.js');

            await handleCancelTrycuaTask({ taskId: 'task-z' }, makeContext() as any);

            expect(mockService.cancelTask).toHaveBeenCalledWith('task-z', 42, 'user-123');
        });
    });

    describe('handleRunTrycuaAutonomousLoop', () => {
        it('calls runAutonomousLoop with correct args', async () => {
            mockService.runAutonomousLoop.mockResolvedValue({ cycles: 3 });
            const { handleRunTrycuaAutonomousLoop } = await import('../../server/mcp/handlers/trycua.js');

            await handleRunTrycuaAutonomousLoop({ taskId: 'loop-1' }, makeContext() as any);

            expect(mockService.runAutonomousLoop).toHaveBeenCalledWith('loop-1', 42, 'user-123');
        });
    });

    describe('org context fallback', () => {
        it('uses getOrgContext fallback org when no context provided', async () => {
            mockService.listTasks.mockResolvedValue([]);
            const { handleListTrycuaTasks } = await import('../../server/mcp/handlers/trycua.js');

            // Pass undefined context — should fall back to getOrgContext's default (99 in our mock)
            await handleListTrycuaTasks({}, undefined as any);

            expect(mockService.listTasks).toHaveBeenCalledWith(
                expect.objectContaining({ organizationId: 99 })
            );
        });
    });
});
