/**
 * Embed Profile Cache tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    getCachedProfile,
    setCachedProfile,
    invalidateCachedProfile,
} from "@domain/auth/core/embed-profile-cache.js";

describe('Embed Profile Cache', () => {
    beforeEach(() => {
        // Clear cache between tests by invalidating any keys we use
        invalidateCachedProfile('session-1');
        invalidateCachedProfile('session-2');
    });

    it('returns null on cache miss', () => {
        expect(getCachedProfile('session-1')).toBeNull();
    });

    it('returns cached profile on hit', () => {
        const profile = { name: 'Alice', id: '123' };
        setCachedProfile('session-1', profile, 120);
        expect(getCachedProfile('session-1')).toEqual(profile);
    });

    it('returns null after TTL expiry', async () => {
        const profile = { name: 'Bob' };
        setCachedProfile('session-1', profile, 1); // 1 second TTL
        expect(getCachedProfile('session-1')).toEqual(profile);
        await new Promise((r) => setTimeout(r, 1100));
        expect(getCachedProfile('session-1')).toBeNull();
    });

    it('invalidates cache for session', () => {
        setCachedProfile('session-1', { x: 1 }, 120);
        expect(getCachedProfile('session-1')).toEqual({ x: 1 });
        invalidateCachedProfile('session-1');
        expect(getCachedProfile('session-1')).toBeNull();
    });

    it('does not affect other sessions when invalidating', () => {
        setCachedProfile('session-1', { a: 1 }, 120);
        setCachedProfile('session-2', { b: 2 }, 120);
        invalidateCachedProfile('session-1');
        expect(getCachedProfile('session-1')).toBeNull();
        expect(getCachedProfile('session-2')).toEqual({ b: 2 });
    });
});
