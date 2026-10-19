/**
 * SYSTEM_TOOLS tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SYSTEM_TOOLS } from '../../../server/domain/tools/v1/capabilities/system.js';

const mockHandleDeleteJob = vi.fn();

vi.mock('../../../server/mcp/handlers.js', () => ({
    handleDeleteJob: (...args: unknown[]) => mockHandleDeleteJob(...args),
}));

describe('SYSTEM_TOOLS', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockHandleDeleteJob.mockResolvedValue({ content: [{ type: 'text', text: 'Job deleted' }] });
    });

    describe('delete_job', () => {
        it('returns confirmation required when userConfirmed is false', async () => {
            const result = await SYSTEM_TOOLS.delete_job.execute!(
                { jobId: 1, userConfirmed: false },
                { isAdmin: true }
            );
            expect(result).toContain('CONFIRMATION REQUIRED');
            expect(mockHandleDeleteJob).not.toHaveBeenCalled();
        });

        it('returns error when context has no admin flags', async () => {
            const result = await SYSTEM_TOOLS.delete_job.execute!(
                { jobId: 1, userConfirmed: true },
                {}
            );
            expect(result).toBe('Error: Admin permissions required to delete jobs.');
            expect(mockHandleDeleteJob).not.toHaveBeenCalled();
        });

        it('calls handler when userConfirmed and isAdmin', async () => {
            const result = await SYSTEM_TOOLS.delete_job.execute!(
                { jobId: 1, userConfirmed: true },
                { isAdmin: true }
            );
            expect(result).toBe('Job deleted');
            expect(mockHandleDeleteJob).toHaveBeenCalledWith({ jobId: 1, userConfirmed: true }, { isAdmin: true });
        });
    });
});
