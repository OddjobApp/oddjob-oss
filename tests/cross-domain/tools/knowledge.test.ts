/**
 * KNOWLEDGE_TOOLS tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KNOWLEDGE_TOOLS } from '../../../server/domain/tools/v1/capabilities/knowledge.js';

const mockHandleCreateEntity = vi.fn();
const mockHandleCreateRelationship = vi.fn();
const mockHandleSuggestSchema = vi.fn();

vi.mock('../../../server/mcp/handlers.js', () => ({
    handleCreateEntity: (...args: unknown[]) => mockHandleCreateEntity(...args),
    handleCreateRelationship: (...args: unknown[]) => mockHandleCreateRelationship(...args),
    handleSuggestSchema: (...args: unknown[]) => mockHandleSuggestSchema(...args),
}));

describe('KNOWLEDGE_TOOLS', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockHandleCreateEntity.mockResolvedValue({ content: [{ type: 'text', text: 'Entity created' }] });
        mockHandleCreateRelationship.mockResolvedValue({ content: [{ type: 'text', text: 'Relationship created' }] });
        mockHandleSuggestSchema.mockResolvedValue({ content: [{ type: 'text', text: 'Schema suggested' }] });
    });

    describe('create_entity', () => {
        it('rejects an admin call without organization context', async () => {
            await expect(KNOWLEDGE_TOOLS.create_entity.execute!({ name: 'Unscoped', entityType: 'Service' }, { isAdmin: true })).rejects.toThrow('Organization context required');
            expect(mockHandleCreateEntity).not.toHaveBeenCalled();
        });
        it('returns error when context has no admin flags', async () => {
            const result = await KNOWLEDGE_TOOLS.create_entity.execute!(
                { name: 'TestEntity', entityType: 'Service' },
                {}
            );
            expect(result).toBe('Error: Admin permissions required to create entities.');
            expect(mockHandleCreateEntity).not.toHaveBeenCalled();
        });

        it('returns error when context has isAdmin false', async () => {
            const result = await KNOWLEDGE_TOOLS.create_entity.execute!(
                { name: 'TestEntity', entityType: 'Service' },
                { isAdmin: false }
            );
            expect(result).toBe('Error: Admin permissions required to create entities.');
            expect(mockHandleCreateEntity).not.toHaveBeenCalled();
        });

        it('calls handler when isAdmin is true', async () => {
            const result = await KNOWLEDGE_TOOLS.create_entity.execute!(
                { name: 'MyService', entityType: 'Service', externalId: 'ext-1' },
                { isAdmin: true, organizationId: 42 }
            );
            expect(result).toBe('Entity created');
            expect(mockHandleCreateEntity).toHaveBeenCalledWith({ name: 'MyService', entityType: 'Service', externalId: 'ext-1' }, { isAdmin: true, organizationId: 42 });
        });

        it('calls handler when isOrgAdmin is true', async () => {
            const result = await KNOWLEDGE_TOOLS.create_entity.execute!(
                { name: 'MyService', entityType: 'Service' },
                { isOrgAdmin: true, organizationId: 42 }
            );
            expect(result).toBe('Entity created');
            expect(mockHandleCreateEntity).toHaveBeenCalled();
        });

        it('calls handler when isSuperAdmin is true', async () => {
            const result = await KNOWLEDGE_TOOLS.create_entity.execute!(
                { name: 'MyService', entityType: 'Service' },
                { isSuperAdmin: true, organizationId: 42 }
            );
            expect(result).toBe('Entity created');
            expect(mockHandleCreateEntity).toHaveBeenCalled();
        });
    });

    describe('create_relationship', () => {
        it('returns error when context has no admin flags', async () => {
            const result = await KNOWLEDGE_TOOLS.create_relationship.execute!(
                { sourceEntityName: 'A', targetEntityName: 'B', relationType: 'DEPENDS_ON' },
                {}
            );
            expect(result).toBe('Error: Admin permissions required to create relationships.');
            expect(mockHandleCreateRelationship).not.toHaveBeenCalled();
        });

        it('calls handler when isAdmin is true', async () => {
            const result = await KNOWLEDGE_TOOLS.create_relationship.execute!(
                { sourceEntityName: 'ServiceA', targetEntityName: 'ServiceB', relationType: 'USES' },
                { isAdmin: true, organizationId: 42 }
            );
            expect(result).toBe('Relationship created');
            expect(mockHandleCreateRelationship).toHaveBeenCalledWith({
                sourceEntityName: 'ServiceA',
                targetEntityName: 'ServiceB',
                relationType: 'USES',
            }, { isAdmin: true, organizationId: 42 });
        });
    });

    describe('suggest_schema', () => {
        it('returns error when context has no admin flags', async () => {
            const result = await KNOWLEDGE_TOOLS.suggest_schema.execute!(
                { domainDescription: 'E-commerce domain' },
                {}
            );
            expect(result).toBe('Error: Admin permissions required to suggest schemas.');
            expect(mockHandleSuggestSchema).not.toHaveBeenCalled();
        });

        it('calls handler when isAdmin is true', async () => {
            const result = await KNOWLEDGE_TOOLS.suggest_schema.execute!(
                { domainDescription: 'Inventory management' },
                { isAdmin: true, organizationId: 42 }
            );
            expect(result).toBe('Schema suggested');
            expect(mockHandleSuggestSchema).toHaveBeenCalledWith({ domainDescription: 'Inventory management' }, { isAdmin: true, organizationId: 42 });
        });
    });
});
