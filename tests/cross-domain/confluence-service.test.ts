/**
 * Confluence Service tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfluenceClient } from '../../server/domain/integrations/confluence-service.js';

const mockGetSpaces = vi.fn();
const mockGetPagesInSpace = vi.fn();
const mockGetPage = vi.fn();
const mockGetSpaceIdByKey = vi.fn();
const mockSearchPagesV2 = vi.fn();
const mockGetPageV2 = vi.fn();
const mockConvertToMarkdown = vi.fn();

vi.mock('../../server/integrations/confluence-gateway.js', () => ({
    ConfluenceGateway: class MockConfluenceGateway {
        getBaseUrl = () => 'https://test.atlassian.net/wiki';
        getSpaces = (...args: unknown[]) => mockGetSpaces(...args);
        getPagesInSpace = (...args: unknown[]) => mockGetPagesInSpace(...args);
        getPage = (...args: unknown[]) => mockGetPage(...args);
        getSpaceIdByKey = (...args: unknown[]) => mockGetSpaceIdByKey(...args);
        searchPagesV2 = (...args: unknown[]) => mockSearchPagesV2(...args);
        getPageV2 = (...args: unknown[]) => mockGetPageV2(...args);
        convertToMarkdown = (...args: unknown[]) => mockConvertToMarkdown(...args);
    },
}));

describe('ConfluenceClient', () => {
    let client: ConfluenceClient;

    beforeEach(() => {
        vi.clearAllMocks();
        client = new ConfluenceClient('https://test.atlassian.net/wiki', 'user', 'token');
    });

    describe('getBaseUrl', () => {
        it('returns base URL', () => {
            expect(client.getBaseUrl()).toBe('https://test.atlassian.net/wiki');
        });
    });

    describe('getSpaces', () => {
        it('returns spaces from gateway', async () => {
            const spaces = [{ id: 1, key: 'DEV', name: 'Development', type: 'global', _links: { webui: '' } }];
            mockGetSpaces.mockResolvedValue(spaces);

            const result = await client.getSpaces(10, 0);
            expect(result).toEqual(spaces);
            expect(mockGetSpaces).toHaveBeenCalledWith(10, 0);
        });
    });

    describe('getPagesInSpace', () => {
        it('returns pages from gateway', async () => {
            const pages = [{ id: '1', title: 'Page 1', body: { storage: { value: '<p>Hi</p>' } }, version: { number: 1 }, space: { key: 'DEV', name: 'Dev' }, _links: { webui: '', tinyui: '' } }];
            mockGetPagesInSpace.mockResolvedValue(pages);

            const result = await client.getPagesInSpace('DEV');
            expect(result).toEqual(pages);
            expect(mockGetPagesInSpace).toHaveBeenCalledWith('DEV', 25, 0);
        });
    });

    describe('getPage', () => {
        it('returns page by id', async () => {
            const page = { id: '123', title: 'Test', body: { storage: { value: '<p>Content</p>' } }, version: { number: 1 }, space: { key: 'DEV', name: 'Dev' }, _links: { webui: '', tinyui: '' } };
            mockGetPage.mockResolvedValue(page);

            const result = await client.getPage('123');
            expect(result).toEqual(page);
        });
    });

    describe('convertToMarkdown', () => {
        it('delegates to gateway', () => {
            mockConvertToMarkdown.mockReturnValue('# Title');
            const result = client.convertToMarkdown('<h1>Title</h1>');
            expect(result).toBe('# Title');
            expect(mockConvertToMarkdown).toHaveBeenCalledWith('<h1>Title</h1>');
        });
    });
});
