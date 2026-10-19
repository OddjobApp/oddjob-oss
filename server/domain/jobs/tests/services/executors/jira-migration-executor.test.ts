
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { JiraMigrationExecutor } from '@domain/jobs/core/executors/jira-migration-executor.js';
import { db } from "@server/database_service.js";
import { getJiraClient } from '@domain/integrations/jira-service.js';

// Mock DB
const createMockQuery = (result: any = []) => ({
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(result),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    then: vi.fn(onFulfilled => Promise.resolve(result).then(onFulfilled))
});

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn(() => createMockQuery([])),
        insert: vi.fn(() => createMockQuery([])),
    },
}));

// Mock Jira Service
vi.mock('@domain/integrations/jira-service.js', () => ({
    getJiraClient: vi.fn(),
}));

describe('JiraMigrationExecutor', () => {
    let executor: JiraMigrationExecutor;
    let mockSourceClient: any;
    let mockTargetClient: any;

    beforeEach(() => {
        vi.clearAllMocks();
        executor = new JiraMigrationExecutor();

        mockSourceClient = {
            getIssuesInProject: vi.fn(),
            getFields: vi.fn(),
            searchIssues: vi.fn(),
        };

        mockTargetClient = {
            getIssuesInProject: vi.fn(),
            getFields: vi.fn(),
            createIssue: vi.fn(),
        };

        (getJiraClient as Mock).mockImplementation((id: number) => {
            if (id === 1) return Promise.resolve(mockSourceClient);
            if (id === 2) return Promise.resolve(mockTargetClient);
            return Promise.resolve(null);
        });
    });

    it('should identify as jira_migration executor', () => {
        expect(executor.canExecute('jira_migration')).toBe(true);
        expect(executor.canExecute('other')).toBe(false);
    });

    describe('Sampling Mode', () => {
        it('should return samples for source and target', async () => {
            const sourceIssues = { issues: [{ key: 'SRC-1' }, { key: 'SRC-2' }] };
            const targetIssues = { issues: [{ key: 'TGT-1' }] };
            const fields = [{ id: 'f1', custom: false }, { id: 'f2', custom: true }];

            mockSourceClient.getIssuesInProject.mockResolvedValue(sourceIssues);
            mockTargetClient.getIssuesInProject.mockResolvedValue(targetIssues);
            mockSourceClient.getFields.mockResolvedValue(fields);
            mockTargetClient.getFields.mockResolvedValue(fields);

            const result = await executor.execute(
                { id: 1, organizationId: 10 } as any,
                {
                    sourceCredentialId: 1,
                    targetCredentialId: 2,
                    sourceProjectKey: 'SRC',
                    targetProjectKey: 'TGT',
                    samplingMode: true
                },
                {} as any,
                { data: {}, organizationId: 10 } as any
            );

            expect(result.success).toBe(true);
            const output = JSON.parse(result.output);
            expect(output.sourceSample).toHaveLength(2);
            expect(output.targetSample).toHaveLength(1);
            expect(output.sourceFields).toHaveLength(1); // Non-custom only
            expect(mockSourceClient.getIssuesInProject).toHaveBeenCalledWith('SRC', 5);
        });
    });

    describe('Migration Mode', () => {
        it('should migrate new issues and record to blackboard', async () => {
            const issue = {
                key: 'SRC-1',
                fields: {
                    summary: 'Test Issue',
                    description: 'Description',
                    issuetype: { name: 'Task' }
                }
            };
            mockSourceClient.searchIssues.mockResolvedValue({ issues: [issue] });
            mockTargetClient.createIssue.mockResolvedValue({ key: 'TGT-100' });

            // Dedupe check - return empty (not migrated)
            (db.select as Mock).mockReturnValue(createMockQuery([]));

            const result = await executor.execute(
                { id: 1, organizationId: 10 } as any,
                {
                    sourceCredentialId: 1,
                    targetCredentialId: 2,
                    sourceProjectKey: 'SRC',
                    targetProjectKey: 'TGT'
                },
                {} as any,
                { data: {}, organizationId: 10, missionId: 105 } as any
            );

            expect(result.success).toBe(true);
            expect(mockTargetClient.createIssue).toHaveBeenCalledWith(expect.objectContaining({
                summary: 'Test Issue',
                project: { key: 'TGT' }
            }));
            expect(db.insert).toHaveBeenCalled(); // Should record to blackboard
        });

        it('should skip already migrated issues', async () => {
            const issue = { key: 'SRC-1', fields: { summary: 'Test' } };
            mockSourceClient.searchIssues.mockResolvedValue({ issues: [issue] });

            // Dedupe check - return existing link
            (db.select as Mock).mockReturnValue(createMockQuery([{ id: 1 }]));

            const result = await executor.execute(
                { id: 1, organizationId: 10 } as any,
                {
                    sourceCredentialId: 1,
                    targetCredentialId: 2,
                    sourceProjectKey: 'SRC',
                    targetProjectKey: 'TGT'
                },
                {} as any,
                { data: {}, organizationId: 10, missionId: 105 } as any
            );

            expect(result.success).toBe(true);
            const output = JSON.parse(result.output);
            expect(output.skippedCount).toBe(1);
            expect(mockTargetClient.createIssue).not.toHaveBeenCalled();
        });
    });
});
