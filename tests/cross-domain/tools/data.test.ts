/**
 * DATA_TOOLS tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DATA_TOOLS } from '../../../server/domain/tools/v1/capabilities/data.js';

const mockHandleListDatasets = vi.fn();
const mockHandleGetDatasetDetails = vi.fn();
const mockHandleCreateDataset = vi.fn();
const mockHandleQueryDataset = vi.fn();
const mockHandleAddDatasetItems = vi.fn();

vi.mock('../../../server/mcp/handlers.js', () => ({
    handleListDatasets: (...args: unknown[]) => mockHandleListDatasets(...args),
    handleGetDatasetDetails: (...args: unknown[]) => mockHandleGetDatasetDetails(...args),
    handleCreateDataset: (...args: unknown[]) => mockHandleCreateDataset(...args),
    handleQueryDataset: (...args: unknown[]) => mockHandleQueryDataset(...args),
    handleAddDatasetItems: (...args: unknown[]) => mockHandleAddDatasetItems(...args),
}));

describe('DATA_TOOLS', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockHandleListDatasets.mockResolvedValue({ content: [{ type: 'text', text: 'Datasets list' }] });
        mockHandleGetDatasetDetails.mockResolvedValue({ content: [{ type: 'text', text: 'Dataset details' }] });
        mockHandleCreateDataset.mockResolvedValue({ content: [{ type: 'text', text: 'Dataset created' }] });
        mockHandleQueryDataset.mockResolvedValue({ content: [{ type: 'text', text: 'Query results' }] });
        mockHandleAddDatasetItems.mockResolvedValue({ content: [{ type: 'text', text: 'Items added' }] });
    });

    describe('list_datasets', () => {
        it('calls handler and returns extracted text', async () => {
            const result = await DATA_TOOLS.list_datasets.execute!(
                { limit: 10 },
                { organizationId: 1 }
            );
            expect(result).toBe('Datasets list');
            expect(mockHandleListDatasets).toHaveBeenCalledWith({ limit: 10 }, { organizationId: 1 });
        });
    });

    describe('get_dataset_details', () => {
        it('calls handler and returns extracted text', async () => {
            const result = await DATA_TOOLS.get_dataset_details.execute!(
                { datasetId: 1 },
                {}
            );
            expect(result).toBe('Dataset details');
            expect(mockHandleGetDatasetDetails).toHaveBeenCalledWith({ datasetId: 1 }, {});
        });
    });

    describe('create_dataset', () => {
        it('rejects an admin call without organization context', async () => {
            await expect(DATA_TOOLS.create_dataset.execute!({ name: 'Unscoped' }, { isAdmin: true })).rejects.toThrow('Organization context required');
            expect(mockHandleCreateDataset).not.toHaveBeenCalled();
        });
        it('returns error when context has no admin flags', async () => {
            const result = await DATA_TOOLS.create_dataset.execute!(
                { name: 'TestDataset' },
                {}
            );
            expect(result).toBe('Error: Admin permissions required to create datasets.');
            expect(mockHandleCreateDataset).not.toHaveBeenCalled();
        });

        it('calls handler when isAdmin is true', async () => {
            const result = await DATA_TOOLS.create_dataset.execute!(
                { name: 'MyDataset', description: 'Desc', tags: ['a'] },
                { isAdmin: true, organizationId: 42 }
            );
            expect(result).toBe('Dataset created');
            expect(mockHandleCreateDataset).toHaveBeenCalledWith({ name: 'MyDataset', description: 'Desc', tags: ['a'] }, { isAdmin: true, organizationId: 42 });
        });

        it('calls handler when isOrgAdmin is true', async () => {
            const result = await DATA_TOOLS.create_dataset.execute!(
                { name: 'MyDataset' },
                { isOrgAdmin: true, organizationId: 42 }
            );
            expect(result).toBe('Dataset created');
        });
    });

    describe('query_dataset', () => {
        it('calls handler and returns extracted text', async () => {
            const result = await DATA_TOOLS.query_dataset.execute!(
                { datasetId: 1, limit: 5 },
                {}
            );
            expect(result).toBe('Query results');
            expect(mockHandleQueryDataset).toHaveBeenCalledWith({ datasetId: 1, limit: 5 }, {});
        });
    });

    describe('add_dataset_items', () => {
        it('calls handler and returns extracted text', async () => {
            const items = [{ a: 1 }, { b: 2 }];
            const result = await DATA_TOOLS.add_dataset_items.execute!(
                { datasetId: 1, items },
                {}
            );
            expect(result).toBe('Items added');
            expect(mockHandleAddDatasetItems).toHaveBeenCalledWith({ datasetId: 1, items }, {});
        });
    });
});
