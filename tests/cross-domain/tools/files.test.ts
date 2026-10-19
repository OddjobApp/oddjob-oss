/**
 * FILE_TOOLS tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListFiles = vi.fn();
const mockSaveFile = vi.fn();
const mockUnsafeReadAbsolute = vi.fn();
const mockUnsafeListAbsolute = vi.fn();

vi.mock('@domain/knowledge/core/file-storage.js', () => ({
    fileStorageSuccess: {
        listFiles: (...args: unknown[]) => mockListFiles(...args),
        saveFile: (...args: unknown[]) => mockSaveFile(...args),
        unsafeReadAbsolute: (...args: unknown[]) => mockUnsafeReadAbsolute(...args),
        unsafeListAbsolute: (...args: unknown[]) => mockUnsafeListAbsolute(...args),
    },
}));

vi.mock('@domain/core/infrastructure/file-parser.service.js', () => ({
    FileParser: {
        parse: vi.fn().mockResolvedValue({ type: 'text', content: 'parsed content', summary: 'summary' }),
    },
}));

import { FILE_TOOLS } from '../../../server/domain/tools/v1/capabilities/files.js';

describe('FILE_TOOLS', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('file_list', () => {
        it('returns "No files found." when list is empty', async () => {
            mockListFiles.mockResolvedValue([]);
            const result = await FILE_TOOLS.file_list.execute!(
                { path: 'reports' },
                { organizationId: 1 }
            );
            expect(result).toBe('No files found.');
        });

        it('returns formatted file list when files exist', async () => {
            mockListFiles.mockResolvedValue([
                { path: 'reports/a.txt', size: 100, isDirectory: false },
                { path: 'reports/sub', size: 0, isDirectory: true },
            ]);
            const result = await FILE_TOOLS.file_list.execute!(
                { path: 'reports', recursive: true },
                { organizationId: 1 }
            );
            expect(result).toContain('reports/a.txt (100 bytes)');
            expect(result).toContain('[DIR] reports/sub');
        });

        it('returns error message on exception', async () => {
            mockListFiles.mockRejectedValue(new Error('Storage error'));
            const result = await FILE_TOOLS.file_list.execute!(
                { path: 'bad' },
                {}
            );
            expect(result).toContain('Error listing files');
        });
    });

    describe('file_write', () => {
        it('saves file and returns success message', async () => {
            mockSaveFile.mockResolvedValue(undefined);
            const result = await FILE_TOOLS.file_write.execute!(
                { path: 'out.txt', content: 'hello' },
                { organizationId: 1 }
            );
            expect(result).toBe('Successfully wrote to out.txt');
            expect(mockSaveFile).toHaveBeenCalledWith(1, 'out.txt', 'hello');
        });

        it('returns error message on exception', async () => {
            mockSaveFile.mockRejectedValue(new Error('Write failed'));
            const result = await FILE_TOOLS.file_write.execute!(
                { path: 'out.txt', content: 'x' },
                {}
            );
            expect(result).toContain('Error writing file');
        });
    });

    describe('read_system_file', () => {
        it('returns error when context has no admin flags', async () => {
            const result = await FILE_TOOLS.read_system_file.execute!(
                { path: '/etc/hosts' },
                {}
            );
            expect(result).toBe('Error: Admin permissions required to read system files.');
            expect(mockUnsafeReadAbsolute).not.toHaveBeenCalled();
        });

        it('calls unsafeReadAbsolute when isAdmin is true', async () => {
            mockUnsafeReadAbsolute.mockResolvedValue('file content');
            const result = await FILE_TOOLS.read_system_file.execute!(
                { path: '/etc/hosts' },
                { isAdmin: true }
            );
            expect(result).toBe('file content');
            expect(mockUnsafeReadAbsolute).toHaveBeenCalledWith('/etc/hosts');
        });
    });

    describe('list_system_files', () => {
        it('returns error when context has no admin flags', async () => {
            const result = await FILE_TOOLS.list_system_files.execute!(
                { path: '/tmp' },
                {}
            );
            expect(result).toBe('Error: Admin permissions required to list system files.');
            expect(mockUnsafeListAbsolute).not.toHaveBeenCalled();
        });

        it('calls unsafeListAbsolute and joins result when isAdmin is true', async () => {
            mockUnsafeListAbsolute.mockResolvedValue(['/tmp/a', '/tmp/b']);
            const result = await FILE_TOOLS.list_system_files.execute!(
                { path: '/tmp' },
                { isAdmin: true }
            );
            expect(result).toBe('/tmp/a\n/tmp/b');
        });
    });
});
