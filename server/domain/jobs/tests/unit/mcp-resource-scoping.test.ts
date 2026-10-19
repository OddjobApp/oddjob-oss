import { describe, it, expect } from 'vitest';
import { isResourceAllowed, hasResourcePermission } from '@shared/schema/mcp-auth.js';

describe('MCP Resource Scoping', () => {
    describe('isResourceAllowed (Glob Matching)', () => {
        it('should allow everything when no patterns provided', () => {
            expect(isResourceAllowed([], 'https://any.url')).toBe(true);
        });

        it('should support exact ID matching', () => {
            expect(isResourceAllowed(['123'], '123')).toBe(true);
            expect(isResourceAllowed(['123'], '456')).toBe(false);
        });

        it('should support simple wildcard *', () => {
            expect(isResourceAllowed(['https://host.com/*'], 'https://host.com/page1')).toBe(true);
            expect(isResourceAllowed(['https://host.com/*'], 'https://host.com/page1/sub')).toBe(false);
            expect(isResourceAllowed(['https://host.com/*'], 'https://other.com/page1')).toBe(false);
        });

        it('should support deep wildcard **', () => {
            expect(isResourceAllowed(['https://host.com/**'], 'https://host.com/page1/sub/deep')).toBe(true);
            expect(isResourceAllowed(['https://host.com/**'], 'https://host.com/')).toBe(true);
        });

        it('should support file extension wildcards', () => {
            expect(isResourceAllowed(['/docs/*.md'], '/docs/readme.md')).toBe(true);
            expect(isResourceAllowed(['/docs/*.md'], '/docs/readme.txt')).toBe(false);
            expect(isResourceAllowed(['/**/*.pdf'], '/a/b/c/file.pdf')).toBe(true);
        });

        it('should be case-insensitive', () => {
            expect(isResourceAllowed(['HTTPS://HOST.COM/*'], 'https://host.com/page')).toBe(true);
        });
    });

    describe('hasResourcePermission', () => {
        const adminPerms: any[] = ['admin:full'];
        const docReadPerms: any[] = ['document:read'];
        const scoping = {
            'document:read': ['https://allowed.com/*']
        };

        it('should deny if base permission is missing', () => {
            expect(hasResourcePermission([], 'get_document_content', 'https://allowed.com/1')).toBe(false);
        });

        it('should allow admin bypass', () => {
            expect(hasResourcePermission(adminPerms, 'get_document_content', 'https://blocked.com/1', scoping)).toBe(true);
        });

        it('should enforce scoping for specific tool', () => {
            expect(hasResourcePermission(docReadPerms, 'get_document_content', 'https://allowed.com/1', scoping)).toBe(true);
            expect(hasResourcePermission(docReadPerms, 'get_document_content', 'https://blocked.com/1', scoping)).toBe(false);
        });

        it('should allow if no scoping rules defined for the permission', () => {
            expect(hasResourcePermission(docReadPerms, 'get_document_content', 'https://any.com', {})).toBe(true);
        });
    });
});
