/**
 * Tests for MCP Handler Utilities
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    successResponse,
    errorResponse,
    getOrgContext,
    createHandlerWrapper,
    requireAdminAccess,
    requireOrgAdminAccess,
    requireSuperAdminAccess,
    hasPermission,
    hasTopicAccess,
    hasDatasetAccess,
    hasPipelineAccess,
    parseId,
    validateRequiredFields,
    type ToolContext,
} from "@server/mcp/handlers/utils.js";

describe('MCP Handler Utils', () => {
    describe('successResponse', () => {
        it('should create a success response with data', () => {
            const data = { id: 1, name: 'Test' };
            const response = successResponse(data);
            
            expect(response.content).toHaveLength(1);
            expect(response.content[0].type).toBe('text');
            
            const parsed = JSON.parse(response.content[0].text);
            expect(parsed.success).toBe(true);
            expect(parsed.data).toEqual(data);
        });

        it('should include summary if provided', () => {
            const data = { count: 5 };
            const response = successResponse(data, 'Found 5 items');
            
            const parsed = JSON.parse(response.content[0].text);
            expect(parsed.summary).toBe('Found 5 items');
        });
    });

    describe('errorResponse', () => {
        it('should create an error response', () => {
            const response = errorResponse('Something went wrong');
            
            expect(response.content).toHaveLength(1);
            
            const parsed = JSON.parse(response.content[0].text);
            expect(parsed.success).toBe(false);
            expect(parsed.error).toBe('Something went wrong');
        });
    });

    describe('getOrgContext', () => {
        it('should return default values when no context', () => {
            const ctx = getOrgContext({ named: {}, positional: {} } as ToolContext);
            
            expect(ctx.userId).toBe('mcp-server');
            expect(ctx.isAdmin).toBe(false);
        });

        it('should use context values when provided', () => {
            const context: ToolContext = {
                organizationId: 5,
                userId: 'user123',
                isAdmin: true,
                isSuperAdmin: false,
                isOrgAdmin: true,
                named: {},
                positional: {},
            };
            
            const ctx = getOrgContext(context);
            
            expect(ctx.organizationId).toBe(5);
            expect(ctx.userId).toBe('user123');
            expect(ctx.isAdmin).toBe(true);
        });
    });

    describe('createHandlerWrapper', () => {
        it('should wrap handler and catch errors', async () => {
            const handler = vi.fn().mockRejectedValue(new Error('Test error'));
            const wrapped = createHandlerWrapper(handler);
            
            const response = await wrapped({}, { named: {}, positional: {} } as ToolContext);
            const parsed = JSON.parse(response.content[0].text);
            
            expect(parsed.success).toBe(false);
            expect(parsed.error).toBe('Test error');
        });

        it('should enforce admin permission when required', async () => {
            const handler = vi.fn().mockResolvedValue(successResponse({ ok: true }));
            const wrapped = createHandlerWrapper(handler, { requireAdmin: true });
            
            // No admin context
            const response = await wrapped({}, { isAdmin: false, named: {}, positional: {} } as ToolContext);
            const parsed = JSON.parse(response.content[0].text);
            
            expect(parsed.success).toBe(false);
            expect(parsed.error).toContain('Admin');
        });

        it('should allow admin when required', async () => {
            const handler = vi.fn().mockResolvedValue(successResponse({ ok: true }));
            const wrapped = createHandlerWrapper(handler, { requireAdmin: true });
            
            const response = await wrapped({}, { isAdmin: true, named: {}, positional: {} } as ToolContext);
            const parsed = JSON.parse(response.content[0].text);
            
            expect(parsed.success).toBe(true);
        });
    });

    describe('Permission Checking', () => {
        describe('requireAdminAccess', () => {
            it('should return true for admin', () => {
                expect(requireAdminAccess({ isAdmin: true, named: {}, positional: {} } as ToolContext)).toBe(true);
            });

            it('should return true for org admin', () => {
                expect(requireAdminAccess({ isOrgAdmin: true, named: {}, positional: {} } as ToolContext)).toBe(true);
            });

            it('should return true for super admin', () => {
                expect(requireAdminAccess({ isSuperAdmin: true, named: {}, positional: {} } as ToolContext)).toBe(true);
            });

            it('should return false for regular user', () => {
                expect(requireAdminAccess({ named: {}, positional: {} } as ToolContext)).toBe(false);
            });
        });

        describe('requireOrgAdminAccess', () => {
            it('should return true for org admin', () => {
                expect(requireOrgAdminAccess({ isOrgAdmin: true, named: {}, positional: {} } as ToolContext)).toBe(true);
            });

            it('should return false for regular admin', () => {
                expect(requireOrgAdminAccess({ isAdmin: true, named: {}, positional: {} } as ToolContext)).toBe(false);
            });
        });

        describe('requireSuperAdminAccess', () => {
            it('should return true only for super admin', () => {
                expect(requireSuperAdminAccess({ isSuperAdmin: true, named: {}, positional: {} } as ToolContext)).toBe(true);
                expect(requireSuperAdminAccess({ isAdmin: true, named: {}, positional: {} } as ToolContext)).toBe(false);
                expect(requireSuperAdminAccess({ isOrgAdmin: true, named: {}, positional: {} } as ToolContext)).toBe(false);
            });
        });

        describe('hasPermission', () => {
            it('should check for specific permission', () => {
                const context: ToolContext = {
                    permissions: ['pipeline:read', 'job:write'] as any[],
                    named: {},
                    positional: {},
                };
                
                expect(hasPermission(context, 'pipeline:read' as any)).toBe(true);
                expect(hasPermission(context, 'admin:full' as any)).toBe(false);
            });

            it('should return false when no permissions', () => {
                expect(hasPermission({ named: {}, positional: {} } as ToolContext, 'pipeline:read' as any)).toBe(false);
            });
        });

        describe('hasTopicAccess', () => {
            it('should allow super admin full access', () => {
                expect(hasTopicAccess({ isSuperAdmin: true, named: {}, positional: {} } as ToolContext, 123)).toBe(true);
            });

            it('should allow admin full access', () => {
                expect(hasTopicAccess({ isAdmin: true, named: {}, positional: {} } as ToolContext, 123)).toBe(true);
            });

            it('should check allowed topic IDs', () => {
                const context: ToolContext = { allowedTopicIds: [1, 2, 3], named: {}, positional: {} };
                
                expect(hasTopicAccess(context, 2)).toBe(true);
                expect(hasTopicAccess(context, 99)).toBe(false);
            });

            it('should allow access when no restrictions', () => {
                expect(hasTopicAccess({ named: {}, positional: {} } as ToolContext, 123)).toBe(true);
            });
        });
    });

    describe('parseId', () => {
        it('should parse numeric ID', () => {
            expect(parseId(123)).toBe(123);
        });

        it('should parse string ID', () => {
            expect(parseId('456')).toBe(456);
        });

        it('should return error for invalid ID', () => {
            const result = parseId('abc');
            expect(result).toHaveProperty('error');
        });

        it('should return error for negative ID', () => {
            const result = parseId(-1);
            expect(result).toHaveProperty('error');
        });
    });

    describe('validateRequiredFields', () => {
        it('should validate required fields', () => {
            const args = { name: 'Test', email: 'test@example.com' };
            const result = validateRequiredFields(args, ['name', 'email']);
            
            expect(result.valid).toBe(true);
        });

        it('should return error for missing fields', () => {
            const args = { name: 'Test' };
            const result = validateRequiredFields(args as { name: string; email: string }, ['name', 'email']);
            
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.error).toContain('email');
            }
        });

        it('should detect empty strings as missing', () => {
            const args = { name: '', email: 'test@example.com' };
            const result = validateRequiredFields(args, ['name', 'email']);
            
            expect(result.valid).toBe(false);
        });
    });
});
