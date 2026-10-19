/**
 * Embed Profile Domain Allowlist tests
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { isUrlAllowed } from "@domain/auth/core/embed-profile-validator.js";

describe('Embed Profile Validator - isUrlAllowed', () => {
    it('allows all when allowlist is empty', () => {
        expect(isUrlAllowed('https://evil.com/api', [])).toBe(true);
        expect(isUrlAllowed('https://api.customer.com', null)).toBe(true);
        expect(isUrlAllowed('https://api.customer.com', undefined)).toBe(true);
    });

    it('allows exact match', () => {
        expect(isUrlAllowed('https://api.customer.com/session', ['https://api.customer.com'])).toBe(true);
        expect(isUrlAllowed('https://api.customer.com', ['https://api.customer.com'])).toBe(true);
    });

    it('allows wildcard subdomain', () => {
        expect(isUrlAllowed('https://api.customer.com/session', ['*.customer.com'])).toBe(true);
        expect(isUrlAllowed('https://internal.api.customer.com', ['*.customer.com'])).toBe(true);
        expect(isUrlAllowed('https://customer.com', ['*.customer.com'])).toBe(true);
    });

    it('rejects when not in allowlist', () => {
        expect(isUrlAllowed('https://evil.com/api', ['https://api.customer.com'])).toBe(false);
        expect(isUrlAllowed('https://api.evil.com', ['*.customer.com'])).toBe(false);
    });

    it('rejects invalid URL', () => {
        expect(isUrlAllowed('not-a-url', ['https://api.customer.com'])).toBe(false);
    });
});
