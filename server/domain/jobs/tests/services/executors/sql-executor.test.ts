/**
 * SQL Executor tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SqlExecutor } from "@domain/jobs/core/executors/sql-executor.js";
import { CredentialNotFoundError, NotFoundError } from '@server/utils/errors.js';

const mockGetCredential = vi.fn();

vi.mock("@domain/auth/core/credentials-service.js", () => ({
    credentialsService: {
        getForExecution: (...args: unknown[]) => mockGetCredential(...args),
    },
}));

describe('SqlExecutor', () => {
    const executor = new SqlExecutor();

    beforeEach(() => {
        vi.clearAllMocks();
        process.env.TEST_DB_PASSWORD = 'secret';
    });

    describe('canExecute', () => {
        it('returns true for sql_query job type', () => {
            expect(executor.canExecute('sql_query')).toBe(true);
        });

        it('returns false for other job types', () => {
            expect(executor.canExecute('curl')).toBe(false);
            expect(executor.canExecute('transformer')).toBe(false);
            expect(executor.canExecute('api')).toBe(false);
        });
    });

    describe('execute', () => {
        it('throws CredentialNotFoundError when credential not found', async () => {
            // credentialsService.getForExecution throws on a miss (it never resolves
            // undefined), so mirror that contract here.
            mockGetCredential.mockRejectedValue(new CredentialNotFoundError(99));
            const job = {} as any;
            const config = { credentialId: 99, query: 'SELECT 1' };
            const pipeline = {} as any;
            const context = {} as any;

            await expect(executor.execute(job, config, pipeline, context)).rejects.toThrow(
                CredentialNotFoundError
            );
            // Scoped to the pipeline's org: never getById(id, null, true), which
            // dropped the org filter and could load another tenant's credential.
            expect(mockGetCredential).toHaveBeenCalledWith(99, undefined);
        });

        it('throws AppError for unsupported database engine', async () => {
            mockGetCredential.mockResolvedValue({
                id: 1,
                envVarName: 'TEST_DB_PASSWORD',
                metadata: { engine: 'oracle', host: 'localhost', database: 'db', user: 'u' },
            });
            const job = {} as any;
            const config = { credentialId: 1, query: 'SELECT 1' };
            const pipeline = {} as any;
            const context = {} as any;

            await expect(executor.execute(job, config, pipeline, context)).rejects.toThrow(
                'Unsupported database engine: oracle'
            );
        });

        it('throws when password env var is missing', async () => {
            mockGetCredential.mockResolvedValue({
                id: 1,
                envVarName: 'MISSING_ENV_VAR',
                metadata: { engine: 'postgres', host: 'localhost', database: 'db', user: 'u' },
            });
            const job = {} as any;
            const config = { credentialId: 1, query: 'SELECT 1' };
            const pipeline = {} as any;
            const context = {} as any;

            await expect(executor.execute(job, config, pipeline, context)).rejects.toThrow(
                'Database password not found in environment'
            );
        });
    });
});
