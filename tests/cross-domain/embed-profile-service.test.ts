/**
 * Embed Profile Service tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetCachedProfile = vi.fn();
const mockSetCachedProfile = vi.fn();
const mockIsOpen = vi.fn();
const mockRecordSuccess = vi.fn();
const mockRecordFailure = vi.fn();
const mockIsUrlAllowed = vi.fn();

vi.mock('@domain/auth/core/embed-profile-cache.js', () => ({
    getCachedProfile: (...args: unknown[]) => mockGetCachedProfile(...args),
    setCachedProfile: (...args: unknown[]) => mockSetCachedProfile(...args),
}));

vi.mock('@domain/auth/core/embed-profile-circuit-breaker.js', () => ({
    isOpen: (...args: unknown[]) => mockIsOpen(...args),
    recordSuccess: (...args: unknown[]) => mockRecordSuccess(...args),
    recordFailure: (...args: unknown[]) => mockRecordFailure(...args),
}));

vi.mock('@domain/auth/core/embed-profile-validator.js', () => ({
    isUrlAllowed: (...args: unknown[]) => mockIsUrlAllowed(...args),
}));

import { fetchEmbedProfile, PROFILE_ERROR_CIRCUIT_OPEN, PROFILE_ERROR_DOMAIN_NOT_ALLOWED } from "@domain/auth/core/embed-profile.service.js";

describe('Embed Profile Service', () => {
    const baseConfig = {
        profileApiUrl: 'https://api.example.com/session',
        profileApiMethod: 'GET',
        profileApiTimeoutMs: 5000,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetCachedProfile.mockReturnValue(null);
        mockIsOpen.mockReturnValue(false);
        mockIsUrlAllowed.mockReturnValue(true);
    });

    it('returns profile on successful fetch', async () => {
        const profile = { name: 'Alice', id: '123' };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(JSON.stringify(profile)),
        });

        const result = await fetchEmbedProfile('token', 'sess', baseConfig, { deploymentId: 1 });

        expect(result.profile).toEqual(profile);
        expect(result.profileErrorCode).toBeUndefined();
        expect(mockRecordSuccess).toHaveBeenCalledWith(1);
    });

    it('returns circuit_open when circuit breaker is open', async () => {
        mockIsOpen.mockReturnValue(true);

        const result = await fetchEmbedProfile('token', 'sess', baseConfig, { deploymentId: 1 });

        expect(result.profile).toBeNull();
        expect(result.profileErrorCode).toBe(PROFILE_ERROR_CIRCUIT_OPEN);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('returns domain_not_allowed when URL not in allowlist', async () => {
        mockIsUrlAllowed.mockReturnValue(false);

        const result = await fetchEmbedProfile('token', 'sess', {
            ...baseConfig,
            profileApiDomainAllowlist: ['https://allowed.com'],
        });

        expect(result.profile).toBeNull();
        expect(result.profileErrorCode).toBe(PROFILE_ERROR_DOMAIN_NOT_ALLOWED);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('returns cached profile on cache hit', async () => {
        const cached = { name: 'Cached' };
        mockGetCachedProfile.mockReturnValue(cached);

        const result = await fetchEmbedProfile('token', 'sess', {
            ...baseConfig,
            profileCacheTtlSeconds: 120,
        }, { sessionId: 'sess-1' });

        expect(result.profile).toEqual(cached);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('returns profile_fetch_failed on HTTP error', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

        const result = await fetchEmbedProfile('token', 'sess', baseConfig, { deploymentId: 1 });

        expect(result.profile).toBeNull();
        expect(result.profileErrorCode).toBe('profile_fetch_failed');
        expect(result.profileError).toBe('http_error');
        expect(mockRecordFailure).toHaveBeenCalledWith(1);
    });

    it('returns profile_fetch_timeout on AbortError', async () => {
        const err = new Error('aborted');
        (err as Error & { name: string }).name = 'AbortError';
        globalThis.fetch = vi.fn().mockRejectedValue(err);

        const result = await fetchEmbedProfile('token', 'sess', baseConfig, { deploymentId: 1 });

        expect(result.profile).toBeNull();
        expect(result.profileErrorCode).toBe('profile_fetch_timeout');
        expect(result.profileError).toBe('timeout');
    });

    it('returns profile_fetch_error on parse error', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve('not json'),
        });

        const result = await fetchEmbedProfile('token', 'sess', baseConfig, { deploymentId: 1 });

        expect(result.profile).toBeNull();
        expect(result.profileErrorCode).toBe('profile_fetch_error');
        expect(result.profileError).toBe('parse_error');
    });

    it('returns profile_fetch_error on invalid URL', async () => {
        const result = await fetchEmbedProfile('token', 'sess', {
            profileApiUrl: 'ftp://invalid.com',
        });

        expect(result.profile).toBeNull();
        expect(result.profileErrorCode).toBe('profile_fetch_error');
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('caches profile on success when sessionId and TTL provided', async () => {
        const profile = { name: 'Bob' };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(JSON.stringify(profile)),
        });

        await fetchEmbedProfile('token', 'sess', {
            ...baseConfig,
            profileCacheTtlSeconds: 120,
        }, { sessionId: 'sess-2', deploymentId: 1 });

        expect(mockSetCachedProfile).toHaveBeenCalledWith('sess-2', profile, 120);
    });
});
